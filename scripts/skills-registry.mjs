import { createHash } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;
const MARKER = '.synced.json';
// Skills are instructions the agent follows, so refuse anything that looks like a credential.
const SECRET_LIKE = /(sb_secret_|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,})/;

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export const DOMAINS = ['Governance & Risiko', 'Service & Support', 'Finanzen', 'HR', 'Entwicklung', 'Betrieb', 'Sonstiges'];
export const DATA_CLASSES = ['öffentlich', 'intern', 'vertraulich'];
/** Quality ladder shown in the catalog. 'approved' is the official review and is only set with `approve --by`. */
export const MATURITIES = ['pilot', 'empfohlen', 'approved'];
export const BOARD_AREAS = ['Finance', 'Sales', 'Marketing', 'Engineering'];
/** LOB -> board area it belongs to. */
export const LOBS = { BTP: 'Engineering', Concur: 'Engineering', SuccessFactors: 'Engineering' };
/** Reach of a skill, narrow to wide. A skill starts as 'individual' and is promoted by review. */
export const SCOPES = ['individual', 'team', 'lob', 'board-area', 'company'];

/** Anonymous id of this machine for the usage counters (hash only, no name or address leaves the machine). */
export function deviceId() {
  let user = '';
  try { user = userInfo().username; } catch { /* no user database */ }
  return sha256(`werkbank|${hostname()}|${user}`).slice(0, 16);
}

/** Best-effort usage counter; never fails the caller. */
export async function trackSkills({ url, key, slugs, event, device = deviceId(), fetchImpl = fetch }) {
  if (!slugs.length) return false;
  try {
    await rpc({ url, key, fn: 'skills_track', args: { p_slugs: slugs, p_event: event, p_device: device }, fetchImpl });
    return true;
  } catch {
    return false;
  }
}

/** Names of all tools the bundled connectors offer (from their manifests). */
export function knownTools(root = ROOT) {
  const dir = join(root, 'connectors');
  const names = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const manifest = join(dir, entry.name, 'manifest.json');
    if (entry.isDirectory() && existsSync(manifest)) {
      for (const tool of JSON.parse(readFileSync(manifest, 'utf8')).tools ?? []) names.add(tool.name);
    }
  }
  return names;
}

/** Reads name, description and the optional `metadata:` block (one level, "key: value" lines). */
export function parseSkill(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new Error('SKILL.md needs a frontmatter block');
  const field = (key) => new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(match[1])?.[1].trim();
  const name = field('name');
  const description = field('description');
  if (!name || !description) throw new Error('frontmatter needs name and description');
  const raw = {};
  const block = /^metadata:[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$))+)/m.exec(match[1]);
  if (block) {
    for (const line of block[1].split(/\r?\n/)) {
      const kv = /^[ \t]+([a-z-]+):[ \t]*(.*)$/.exec(line);
      if (kv) raw[kv[1].replace(/-/g, '_')] = kv[2].trim();
    }
  }
  const meta = { ...raw };
  meta.tools = raw.tools ? raw.tools.split(',').map((t) => t.trim()).filter(Boolean) : [];
  return { name, description, meta };
}

/** Throws unless the SKILL.md is safe and consistent enough to publish or install. */
export function validateSkill(slug, text, { tools } = {}) {
  if (!SLUG.test(slug)) throw new Error(`invalid skill name "${slug}"`);
  const { name, description, meta } = parseSkill(text);
  if (name !== slug) throw new Error(`frontmatter name "${name}" must equal the folder name "${slug}"`);
  if (description.length > 240) throw new Error(`${slug}: description is longer than 240 characters`);
  if (text.length > 20000) throw new Error(`${slug}: SKILL.md is longer than 20000 characters`);
  if (SECRET_LIKE.test(text)) throw new Error(`${slug}: contains something that looks like a credential`);
  if (meta.domain && !DOMAINS.includes(meta.domain)) throw new Error(`${slug}: domain must be one of ${DOMAINS.join(', ')}`);
  if (meta.data_class && !DATA_CLASSES.includes(meta.data_class)) throw new Error(`${slug}: data-class must be one of ${DATA_CLASSES.join(', ')}`);
  if (meta.board_area && !BOARD_AREAS.includes(meta.board_area)) throw new Error(`${slug}: board-area must be one of ${BOARD_AREAS.join(', ')}`);
  if (meta.lob) {
    if (!LOBS[meta.lob]) throw new Error(`${slug}: lob must be one of ${Object.keys(LOBS).join(', ')}`);
    if (meta.board_area && meta.board_area !== LOBS[meta.lob]) throw new Error(`${slug}: lob ${meta.lob} belongs to ${LOBS[meta.lob]}, not ${meta.board_area}`);
  }
  if (meta.scope && !SCOPES.includes(meta.scope)) throw new Error(`${slug}: scope must be one of ${SCOPES.join(', ')}`);
  if (meta.scope === 'team' && !meta.team) throw new Error(`${slug}: scope team needs a team`);
  if (meta.scope === 'lob' && !meta.lob) throw new Error(`${slug}: scope lob needs a lob`);
  if (meta.scope === 'board-area' && !meta.board_area && !meta.lob) throw new Error(`${slug}: scope board-area needs a board-area`);
  if (tools) {
    const unknown = meta.tools.filter((t) => !tools.has(t));
    if (unknown.length) throw new Error(`${slug}: unknown connector tool(s): ${unknown.join(', ')}`);
  }
  return { description, meta };
}

export async function rpc({ url, key, fn, args = {}, fetchImpl = fetch }) {
  const res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} failed (${res.status}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Pull published skills into the agent's skills folder.
 * Only folders carrying a .synced.json marker are ever updated or removed; local skills are left alone
 * unless force is set.
 */
export async function syncSkills({ url, key, skillsDir, fetchImpl = fetch, force = false, log = () => {} }) {
  const list = await rpc({ url, key, fn: 'skills_list', fetchImpl });
  const result = { installed: [], updated: [], unchanged: [], skipped: [], removed: [] };
  mkdirSync(skillsDir, { recursive: true });
  const published = new Set();

  for (const entry of list) {
    const { slug } = entry;
    if (!SLUG.test(slug)) {
      result.skipped.push(`${slug} (invalid name)`);
      continue;
    }
    published.add(slug);
    const dir = join(skillsDir, slug);
    const markerPath = join(dir, MARKER);
    const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null;
    if (existsSync(dir) && !marker && !force) {
      result.skipped.push(`${slug} (a local skill with this name exists, use --force to replace it)`);
      continue;
    }
    if (marker && marker.sha256 === entry.sha256 && marker.version === entry.version) {
      result.unchanged.push(slug);
      continue;
    }
    const full = await rpc({ url, key, fn: 'skills_get', args: { p_slug: slug }, fetchImpl });
    if (!full || sha256(full.body) !== entry.sha256 || full.sha256 !== entry.sha256) {
      result.skipped.push(`${slug} (checksum mismatch)`);
      continue;
    }
    try {
      validateSkill(slug, full.body);
    } catch (error) {
      result.skipped.push(`${slug} (${error.message})`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), full.body);
    writeFileSync(markerPath, JSON.stringify({ source: 'supabase', version: full.version, sha256: full.sha256 }, null, 2) + '\n');
    (marker ? result.updated : result.installed).push(`${slug}@v${full.version}`);
    log(`${slug} v${full.version}`);
  }
  await trackSkills({ url, key, slugs: [...result.installed, ...result.updated].map((entry) => entry.split('@')[0]), event: 'install', fetchImpl });

  // Remove synced skills that are no longer published (retired or withdrawn). Local skills have no marker.
  for (const dirent of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory() || published.has(dirent.name)) continue;
    if (existsSync(join(skillsDir, dirent.name, MARKER))) {
      rmSync(join(skillsDir, dirent.name), { recursive: true, force: true });
      result.removed.push(dirent.name);
    }
  }
  return result;
}

/**
 * Upload skill folders as drafts (unchanged ones create no new version). Never approves anything.
 * Before uploading, similar existing skills are looked up; if one is similar the author must say why
 * a new skill is needed (`reason`) or mark it as a variant (`variantOf`), otherwise the skill is not uploaded.
 */
export async function publishSkills({ url, key, dirs, owner = '', reason = '', variantOf = '', tools = knownTools(), fetchImpl = fetch }) {
  const out = [];
  for (const dir of dirs) {
    const slug = dir.replace(/\/+$/, '').split('/').pop();
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const { description, meta } = validateSkill(slug, text, { tools });
    const effective = { ...meta };
    if (variantOf) effective.variant_of = variantOf;
    if (reason) effective.variant_reason = reason;
    const similar = await rpc({
      url, key, fn: 'skills_similar', fetchImpl,
      args: { p_slug: slug, p_description: description, p_domain: effective.domain || 'Sonstiges', p_tools: effective.tools },
    });
    const close = similar.filter((entry) => entry.similar);
    if (close.length && !effective.variant_of && !effective.variant_reason) {
      out.push({ slug, blocked: true, similar: close });
      continue;
    }
    const res = await rpc({
      url, key, fn: 'skills_publish', fetchImpl,
      args: { p_slug: slug, p_description: description, p_owner: owner, p_body: text, p_meta: effective },
    });
    out.push(close.length ? { ...res, similar: close } : res);
  }
  return out;
}

export const setMaturity = ({ url, key, slug, maturity, fetchImpl = fetch }) =>
  rpc({ url, key, fn: 'skills_set_maturity', args: { p_slug: slug, p_maturity: maturity }, fetchImpl });

export const approveSkill = ({ url, key, slug, by, fetchImpl = fetch }) =>
  rpc({ url, key, fn: 'skills_approve', args: { p_slug: slug, p_by: by }, fetchImpl });

export const setStatus = ({ url, key, slug, status, fetchImpl = fetch }) =>
  rpc({ url, key, fn: 'skills_set_status', args: { p_slug: slug, p_status: status }, fetchImpl });

export const adminList = ({ url, key, fetchImpl = fetch }) => rpc({ url, key, fn: 'skills_admin_list', fetchImpl });

// ---------------- CLI ----------------
function env(name, fallback) {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!value) throw new Error(`Set ${name}${fallback ? ` (or ${fallback})` : ''} first.`);
  return value;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const url = env('SUPABASE_URL');
  if (cmd === 'sync') {
    const force = rest.includes('--force');
    const skillsDir = process.env.SKILLS_DIR || join(ROOT, 'goose-home/.agents/skills');
    const r = await syncSkills({ url, key: env('SUPABASE_KEY', 'SUPABASE_PUBLISHABLE_KEY'), skillsDir, force });
    for (const [label, items] of Object.entries(r)) if (items.length) console.log(`${label}: ${items.join(', ')}`);
    if (Object.values(r).every((items) => !items.length)) console.log('No published skills in the registry yet.');
    return;
  }
  const key = env('SUPABASE_SECRET_KEY');
  if (cmd === 'publish') {
    const base = join(ROOT, 'examples/skills');
    const flag = (name) => {
      const i = rest.indexOf(`--${name}`);
      return i >= 0 ? rest[i + 1] ?? '' : '';
    };
    const valueIdx = new Set(['--reason', '--variant-of'].flatMap((f) => (rest.includes(f) ? [rest.indexOf(f) + 1] : [])));
    const names = rest.filter((a, i) => !a.startsWith('--') && !valueIdx.has(i));
    const dirs = (names.length ? names : readdirSync(base)).map((n) => (n.includes('/') ? n : join(base, n)));
    const results = await publishSkills({ url, key, dirs, owner: process.env.SKILL_OWNER || '', reason: flag('reason'), variantOf: flag('variant-of') });
    let blocked = 0;
    for (const r of results) {
      if (r.blocked) {
        blocked += 1;
        console.log(`${r.slug}: NOT published. Similar skills already exist:`);
      } else {
        console.log(`${r.slug}: v${r.version} (${r.status})${r.changed ? '' : ' unchanged'}`);
        if (r.similar) console.log('  note: similar skills exist, published with your reason:');
      }
      for (const s of r.similar ?? []) {
        console.log(`  - ${s.slug} (${s.status}, ${s.domain || 'ohne Domäne'}, ${s.team || 'ohne Team'}) gemeinsame Werkzeuge: ${s.sharedTools.join(', ') || 'keine'}`);
      }
      if (r.blocked) console.log(`  Prüfe, ob du den Skill erweitern kannst. Sonst: --variant-of <name> oder --reason "neu weil …"`);
    }
    if (blocked) process.exitCode = 2;
  } else if (cmd === 'release' || cmd === 'retire') {
    if (!rest[0]) throw new Error(`Usage: skills ${cmd} <name>`);
    const r = await setStatus({ url, key, slug: rest[0], status: cmd === 'release' ? 'published' : 'retired' });
    console.log(`${r.slug}: ${r.status}`);
  } else if (cmd === 'approve') {
    const by = rest.includes('--by') ? rest[rest.indexOf('--by') + 1] : process.env.SKILL_APPROVER;
    if (!rest[0] || rest[0].startsWith('--') || !by) throw new Error('Usage: skills approve <name> --by "Name" (or set SKILL_APPROVER). The skill must be published (release) first.');
    const r = await approveSkill({ url, key, slug: rest[0], by });
    console.log(`${r.slug}: approved by ${r.approvedBy} (v${r.version})`);
  } else if (cmd === 'recommend' || cmd === 'unrecommend') {
    if (!rest[0]) throw new Error(`Usage: skills ${cmd} <name>`);
    const r = await setMaturity({ url, key, slug: rest[0], maturity: cmd === 'recommend' ? 'empfohlen' : 'pilot' });
    console.log(`${r.slug}: ${r.maturity}`);
  } else if (cmd === 'list') {
    for (const s of await adminList({ url, key })) console.log(`${s.slug}\tv${s.version}\t${s.status}\t${s.maturity}${s.approvedBy ? ` (${s.approvedBy})` : ''}\t${s.domain ?? ''}`);
  } else {
    throw new Error('Usage: skills-registry.mjs sync [--force] | publish [name…] [--variant-of x] [--reason y] | release|retire|recommend|unrecommend <name> | approve <name> --by "Name" | list');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
