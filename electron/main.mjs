import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, WebContentsView } from 'electron';
import { parseDocument } from 'yaml';
import { ATTACHMENT_FILTERS, prepareAttachments, readTables } from './attachments.mjs';
import { uploadBatches } from './bulk-upload.mjs';
import { buildBatches } from '../shared/table-ingest.mjs';
import { LIBRARY_CONNECTORS, stageConnector } from '../connectors/_lib/bundle.mjs';
import { createN8nStore, isAllowedNavigation, N8N_EXTENSION, n8nExtensionEntry } from './n8n.mjs';
import { createVoiceStore, isAppAudioRequest, transcribeWithDeepgram, VoiceError } from './voice.mjs';
import { ALLOWED_COMMANDS, parseMcpbUrl, parseMcpUrl, parseSkillUrl } from './install-deep-link.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_URL = 'http://localhost:5273';

// ponytail: fixed port. Swap to a free-port scan if it ever collides in practice.
const GOOSE_PORT = 3299;
const WORKSPACE = join(ROOT, 'workspace');

try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  console.warn('[main] no .env found — goosed will start without a provider key');
}

let goosed;

function gooseBinaryPath() {
  const supported = new Set([
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-x64',
    'win32-x64',
  ]);
  const platform = `${process.platform}-${process.arch}`;
  if (!supported.has(platform)) {
    throw new Error(`Werkbank does not have a Goose binary for ${platform}.`);
  }
  const executable = process.platform === 'win32' ? 'goose.exe' : 'goose';
  const binary = join(
    ROOT,
    'node_modules',
    '@aaif',
    `goose-binary-${platform}`,
    'bin',
    executable
  );
  if (!existsSync(binary)) {
    throw new Error(`The Goose binary is missing. Run npm install for ${platform}.`);
  }
  return binary;
}

function startGoosed() {
  goosed = spawn(gooseBinaryPath(), ['serve', '--port', String(GOOSE_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: join(ROOT, 'goose-home'), // isolated from ~/.config/goose
      GOOSE_DISABLE_KEYRING: '1',
      ...loadSecrets(), // connector secrets, decrypted only into memory
    },
  });
  goosed.stderr.on('data', (d) => {
    const s = String(d);
    if (/ERROR|WARN/.test(s)) process.stderr.write(`[goosed] ${s}`);
  });
  goosed.on('error', (error) => console.error(`[goosed] could not start: ${error.message}`));
  goosed.on('exit', (code) => console.error(`[goosed] exited (${code})`));
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'Joule Work X - Next Gen Design Study',
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(ROOT, 'electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Vite may still be booting — retry rather than showing a failed-load page.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await win.loadURL(DEV_URL);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  win.show();
  mainWindow = win;
  while (queuedUrls.length) handleDeepLink(queuedUrls.shift());
}

/* ---------------- skill install deep links ----------------
 * A werkbank://install-skill link is the same action as
 * npx skills add <owner/repo> --skill <slug>.
 *
 * A skill is instructions the agent will follow, so a link from a web page must
 * never install silently — every request goes to the renderer for confirmation
 * first, showing repo, skill and origin.
 */

let mainWindow = null;
const pendingInstalls = new Map();
let nextInstallId = 1;
// Links can arrive before the window exists (cold start via the link itself).
const queuedUrls = [];

/**
 * Writes the extension into the project-local goose config.
 *
 * parseDocument, not parse+stringify: the round trip through plain objects
 * silently drops every comment in the file, and those comments carry the
 * reasons behind the ARC-1 pin and the ms365 HOME override.
 */
function installMcpServer(req, values = {}) {
  // Substitute ${user_config.key} exactly like MCPB does, then split the result:
  // ordinary values are fine in config.yaml, secrets are not.
  const plain = {};
  const secrets = {};
  const sensitive = new Set((req.fields ?? []).filter((f) => f.sensitive).map((f) => f.key));

  for (const [envVar, template] of Object.entries(req.env ?? {})) {
    let isSecret = false;
    const resolved = template.replace(/\$\{user_config\.([a-z0-9_]+)\}/gi, (_m, key) => {
      if (sensitive.has(key)) isSecret = true;
      return values[key] ?? '';
    });
    if (resolved === '') continue; // an unfilled optional stays unset
    (isSecret ? secrets : plain)[envVar] = resolved;
  }

  if (Object.keys(secrets).length) saveSecrets(req.name, secrets);

  // Remember what this connector needs (and the non-secret answers) so the
  // Configure dialog can be reopened later without the original install link.
  saveSpec(req.name, {
    fields: req.fields ?? [],
    env: req.env ?? {},
    source: req.source ?? 'config',
    description: req.description ?? '',
    values: Object.fromEntries(
      (req.fields ?? []).filter((f) => !f.sensitive).map((f) => [f.key, values[f.key] ?? ''])
    ),
  });

  const path = join(ROOT, 'goose-home/.config/goose/config.yaml');
  const doc = parseDocument(readFileSync(path, 'utf8'));
  const entry = req.remote
    ? { enabled: true, type: 'streamable_http', name: req.name, uri: req.url, envs: plain, timeout: 300 }
    : {
        enabled: true,
        type: 'stdio',
        name: req.name,
        cmd: req.command,
        args: req.args,
        envs: plain,
        timeout: 300,
      };
  doc.setIn(['extensions', req.name], entry);
  writeFileSync(path, doc.toString(), 'utf8');
}

/**
 * Secrets never land in config.yaml. They go to an OS-encrypted blob and are
 * injected into goosed's environment at launch, which stdio extensions inherit.
 *
 * ponytail: that means every extension shares goosed's env, so this isolates
 * secrets from disk, not from each other. Per-extension scoping needs goose-side
 * support; revisit if you ever run an untrusted connector alongside a trusted one.
 */
const SECRETS_FILE = join(ROOT, 'goose-home', 'secrets.enc');
const GOOSE_SECRETS_FILE = join(ROOT, 'goose-home/.config/goose/secrets.yaml');

/** Raw store: { connectorName: { ENV_VAR: value } }. Ownership matters — a flat
 *  map keyed only by env var lets any connector claim (and overwrite) another's
 *  secret, and makes the Configure form offer fields it does not own. */
function loadSecretStore() {
  try {
    const blob = readFileSync(SECRETS_FILE);
    if (!safeStorage.isEncryptionAvailable()) return {};
    const parsed = JSON.parse(safeStorage.decryptString(blob));
    // Migrate the old flat shape into a single "legacy" owner.
    const looksNested = Object.values(parsed).every((v) => v && typeof v === 'object');
    return looksNested ? parsed : { legacy: parsed };
  } catch {
    return {};
  }
}

/** Flattened for goosed's environment — stdio extensions inherit it. */
function loadSecrets() {
  return Object.assign({}, ...Object.values(loadSecretStore()));
}

/** Just this connector's secrets, for deciding what Configure may edit. */
function secretsFor(name) {
  return loadSecretStore()[name] ?? {};
}

function saveSecrets(name, next) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain unavailable — refusing to store secrets in plaintext');
  }
  const store = loadSecretStore();
  store[name] = { ...(store[name] ?? {}), ...next };
  writeFileSync(SECRETS_FILE, safeStorage.encryptString(JSON.stringify(store)));
}

async function handleDeepLink(raw) {
  let parsed = parseSkillUrl(raw) ?? parseMcpUrl(raw) ?? parseMcpbUrl(raw);
  if (!parsed) {
    console.warn('[deep-link] ignored:', raw);
    return;
  }
  if (!mainWindow) {
    queuedUrls.push(raw);
    return;
  }

  // A bundle URL has to be fetched before we know what it wants to run.
  if (parsed.kind === 'mcpb-url') {
    try {
      const { file, manifest } = await fetchBundle(parsed.src);
      parsed = { ...(await unpackBundle(file, manifest)), origin: new URL(parsed.src).host };
    } catch (e) {
      mainWindow.webContents.send('skill-install-result', {
        id: -1,
        kind: 'mcp',
        name: 'bundle',
        ok: false,
        detail: e?.message ?? String(e),
      });
      return;
    }
  }
  const id = nextInstallId++;
  console.log(`[deep-link] ${parsed.kind === 'mcp' ? 'install-mcp' : 'install-skill'} ${parsed.name}`);
  pendingInstalls.set(id, parsed);
  mainWindow.webContents.send('skill-install-request', { id, ...parsed });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

ipcMain.on('skill-install-decision', (_event, { id, approved, values }) => {
  const req = pendingInstalls.get(id);
  pendingInstalls.delete(id);
  if (!req || !approved) return;

  if (req.kind === 'mcp') {
    let ok = true;
    let detail = 'Restart the app to connect it.';
    try {
      installMcpServer(req, values ?? {});
    } catch (e) {
      ok = false;
      detail = e?.message ?? String(e);
    }
    mainWindow?.webContents.send('skill-install-result', {
      id,
      kind: 'mcp',
      name: req.name,
      ok,
      detail,
    });
    return;
  }

  // Array args, no shell — nothing from the URL is ever string-interpolated.
  execFile(
    'npx',
    ['-y', 'skills', 'add', req.slug, '--skill', req.name, '--global', '--yes'],
    { timeout: 120_000, env: { ...process.env } },
    (error, stdout, stderr) => {
      mainWindow?.webContents.send('skill-install-result', {
        id,
        kind: 'skill',
        name: req.name,
        ok: !error,
        detail: (error ? stderr || error.message : stdout).slice(0, 400),
      });
    }
  );
});

/* ---------------- .mcpb bundles + connector config ----------------
 * A .mcpb is a plain zip with a manifest.json — the same manifest arc-1 already
 * ships for Claude Desktop. We read it rather than inventing a second format:
 * `server.mcp_config` becomes the connector, `user_config` becomes the form.
 * macOS ships `unzip`, so this needs no dependency.
 */
const BUNDLES_DIR = join(ROOT, 'goose-home/bundles');
const SPECS_DIR = join(ROOT, 'goose-home/connectors');

function fieldsFromUserConfig(userConfig = {}) {
  return Object.entries(userConfig).map(([key, spec]) => ({
    key,
    title: String(spec?.title ?? key).slice(0, 120),
    description: String(spec?.description ?? '').slice(0, 300),
    required: spec?.required === true,
    sensitive: spec?.sensitive === true,
    default:
      typeof spec?.default === 'string'
        ? spec.default
        : spec?.default != null
          ? String(spec.default)
          : '',
  }));
}

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

/** Reject zip-slip before extracting anything. */
async function bundleEntriesAreSafe(file) {
  const listing = await new Promise((resolve, reject) =>
    execFile('unzip', ['-Z1', file], { maxBuffer: 8 << 20 }, (e, stdout) =>
      e ? reject(e) : resolve(stdout)
    )
  );
  return listing
    .split('\n')
    .filter(Boolean)
    .every((entry) => !entry.startsWith('/') && !entry.split('/').includes('..'));
}

/** Download a .mcpb and read its manifest. Nothing is extracted or run yet — the
 *  user sees the command in the dialog before any of it lands on disk. */
async function fetchBundle(src) {
  const res = await fetch(src, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BUNDLE_BYTES) {
    throw new Error('bundle larger than 64 MB — refusing');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BUNDLE_BYTES) throw new Error('bundle larger than 64 MB — refusing');
  if (buf.subarray(0, 2).toString() !== 'PK') throw new Error('not a .mcpb (not a zip archive)');

  mkdirSync(BUNDLES_DIR, { recursive: true });
  const file = join(BUNDLES_DIR, `dl-${Date.now()}.mcpb`);
  writeFileSync(file, buf);
  if (!(await bundleEntriesAreSafe(file))) throw new Error('bundle has unsafe paths — refusing');

  const manifestRaw = await new Promise((resolve, reject) =>
    execFile('unzip', ['-p', file, 'manifest.json'], { maxBuffer: 8 << 20 }, (e, stdout) =>
      e ? reject(new Error('no manifest.json in bundle')) : resolve(stdout)
    )
  );
  return { file, manifest: JSON.parse(manifestRaw) };
}

/** Extract a downloaded bundle and shape it like any other install request. */
async function unpackBundle(file, manifest) {
  const name = String(manifest.name ?? 'bundle').replace(/[^A-Za-z0-9._-]/g, '-');
  const target = join(BUNDLES_DIR, name);
  mkdirSync(target, { recursive: true });
  await new Promise((resolve, reject) =>
    execFile('unzip', ['-o', '-q', file, '-d', target], { maxBuffer: 8 << 20 }, (e) =>
      e ? reject(e) : resolve()
    )
  );
  const mcp = manifest?.server?.mcp_config;
  if (!mcp?.command) throw new Error('manifest has no server.mcp_config.command');
  if (!ALLOWED_COMMANDS.has(mcp.command)) {
    throw new Error(`bundle wants to run "${mcp.command}", which is not allowed`);
  }
  const sub = (s) => String(s).replace(/\$\{__dirname\}/g, target);
  return {
    kind: 'mcp',
    name,
    source: 'mcpb',
    remote: false,
    command: mcp.command,
    args: (mcp.args ?? []).map(sub),
    env: Object.fromEntries(Object.entries(mcp.env ?? {}).map(([k, v]) => [k, sub(v)])),
    fields: fieldsFromUserConfig(manifest.user_config),
    description: manifest.display_name ?? manifest.description ?? '',
  };
}

/** Remember what a connector needs, so Configure still works after install. */
function saveSpec(name, spec) {
  mkdirSync(SPECS_DIR, { recursive: true });
  writeFileSync(join(SPECS_DIR, `${name}.json`), JSON.stringify(spec, null, 2), 'utf8');
}

function loadSpec(name) {
  try {
    return JSON.parse(readFileSync(join(SPECS_DIR, `${name}.json`), 'utf8'));
  } catch {
    // Source-controlled connector definitions also serve as Configure metadata
    // for connectors that were added by hand before Werkbank started saving
    // per-install specs. This keeps sensitive fields visible without ever
    // putting their values in config.yaml.
    try {
      const example = JSON.parse(readFileSync(join(ROOT, 'examples', `${name}.json`), 'utf8'));
      return {
        fields: fieldsFromUserConfig(example.user_config),
        env: example.env ?? {},
        values: {},
        source: 'example',
        bundled: true,
      };
    } catch {
      return null;
    }
  }
}

ipcMain.handle('import-mcpb', async () => {
  const picked = await dialog.showOpenDialog({
    title: 'Import MCP bundle',
    filters: [{ name: 'MCP bundle', extensions: ['mcpb', 'dxt', 'zip'] }],
    properties: ['openFile'],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const file = picked.filePaths[0];

  const manifestRaw = await new Promise((resolve, reject) =>
    execFile('unzip', ['-p', file, 'manifest.json'], { maxBuffer: 8 << 20 }, (e, stdout) =>
      e ? reject(new Error('not a readable .mcpb (no manifest.json)')) : resolve(stdout)
    )
  ).catch((e) => ({ error: e.message }));
  if (manifestRaw?.error) return { error: manifestRaw.error };

  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    return { error: 'manifest.json is not valid JSON' };
  }

  const mcp = manifest?.server?.mcp_config;
  if (!mcp?.command) return { error: 'manifest has no server.mcp_config.command' };
  if (!ALLOWED_COMMANDS.has(mcp.command)) {
    return { error: `bundle wants to run "${mcp.command}", which is not allowed` };
  }

  const name = String(manifest.name ?? 'bundle').replace(/[^A-Za-z0-9._-]/g, '-');
  const target = join(BUNDLES_DIR, name);
  mkdirSync(target, { recursive: true });
  await new Promise((resolve, reject) =>
    execFile('unzip', ['-o', '-q', file, '-d', target], { maxBuffer: 8 << 20 }, (e) =>
      e ? reject(e) : resolve()
    )
  );

  // ${__dirname} points at wherever we just extracted the bundle.
  const sub = (s) => String(s).replace(/\$\{__dirname\}/g, target);
  const request = {
    kind: 'mcp',
    name,
    source: 'mcpb',
    remote: false,
    command: mcp.command,
    args: (mcp.args ?? []).map(sub),
    env: Object.fromEntries(Object.entries(mcp.env ?? {}).map(([k, v]) => [k, sub(v)])),
    fields: fieldsFromUserConfig(manifest.user_config),
    description: manifest.display_name ?? manifest.description ?? '',
  };
  // Register it like a deep link would, so the same approve→install path applies.
  // Without this the dialog would appear and Install would silently do nothing.
  const id = nextInstallId++;
  pendingInstalls.set(id, request);
  return { id, ...request };
});

/**
 * The Werkbank connectors (AI Control Tower, Sub4Me, n8n Automation, Skill Marketplace, Knowledge Graph, Web Sources,
 * Werkbank Workspace) ship inside the repository. Stage one the way an extracted .mcpb would look and register it for the
 * normal approve→install dialog, so nobody has to build or find a bundle file first. Settings such as the Supabase URL
 * and key are optional in that dialog.
 */
function prepareLibraryConnector(id) {
  try {
    if (!LIBRARY_CONNECTORS.includes(id)) return { error: `unknown connector: ${id}` };
    const manifest = JSON.parse(readFileSync(join(ROOT, 'connectors', id, 'manifest.json'), 'utf8'));
    const mcp = manifest?.server?.mcp_config;
    if (!mcp?.command || !ALLOWED_COMMANDS.has(mcp.command)) {
      return { error: 'the bundled connector manifest is invalid' };
    }
    const name = String(manifest.name ?? id).replace(/[^A-Za-z0-9._-]/g, '-');
    const target = join(BUNDLES_DIR, name);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    stageConnector(id, target);

    const sub = (s) => String(s).replace(/\$\{__dirname\}/g, target);
    const request = {
      kind: 'mcp',
      name,
      source: 'mcpb',
      remote: false,
      command: mcp.command,
      args: (mcp.args ?? []).map(sub),
      env: Object.fromEntries(Object.entries(mcp.env ?? {}).map(([k, v]) => [k, sub(v)])),
      fields: fieldsFromUserConfig(manifest.user_config),
      description: manifest.display_name ?? manifest.description ?? '',
    };
    const requestId = nextInstallId++;
    pendingInstalls.set(requestId, request);
    return { id: requestId, ...request };
  } catch (e) {
    return { error: `could not prepare the connector: ${e?.message ?? e}` };
  }
}

ipcMain.handle('prepare-connector', (_event, id) => prepareLibraryConnector(String(id ?? '')));
ipcMain.handle('prepare-control-tower-connector', () => prepareLibraryConnector('ai-control-tower'));

/** The connectors that come with Werkbank, for the "Add a bundled connector" list. */
ipcMain.handle('list-bundled-connectors', () =>
  LIBRARY_CONNECTORS.map((id) => {
    try {
      const m = JSON.parse(readFileSync(join(ROOT, 'connectors', id, 'manifest.json'), 'utf8'));
      return { id, name: m.name, title: m.display_name ?? m.name, description: m.description ?? '', tools: (m.tools ?? []).length, needsSetup: Object.keys(m.user_config ?? {}).length > 0 };
    } catch {
      return null;
    }
  }).filter(Boolean)
);

const LOOKS_SECRET = /password|secret|token|api[-_]?key|authorization|cookie|credential/i;
const REDACTED = '<redacted>';
const JSON_EDITABLE_SOURCES = new Set(['link', 'mcpb', 'config']);
const CONNECTOR_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function configuredEntry(name) {
  try {
    const doc = parseDocument(readFileSync(join(ROOT, 'goose-home/.config/goose/config.yaml'), 'utf8'));
    return doc.getIn(['extensions', name])?.toJSON?.() ?? null;
  } catch {
    return null;
  }
}

function configuredEnvs(name) {
  return configuredEntry(name)?.envs ?? {};
}

/** The renderer may display this object, so redact before crossing IPC. */
function sanitizedConnectorEntry(value, key = '') {
  if (LOOKS_SECRET.test(key)) return value == null || value === '' ? value : REDACTED;
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const previous = value[index - 1];
      return typeof previous === 'string' && LOOKS_SECRET.test(previous)
        ? REDACTED
        : sanitizedConnectorEntry(item);
    });
  }
  if (plainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizedConnectorEntry(child, childKey),
      ])
    );
  }
  if (typeof value === 'string') {
    return value
      .replace(/(https?:\/\/[^:/\s]+:)[^@\s]+@/gi, `$1${REDACTED}@`)
      .replace(
        /(--?(?:password|secret|token|api[-_]?key)(?:=|\s+))\S+/gi,
        `$1${REDACTED}`
      );
  }
  return value;
}

/**
 * Connectors installed before specs existed (or added by hand in config.yaml)
 * have no saved user_config. Derive an editable form from what is actually
 * configured: the extension's envs, plus any env vars we hold secrets for.
 */
function synthesizeSpec(name) {
  const envs = configuredEnvs(name);
  const secretKeys = Object.keys(secretsFor(name));
  const keys = [...new Set([...Object.keys(envs), ...secretKeys])];
  if (keys.length === 0) return null;

  const fields = keys.map((k) => ({
    key: k.toLowerCase(),
    title: k,
    description: LOOKS_SECRET.test(k) ? 'Stored in the OS keychain.' : '',
    required: false,
    sensitive: LOOKS_SECRET.test(k),
    default: '',
  }));
  return {
    fields,
    env: Object.fromEntries(keys.map((k) => [k, `\${user_config.${k.toLowerCase()}}`])),
    values: Object.fromEntries(
      Object.entries(envs).map(([k, v]) => [k.toLowerCase(), String(v)])
    ),
    source: 'config',
    synthesized: true,
  };
}

/** A connector added directly to Goose config may have no envs and therefore
 * no synthesizeable fields yet. It still has a useful, editable MCP JSON
 * representation; newly added secret-shaped envs are discovered on save. */
function emptyConfigSpec() {
  return {
    fields: [],
    env: {},
    values: {},
    source: 'config',
    synthesized: true,
  };
}

/** Spec + current non-secret values, for the Configure dialog. */
ipcMain.handle('get-connector-spec', (_event, name) => {
  if (!CONNECTOR_NAME.test(name ?? '')) return null;
  const spec = loadSpec(name) ?? synthesizeSpec(name) ?? emptyConfigSpec();
  const entry = configuredEntry(name);
  const envs = entry?.envs ?? {};
  const storedSecrets = secretsFor(name);
  const fields = (spec.fields ?? []).map((field) => {
    const envVar = Object.entries(spec.env ?? {}).find(([, template]) =>
      String(template).includes(`\${user_config.${field.key}}`)
    )?.[0];
    return {
      ...field,
      stored: Boolean(field.sensitive && envVar && storedSecrets[envVar]),
    };
  });
  const values = {};
  for (const f of fields) {
    const envVar = Object.entries(spec.env ?? {}).find(([, t]) =>
      String(t).includes(`\${user_config.${f.key}}`)
    )?.[0];
    // Secrets are never sent back to the renderer.
    if (f.sensitive) values[f.key] = '';
    else {
      values[f.key] =
        envVar && envs[envVar] != null
          ? String(envs[envVar])
          : spec.values?.[f.key] ?? f.default ?? '';
    }
  }
  const { enabled: _enabled, ...editableEntry } = entry ?? {};
  return { ...spec, fields, values, config: sanitizedConnectorEntry(editableEntry) };
});

/* ---------------- skills + agent lifecycle ----------------
 * `goose skills list` prints a table with no machine format, so read the
 * SKILL.md frontmatter directly — that is the actual contract and it is stable.
 */
const SKILLS_DIR = join(ROOT, 'goose-home/.agents/skills');

function readSkills() {
  let entries = [];
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink());
  } catch {
    return [];
  }
  const skills = [];
  for (const e of entries) {
    let name = e.name;
    let description = '';
    try {
      const md = readFileSync(join(SKILLS_DIR, e.name, 'SKILL.md'), 'utf8');
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
      if (fm) {
        const grab = (key) => {
          const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm[1]);
          return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
        };
        name = grab('name') || name;
        description = grab('description');
      }
    } catch {
      continue; // a directory without SKILL.md is not a skill
    }
    skills.push({ name, description: description.slice(0, 240), dir: e.name });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

ipcMain.handle('list-skills', () => readSkills());

/** Text of one SKILL.md, for the automatic review before a skill is published one level up. */
ipcMain.handle('read-skill', (_event, dir) => {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(dir ?? '')) return null;
  try {
    return readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8').slice(0, 40_000);
  } catch {
    return null;
  }
});

ipcMain.handle('remove-skill', async (_event, name) => {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(name ?? '')) return { ok: false, detail: 'bad name' };
  return await new Promise((resolve) => {
    execFile(
      'npx',
      ['-y', 'skills', 'remove', name, '--global', '--yes'],
      { timeout: 120_000 },
      (error, stdout, stderr) =>
        resolve({ ok: !error, detail: (error ? stderr || error.message : stdout).slice(0, 300) })
    );
  });
});

function stringRecord(value, label, keyPattern = /^.{1,200}$/) {
  if (value == null) return {};
  if (!plainObject(value)) throw new Error(`${label} must be a JSON object`);
  const entries = Object.entries(value);
  if (entries.length > 128) throw new Error(`${label} has too many entries`);
  for (const [key, item] of entries) {
    if (!keyPattern.test(key)) throw new Error(`${label} contains an invalid key: ${key}`);
    if (typeof item !== 'string') throw new Error(`${label}.${key} must be a string`);
    if (item.length > 8192) throw new Error(`${label}.${key} is too long`);
  }
  return Object.fromEntries(entries);
}

/** A redacted string is a keep-existing marker, never a literal value. */
function restoreRedacted(next, existing) {
  if (typeof next === 'string' && next.includes(REDACTED)) {
    if (typeof existing !== 'string') throw new Error('redacted value has no stored original');
    return existing;
  }
  if (Array.isArray(next)) {
    return next.map((item, index) => restoreRedacted(item, existing?.[index]));
  }
  if (plainObject(next)) {
    return Object.fromEntries(
      Object.entries(next).map(([key, value]) => [
        key,
        restoreRedacted(value, plainObject(existing) ? existing[key] : undefined),
      ])
    );
  }
  return next;
}

function rejectNewInlineSecrets(raw) {
  const args = Array.isArray(raw?.args) ? raw.args : [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (typeof arg !== 'string') continue;
    if (
      /--?(?:password|secret|token|api[-_]?key)=/i.test(arg) &&
      !arg.includes(REDACTED)
    ) {
      throw new Error('put secret values in envs, not command arguments');
    }
    if (
      /^--?(?:password|secret|token|api[-_]?key)$/i.test(arg) &&
      typeof args[index + 1] === 'string' &&
      !args[index + 1].includes(REDACTED)
    ) {
      throw new Error('put secret values in envs, not command arguments');
    }
  }
  if (
    typeof raw?.uri === 'string' &&
    /^https?:\/\/[^:/\s]+:[^@\s]+@/i.test(raw.uri) &&
    !raw.uri.includes(REDACTED)
  ) {
    throw new Error('credentials are not allowed in the connector URL');
  }
}

/** Validate the exact Goose session shape displayed by Configure. */
function validateEditableConnector(name, raw, existing) {
  if (!plainObject(raw)) throw new Error('configuration must be a JSON object');
  const serialized = JSON.stringify(raw);
  if (serialized.length > 64 * 1024) throw new Error('configuration is larger than 64 KB');
  rejectNewInlineSecrets(raw);
  const config = restoreRedacted(raw, existing);
  if (config.name !== name) throw new Error('connector name cannot be changed');
  if (!Number.isInteger(config.timeout) || config.timeout < 1 || config.timeout > 3600) {
    throw new Error('timeout must be an integer from 1 to 3600 seconds');
  }

  const envs = stringRecord(config.envs, 'envs', /^[A-Za-z_][A-Za-z0-9_]*$/);
  const secretEnvs = {};
  for (const [key, value] of Object.entries(envs)) {
    if (LOOKS_SECRET.test(key)) {
      secretEnvs[key] = value;
      delete envs[key];
    }
  }

  if (config.type === 'stdio') {
    const allowed = new Set(['type', 'name', 'cmd', 'args', 'envs', 'timeout']);
    if (Object.keys(config).some((key) => !allowed.has(key))) {
      throw new Error('stdio config contains unsupported keys');
    }
    if (!ALLOWED_COMMANDS.has(config.cmd) && config.cmd !== existing.cmd) {
      throw new Error(`command "${config.cmd}" is not allowed`);
    }
    if (
      !Array.isArray(config.args) ||
      config.args.length > 128 ||
      config.args.some((arg) => typeof arg !== 'string' || arg.length > 8192)
    ) {
      throw new Error('args must be an array of at most 128 strings');
    }
    return {
      entry: {
        enabled: existing.enabled !== false,
        type: 'stdio',
        name,
        cmd: config.cmd,
        args: config.args,
        envs,
        timeout: config.timeout,
      },
      secretEnvs,
    };
  }

  if (config.type === 'streamable_http') {
    const allowed = new Set(['type', 'name', 'uri', 'headers', 'envs', 'timeout']);
    if (Object.keys(config).some((key) => !allowed.has(key))) {
      throw new Error('HTTP config contains unsupported keys');
    }
    let uri;
    try {
      uri = new URL(config.uri);
    } catch {
      throw new Error('uri must be a valid HTTPS URL');
    }
    if (uri.protocol !== 'https:' || uri.username || uri.password) {
      throw new Error('uri must be HTTPS and must not contain credentials');
    }
    const headers = stringRecord(config.headers, 'headers');
    for (const [key, value] of Object.entries(headers)) {
      if (/\r|\n/.test(key) || /\r|\n/.test(value)) {
        throw new Error('HTTP headers cannot contain newlines');
      }
      const rawValue = raw.headers?.[key];
      if (LOOKS_SECRET.test(key) && !String(rawValue ?? '').includes(REDACTED)) {
        throw new Error(`secret header ${key} cannot be stored here; use connector OAuth`);
      }
    }
    return {
      entry: {
        enabled: existing.enabled !== false,
        type: 'streamable_http',
        name,
        uri: uri.toString(),
        headers,
        envs,
        timeout: config.timeout,
      },
      secretEnvs,
    };
  }

  throw new Error('type must be "stdio" or "streamable_http"');
}

function applyDeclaredFields(entry, spec, values) {
  const envs = { ...(entry.envs ?? {}) };
  const secrets = {};
  const sensitive = new Set(
    (spec.fields ?? []).filter((field) => field.sensitive).map((field) => field.key)
  );

  for (const [envVar, templateValue] of Object.entries(spec.env ?? {})) {
    const template = String(templateValue);
    if (!template.includes('${user_config.')) continue;
    let isSecret = false;
    let keepStoredSecret = false;
    const resolved = template.replace(/\$\{user_config\.([a-z0-9_]+)\}/gi, (_match, key) => {
      if (sensitive.has(key)) {
        isSecret = true;
        if (!values?.[key]) keepStoredSecret = true;
      }
      return values?.[key] ?? '';
    });
    if (isSecret) {
      delete envs[envVar];
      if (!keepStoredSecret && resolved) secrets[envVar] = resolved;
    } else if (resolved) {
      envs[envVar] = resolved;
    } else {
      delete envs[envVar];
    }
  }
  return { entry: { ...entry, envs }, secrets };
}

/** Keep environment keys introduced through the JSON editor discoverable on
 * the next Configure open. Secret values themselves never enter this spec. */
function specWithConfiguredEnvs(spec, entry, secretKeys = []) {
  const fields = [...(spec.fields ?? [])];
  const env = { ...(spec.env ?? {}) };
  const usedKeys = new Set(fields.map((field) => field.key));
  const envKeys = [...new Set([...Object.keys(entry.envs ?? {}), ...secretKeys])];

  for (const envVar of envKeys) {
    const mapped = Object.entries(env).find(([key]) => key === envVar)?.[1];
    if (mapped && /\$\{user_config\.[a-z0-9_]+\}/i.test(String(mapped))) continue;

    let fieldKey = envVar.toLowerCase();
    let suffix = 2;
    while (usedKeys.has(fieldKey)) fieldKey = `${envVar.toLowerCase()}_${suffix++}`;
    usedKeys.add(fieldKey);
    fields.push({
      key: fieldKey,
      title: envVar,
      description: LOOKS_SECRET.test(envVar) ? 'Stored in the OS keychain.' : '',
      required: false,
      sensitive: LOOKS_SECRET.test(envVar),
      default: '',
    });
    env[envVar] = `\${user_config.${fieldKey}}`;
  }

  const values = { ...(spec.values ?? {}) };
  for (const field of fields) {
    if (field.sensitive) continue;
    const envVar = Object.entries(env).find(([, template]) =>
      String(template).includes(`\${user_config.${field.key}}`)
    )?.[0];
    if (envVar && entry.envs?.[envVar] != null) values[field.key] = String(entry.envs[envVar]);
  }
  return { ...spec, fields, env, values, source: spec.source ?? 'config' };
}

/** Re-apply declared fields and, for MCP JSON/MCPB installs, validated JSON. */
ipcMain.handle('save-connector-config', (_event, { name, values, config }) => {
  if (!CONNECTOR_NAME.test(name ?? '')) return { ok: false, detail: 'bad name' };
  const spec = loadSpec(name) ?? synthesizeSpec(name) ?? emptyConfigSpec();
  try {
    const path = join(ROOT, 'goose-home/.config/goose/config.yaml');
    const doc = parseDocument(readFileSync(path, 'utf8'));
    const existing = doc.getIn(['extensions', name])?.toJSON?.();
    if (!plainObject(existing)) throw new Error('connector not found');

    let entry = existing;
    let jsonSecrets = {};
    if (config !== undefined) {
      if (!JSON_EDITABLE_SOURCES.has(spec.source)) {
        throw new Error('JSON editing is not available for this connector source');
      }
      const validated = validateEditableConnector(name, config, existing);
      entry = validated.entry;
      jsonSecrets = validated.secretEnvs;
    }

    const declared = applyDeclaredFields(entry, spec, values ?? {});
    entry = declared.entry;
    const nextSecrets = { ...jsonSecrets, ...declared.secrets };
    if (Object.keys(nextSecrets).length) saveSecrets(name, nextSecrets);

    doc.setIn(['extensions', name], entry);
    writeFileSync(path, doc.toString(), 'utf8');
    saveSpec(
      name,
      specWithConfiguredEnvs(spec, entry, [
        ...Object.keys(secretsFor(name)),
        ...Object.keys(nextSecrets),
      ])
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e?.message ?? String(e) };
  }
});

/** Remote MCP OAuth is owned by goose, while form secrets are owned by
 * Werkbank's safeStorage blob, so a real Log out must clear both stores. */
function forgetConnectorSecrets(name) {
  try {
    const store = loadSecretStore();
    delete store[name];
    writeFileSync(SECRETS_FILE, safeStorage.encryptString(JSON.stringify(store)));

    try {
      const oauth = parseDocument(readFileSync(GOOSE_SECRETS_FILE, 'utf8'));
      const key = `oauth_creds_${name}`;
      if (oauth.hasIn([key])) {
        oauth.deleteIn([key]);
        writeFileSync(GOOSE_SECRETS_FILE, oauth.toString(), 'utf8');
      }
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e?.message };
  }
}

/** Forget a connector's stored credentials without removing the connector. */
ipcMain.handle('forget-secrets', (_event, name) => forgetConnectorSecrets(name));

/** Persist connector state without goose's config API, whose serialization
 * expands platform defaults and drops the hand-written YAML comments. */
ipcMain.handle('set-connector-enabled', (_event, { name, enabled }) => {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(name ?? '')) {
    return { ok: false, detail: 'bad name' };
  }
  try {
    const path = join(ROOT, 'goose-home/.config/goose/config.yaml');
    const doc = parseDocument(readFileSync(path, 'utf8'));
    if (!doc.hasIn(['extensions', name])) return { ok: false, detail: 'connector not found' };
    doc.setIn(['extensions', name, 'enabled'], enabled === true);
    writeFileSync(path, doc.toString(), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e?.message ?? String(e) };
  }
});

ipcMain.handle('remove-connector', (_event, name) => {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(name ?? '')) {
    return { ok: false, detail: 'bad name' };
  }
  try {
    const path = join(ROOT, 'goose-home/.config/goose/config.yaml');
    const doc = parseDocument(readFileSync(path, 'utf8'));
    if (!doc.hasIn(['extensions', name])) return { ok: false, detail: 'connector not found' };
    doc.deleteIn(['extensions', name]);
    writeFileSync(path, doc.toString(), 'utf8');
    const forgotten = forgetConnectorSecrets(name);
    if (!forgotten.ok) return forgotten;
    rmSync(join(SPECS_DIR, `${name}.json`), { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e?.message ?? String(e) };
  }
});

/** Restart goosed so config/credential changes take effect. */
ipcMain.handle('restart-agent', async () => {
  try {
    goosed?.kill();
    await new Promise((r) => setTimeout(r, 800));
    startGoosed();
    await new Promise((r) => setTimeout(r, 2500));
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e?.message };
  }
});

ipcMain.on('get-workspace-path', (event) => {
  event.returnValue = WORKSPACE;
});

function workspaceFile(path) {
  if (typeof path !== 'string') return null;
  const target = resolve(path);
  const rel = relative(WORKSPACE, target);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? target : null;
}

// Open/reveal only inside the agent's workspace — paths come from tool output,
// which is model-influenced, so never hand arbitrary locations to the OS shell.
ipcMain.handle('open-file', async (_event, path) => {
  const target = workspaceFile(path);
  if (!target) return { ok: false, detail: 'File is outside the workspace.' };
  const detail = await shell.openPath(target);
  return detail ? { ok: false, detail } : { ok: true };
});

ipcMain.on('reveal-file', (_event, path) => {
  const target = workspaceFile(path);
  if (target) shell.showItemInFolder(target);
});

/** Native file selection plus local Office extraction. Files are copied into
 * the agent workspace so ACP resource links and Developer tools see the same
 * stable path even when the original lives outside the workspace. */
ipcMain.handle('pick-chat-files', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: 'Add files to this conversation',
      buttonLabel: 'Add',
      properties: ['openFile', 'multiSelections'],
      filters: ATTACHMENT_FILTERS,
    });
    if (result.canceled || result.filePaths.length === 0) return { files: [], errors: [] };
    return prepareAttachments(result.filePaths, WORKSPACE);
  } catch (error) {
    return { files: [], errors: [error?.message ?? String(error)] };
  }
});

/** Files dropped onto the chat: the same copy-and-extract path as the file dialog. */
ipcMain.handle('add-chat-files', (_event, paths) => {
  try {
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) return { files: [], errors: ['Nothing to add.'] };
    return prepareAttachments(paths, WORKSPACE);
  } catch (error) {
    return { files: [], errors: [error?.message ?? String(error)] };
  }
});

/** The tables of an attached file (workspace only), for the table Space and the mass upload. */
ipcMain.handle('read-tables', (_event, path) => {
  try {
    const file = workspaceFile(path);
    if (!file) return { ok: false, detail: 'File is outside the workspace.' };
    const tables = readTables(file).filter((t) => t.table.columns.length > 0);
    if (!tables.length) return { ok: false, detail: 'No table found in this file.' };
    return { ok: true, tables };
  } catch (error) {
    return { ok: false, detail: error?.message ?? String(error) };
  }
});

/** Mass upload: send the rows of one table to a webhook in batches. Progress goes back as events. */
let bulkCancelled = false;
ipcMain.on('bulk-upload-cancel', () => { bulkCancelled = true; });
ipcMain.handle('bulk-upload-rows', async (event, request) => {
  try {
    const file = workspaceFile(request?.path);
    if (!file) return { ok: false, error: 'File is outside the workspace.' };
    const tables = readTables(file);
    const picked = tables[Number(request?.tableIndex) || 0];
    if (!picked) return { ok: false, error: 'This table was not found.' };
    const batches = buildBatches({
      fileName: tables.length > 1 ? `${picked.name}` : picked.name,
      table: picked.table,
      batchSize: request?.batchSize,
      batchId: typeof request?.batchId === 'string' && request.batchId ? request.batchId.slice(0, 80) : randomUUID(),
    });
    bulkCancelled = false;
    const result = await uploadBatches({
      url: String(request?.url ?? ''),
      token: typeof request?.token === 'string' ? request.token.slice(0, 500) : '',
      startAt: Math.max(1, Number(request?.startAt) || 1),
      batches,
      isCancelled: () => bulkCancelled,
      onProgress: (progress) => event.sender.send('bulk-upload-progress', progress),
    });
    return { ...result, batchId: batches[0]?.batchId, totalRows: picked.table.rows.length };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
});

/** Deterministic local workflows used for data-grounded artifacts.
 * The request may only reference files already copied into the workspace, and
 * the worker may only return workspace paths. This keeps the fast path useful
 * without turning IPC into an arbitrary command runner. */
ipcMain.handle('run-local-workflow', async (_event, raw) => {
  const type = raw?.type;
  if (type !== 'data-space' && type !== 'shipment-deck' && type !== 'meeting-brief-doc') {
    return { handled: false, detail: 'unsupported local workflow' };
  }
  let csvPath = null;
  let templatePath = null;
  let sourceText = '';
  if (type === 'meeting-brief-doc') {
    templatePath = workspaceFile(raw?.templatePath);
    sourceText = String(raw?.sourceText ?? '').slice(0, 80_000);
    if (!templatePath || !templatePath.toLowerCase().endsWith('.docx')) {
      return { handled: false, detail: 'Word template must be inside the workspace.' };
    }
    if (!sourceText.trim()) {
      return { handled: false, detail: 'No verified meeting context is available to fill the template.' };
    }
  } else {
    csvPath = workspaceFile(raw?.csvPath);
    if (!csvPath || !csvPath.toLowerCase().endsWith('.csv')) {
      return { handled: false, detail: 'CSV source must be inside the workspace.' };
    }
  }
  const title = String(raw?.title ?? '').slice(0, 140);
  const prompt = String(raw?.prompt ?? '').slice(0, 12_000);
  const sourceName = String(raw?.sourceName ?? '')
    .replace(/[\\/\u0000-\u001f]/g, '')
    .slice(0, 180);
  const spaceSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw?.spaceSlug ?? '')
    ? raw.spaceSlug
    : '';
  const requestDir = join(WORKSPACE, '.workflow');
  const requestPath = join(requestDir, `${randomUUID()}.json`);
  mkdirSync(requestDir, { recursive: true });
  writeFileSync(
    requestPath,
    JSON.stringify({ type, csvPath, templatePath, sourceText, sourceName, title, prompt, spaceSlug }),
    'utf8'
  );

  try {
    const script = join(ROOT, 'scripts/local-artifact-workflow.mjs');
    const stdout = await new Promise((resolveOutput, reject) => {
      execFile(
        process.execPath,
        [script, requestPath],
        {
          timeout: 180_000,
          maxBuffer: 8 << 20,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        },
        (error, output, stderr) => {
          if (error) reject(new Error((stderr || error.message).slice(0, 1200)));
          else resolveOutput(output);
        }
      );
    });
    const marker = stdout.lastIndexOf('{"handled"');
    if (marker < 0) throw new Error('local workflow returned no result');
    const result = JSON.parse(stdout.slice(marker));
    const files = (result.files ?? []).map(workspaceFile).filter(Boolean);
    const toolCalls = (result.toolCalls ?? []).map((call) => ({
      title: String(call.title ?? 'Local workflow').slice(0, 240),
      toolName: String(call.toolName ?? 'local_workflow').slice(0, 80),
      status: call.status === 'failed' ? 'failed' : 'completed',
      locations: (call.locations ?? [])
        .map((location) => workspaceFile(location?.path))
        .filter(Boolean)
        .map((path) => ({ path })),
    }));
    return {
      handled: result.handled === true,
      kind: result.kind,
      slug: result.slug,
      title: result.title,
      text: String(result.text ?? '').slice(0, 20_000),
      files,
      toolCalls,
    };
  } catch (error) {
    return { handled: false, detail: error?.message ?? String(error) };
  } finally {
    rmSync(requestPath, { force: true });
  }
});

// Werkbank owns only its own protocol. Do not take over another application's
// URL scheme merely because the payload format happens to be compatible.
app.setAsDefaultProtocolClient('werkbank');

// macOS delivers links to the running instance via open-url…
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// …Windows/Linux relaunch the binary, so bounce argv into instance one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith('werkbank://'));
    if (link) handleDeepLink(link);
    // The window may already be closed (macOS keeps the app alive without one).
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/* ---------------- voice input ----------------
 * Key + settings live in their own encrypted file (not the connector store, which goosed inherits as env).
 * The microphone is granted to the app's own page only; Spaces (sandboxed iframes) never get it. */
const voiceStore = createVoiceStore({ file: join(ROOT, 'goose-home', 'voice.enc'), safeStorage });

ipcMain.handle('voice-get-settings', () => voiceStore.getPublic());
ipcMain.handle('voice-save-settings', (_event, patch) => {
  try {
    return { ok: true, settings: voiceStore.save(patch && typeof patch === 'object' ? patch : {}) };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle('voice-transcribe', async (_event, { audio, mimeType } = {}) => {
  try {
    const settings = voiceStore.getPublic();
    const text = await transcribeWithDeepgram({
      audio: Buffer.from(audio ?? []),
      mimeType,
      key: voiceStore.getKey(),
      language: settings.language,
    });
    return { ok: true, text };
  } catch (error) {
    const known = error instanceof VoiceError;
    return { ok: false, code: known ? error.code : 'unknown', detail: known ? error.message : 'Spracherkennung fehlgeschlagen.' };
  }
});

/* ---------------- n8n (Cloud) ----------------
 * 1) The n8n UI in its own native view with its own session (cookies stay apart from the app and the Spaces).
 * 2) The chat reaches n8n through n8n's instance-level MCP server; goose runs the OAuth login itself,
 *    so no token is written to config.yaml or any store of ours. */
const n8nStore = createN8nStore(join(ROOT, 'goose-home', 'n8n.json'));
let n8nView = null;
let n8nViewOrigin = '';
let n8nTheme = 'light';

/** Makes n8n render in the app's theme: its own light/dark follows prefers-color-scheme, which is emulated here. */
async function applyN8nTheme(view) {
  if (!view) return;
  const white = n8nTheme === 'light';
  try {
    view.setBackgroundColor(white ? '#ffffff' : '#171320');
    const contents = view.webContents;
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: n8nTheme }] });
  } catch {
    // Emulation is cosmetic: with DevTools attached or on an older build the page simply follows the system.
  }
}

function ensureN8nView(origin) {
  if (n8nView && n8nViewOrigin === origin) return n8nView;
  closeN8nView();
  const ses = session.fromPartition('persist:n8n');
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  const view = new WebContentsView({
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const contents = view.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url, origin)) setImmediate(() => contents.loadURL(url));
    else if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, origin)) return;
    event.preventDefault();
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
  });
  // The page can lead somewhere without a way back (for example a dashboard page): tell the app, so it can offer Back, Forward and Home.
  const sendNavState = () => {
    if (contents.isDestroyed()) return;
    mainWindow?.webContents.send('n8n-nav-state', { canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(), url: contents.getURL() });
  };
  contents.on('did-navigate', sendNavState);
  contents.on('did-navigate-in-page', sendNavState);
  mainWindow?.contentView.addChildView(view);
  view.setVisible(false);
  contents.once('did-start-loading', () => void applyN8nTheme(view));
  contents.loadURL(origin).catch(() => undefined);
  void applyN8nTheme(view);
  n8nView = view;
  n8nViewOrigin = origin;
  return view;
}

function closeN8nView() {
  if (!n8nView) return;
  try {
    mainWindow?.contentView.removeChildView(n8nView);
    if (n8nView.webContents.debugger.isAttached()) n8nView.webContents.debugger.detach();
    n8nView.webContents.close();
  } catch {
    // window already gone
  }
  n8nView = null;
  n8nViewOrigin = '';
}

function n8nChatConnected() {
  try {
    const doc = parseDocument(readFileSync(join(ROOT, 'goose-home/.config/goose/config.yaml'), 'utf8'));
    return doc.hasIn(['extensions', N8N_EXTENSION]);
  } catch {
    return false;
  }
}

ipcMain.handle('n8n-get-settings', () => ({ url: n8nStore.getUrl(), chatConnected: n8nChatConnected() }));

ipcMain.handle('n8n-save-settings', (_event, raw) => {
  try {
    const url = n8nStore.saveUrl(raw);
    if (!url || url !== n8nViewOrigin) closeN8nView();
    return { ok: true, url, chatConnected: n8nChatConnected() };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('n8n-show', (_event, bounds) => {
  const origin = n8nStore.getUrl();
  if (!origin || !mainWindow) return { ok: false };
  const number = (value) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  const view = ensureN8nView(origin);
  view.setBounds({ x: number(bounds?.x), y: number(bounds?.y), width: number(bounds?.width), height: number(bounds?.height) });
  view.setVisible(true);
  return { ok: true };
});

ipcMain.handle('n8n-hide', () => {
  n8nView?.setVisible(false);
  return { ok: true };
});

ipcMain.handle('n8n-set-theme', async (_event, theme) => {
  n8nTheme = theme === 'dark' ? 'dark' : 'light';
  await applyN8nTheme(n8nView);
  return { ok: true };
});

ipcMain.handle('n8n-back', () => {
  const history = n8nView?.webContents.navigationHistory;
  if (history?.canGoBack()) history.goBack();
  return { ok: true };
});

ipcMain.handle('n8n-forward', () => {
  const history = n8nView?.webContents.navigationHistory;
  if (history?.canGoForward()) history.goForward();
  return { ok: true };
});

/** Back to the start page of the configured instance, whatever page the view is on. */
ipcMain.handle('n8n-home', () => {
  if (n8nView && n8nViewOrigin) n8nView.webContents.loadURL(n8nViewOrigin).catch(() => undefined);
  return { ok: true };
});

ipcMain.handle('n8n-reload', () => {
  n8nView?.webContents.reload();
  return { ok: true };
});

/** Adds n8n as a goose extension. The user finishes with the OAuth consent in n8n on first use. */
ipcMain.handle('n8n-connect-chat', () => {
  const origin = n8nStore.getUrl();
  if (!origin) return { ok: false, detail: 'Zuerst die n8n-Adresse speichern.' };
  try {
    const path = join(ROOT, 'goose-home/.config/goose/config.yaml');
    const doc = parseDocument(readFileSync(path, 'utf8'));
    doc.setIn(['extensions', N8N_EXTENSION], n8nExtensionEntry(origin));
    writeFileSync(path, doc.toString(), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('n8n-disconnect-chat', () => {
  try {
    const path = join(ROOT, 'goose-home/.config/goose/config.yaml');
    const doc = parseDocument(readFileSync(path, 'utf8'));
    doc.deleteIn(['extensions', N8N_EXTENSION]);
    writeFileSync(path, doc.toString(), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
});

function allowOnlyAppMicrophone() {
  const appOrigin = new URL(DEV_URL).origin;
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    // Everything except the microphone keeps Electron's default (granted) so existing behaviour is unchanged.
    callback(permission === 'media' ? isAppAudioRequest({ permission, details, appOrigin }) : true);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) =>
    permission === 'media'
      ? isAppAudioRequest({ permission, details, appOrigin, requestingUrl: details?.requestingUrl ?? requestingOrigin })
      : true
  );
}

app.whenReady().then(() => {
  startGoosed();
  allowOnlyAppMicrophone();
  createWindow();
  const cold = process.argv.find((a) => a.startsWith('werkbank://'));
  if (cold) handleDeepLink(cold);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => goosed?.kill());
