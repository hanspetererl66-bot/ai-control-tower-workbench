#!/usr/bin/env node
/**
 * Connects every connector that lies in connectors/<name>/ (a folder with a manifest.json) to this checkout's Goose agent.
 * It looks at what is there every time it runs, so a new connector is picked up without a change to this script.
 *
 * For each connector it does what "Add a connector that comes with Werkbank" does in the app:
 *   1. stages the bundle (manifest, shared code, sample data) into goose-home/bundles/<name>
 *   2. writes the extension entry into goose-home/.config/goose/config.yaml (absolute paths; comments in the file stay)
 *   3. remembers the settings it needs in goose-home/connectors/<name>.json, so Configure works afterwards
 *
 * Safe to run again: new connectors are added, known ones get fresh files (so a changed tool list is picked up).
 * Settings you have entered (env values in config.yaml, secrets in Configure) and the on/off switch are kept.
 * Secrets are never written. A connector that needs a setting nobody has entered yet (for example the Jira site) is added
 * switched off, so the agent does not start a server that cannot work; --enable-unconfigured switches it on anyway.
 *
 *   node scripts/connect-connectors.mjs [--dry-run] [--only a,b] [--skip a,b] [--enable-unconfigured]
 *
 * Restart the app afterwards: the agent reads the extensions at start.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { BUNDLED_CONNECTORS, stageConnector } from '../connectors/_lib/bundle.mjs';
import { ALLOWED_COMMANDS } from '../electron/install-deep-link.mjs';
import { ensureGooseConfig } from '../shared/goose-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_REL = 'goose-home/.config/goose/config.yaml';
const NAME = /^[A-Za-z0-9._-]+$/;

/** Every folder under connectors/ that has a manifest.json (the shared library folder _lib is not a connector). */
export function discoverConnectors(sourceRoot = ROOT) {
  const dir = join(sourceRoot, 'connectors');
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && existsSync(join(dir, e.name, 'manifest.json')))
    .map((e) => e.name)
    .sort();
}

const fieldsOf = (userConfig = {}) =>
  Object.entries(userConfig).map(([key, spec]) => ({
    key,
    title: String(spec?.title ?? key).slice(0, 120),
    description: String(spec?.description ?? '').slice(0, 300),
    required: spec?.required === true,
    sensitive: spec?.sensitive === true,
    default: typeof spec?.default === 'string' ? spec.default : spec?.default != null ? String(spec.default) : '',
  }));

/** Stage like a .mcpb would look when extracted: the library connectors with their shared code, the others as manifest + server/. */
function stage(sourceRoot, id, target) {
  if (BUNDLED_CONNECTORS.includes(id) && sourceRoot === ROOT) return stageConnector(id, target);
  const source = join(sourceRoot, 'connectors', id);
  cpSync(join(source, 'manifest.json'), join(target, 'manifest.json'));
  if (existsSync(join(source, 'server'))) cpSync(join(source, 'server'), join(target, 'server'), { recursive: true });
  return target;
}

/**
 * @returns {{ name: string, status: 'added'|'refreshed'|'skipped'|'failed', enabled?: boolean, tools?: number, missing: string[], note?: string }[]}
 */
export function connectAll({ sourceRoot = ROOT, root = ROOT, only = [], skip = [], dryRun = false, enableUnconfigured = false } = {}) {
  const results = [];
  const configPath = join(root, CONFIG_REL);
  if (!dryRun) ensureGooseConfig(root);
  const config = existsSync(configPath) ? parseDocument(readFileSync(configPath, 'utf8')) : null;

  for (const id of discoverConnectors(sourceRoot)) {
    if ((only.length && !only.includes(id)) || skip.includes(id)) {
      results.push({ name: id, status: 'skipped', missing: [], note: 'not selected' });
      continue;
    }
    try {
      const manifest = JSON.parse(readFileSync(join(sourceRoot, 'connectors', id, 'manifest.json'), 'utf8'));
      const mcp = manifest?.server?.mcp_config;
      if (!mcp?.command || !ALLOWED_COMMANDS.has(mcp.command)) {
        results.push({ name: id, status: 'skipped', missing: [], note: `command "${mcp?.command}" is not allowed (allowed: ${[...ALLOWED_COMMANDS].join(', ')})` });
        continue;
      }
      const name = String(manifest.name ?? id).replace(/[^A-Za-z0-9._-]/g, '-');
      if (!NAME.test(name)) throw new Error('invalid connector name');
      const target = join(root, 'goose-home/bundles', name);
      const fields = fieldsOf(manifest.user_config);
      const existing = config?.getIn(['extensions', name])?.toJSON?.() ?? null;
      const specFile = join(root, 'goose-home/connectors', `${name}.json`);
      let spec = null;
      try { spec = JSON.parse(readFileSync(specFile, 'utf8')); } catch { /* none yet */ }

      // Values: what was entered before wins, then the default of the manifest; secrets are never written here.
      const sub = (s) => String(s).replace(/\$\{__dirname\}/g, target);
      const values = Object.fromEntries(fields.filter((f) => !f.sensitive).map((f) => [f.key, spec?.values?.[f.key] || f.default || '']));
      const plain = {};
      for (const [envVar, template] of Object.entries(mcp.env ?? {})) {
        const resolved = sub(template).replace(/\$\{user_config\.([a-z0-9_]+)\}/gi, (_m, key) => values[key] ?? '');
        if (resolved !== '') plain[envVar] = resolved;
      }
      const envs = { ...plain, ...(existing?.envs ?? {}) };

      // A required setting is missing when it has no value and no secret could hold it (secrets live in the encrypted store).
      const missing = fields.filter((f) => f.required && !f.sensitive && !values[f.key]).map((f) => f.key);
      const needsSecret = fields.filter((f) => f.required && f.sensitive).map((f) => f.key);
      const configured = missing.length === 0 && needsSecret.length === 0;
      const enabled = existing ? existing.enabled !== false : configured || enableUnconfigured;

      if (!dryRun) {
        rmSync(target, { recursive: true, force: true });
        mkdirSync(target, { recursive: true });
        stage(sourceRoot, id, target);
        mkdirSync(dirname(specFile), { recursive: true });
        writeFileSync(
          specFile,
          JSON.stringify({ fields, env: mcp.env ?? {}, source: 'mcpb', description: manifest.display_name ?? manifest.description ?? '', values }, null, 2),
          'utf8'
        );
        config.setIn(['extensions', name], { enabled, type: 'stdio', name, cmd: mcp.command, args: (mcp.args ?? []).map(sub), envs, timeout: existing?.timeout ?? 300 });
      }
      results.push({ name, status: existing ? 'refreshed' : 'added', enabled, tools: (manifest.tools ?? []).length, missing: [...missing, ...needsSecret] });
    } catch (e) {
      results.push({ name: id, status: 'failed', missing: [], note: e?.message ?? String(e) });
    }
  }
  if (!dryRun && config) writeFileSync(configPath, config.toString(), 'utf8');
  return results;
}

export function formatReport(results, { dryRun = false } = {}) {
  const lines = results.map((r) => {
    const state = r.status === 'skipped' || r.status === 'failed' ? r.status : `${r.status}${r.enabled === false ? ', switched off' : ', on'}`;
    const need = r.missing?.length ? `  needs: ${r.missing.join(', ')}` : '';
    return `  ${r.name.padEnd(22)} ${state.padEnd(24)}${r.tools != null ? `${String(r.tools).padStart(3)} tools` : '         '}${need}${r.note ? `  (${r.note})` : ''}`;
  });
  const off = results.filter((r) => r.enabled === false);
  return [
    `${dryRun ? 'Would connect' : 'Connected'} ${results.filter((r) => r.status === 'added' || r.status === 'refreshed').length} of ${results.length} connectors:`,
    ...lines,
    off.length ? `\n${off.length} switched off because a required setting is missing. Enter it in Connectors & Skills > Configure and switch the connector on (or run again with --enable-unconfigured).` : '',
    dryRun ? '\nDry run: nothing was written.' : '\nRestart the app: the agent reads the connectors at start.',
  ].filter(Boolean).join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const list = (flag) => (argv.includes(flag) ? String(argv[argv.indexOf(flag) + 1] ?? '').split(',').filter(Boolean) : []);
  const dryRun = argv.includes('--dry-run');
  const results = connectAll({ only: list('--only'), skip: list('--skip'), dryRun, enableUnconfigured: argv.includes('--enable-unconfigured') });
  console.log(formatReport(results, { dryRun }));
  if (results.some((r) => r.status === 'failed')) process.exit(1);
}
