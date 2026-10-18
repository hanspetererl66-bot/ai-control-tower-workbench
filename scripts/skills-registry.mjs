import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;
const MARKER = '.synced.json';
// Skills are instructions the agent follows, so refuse anything that looks like a credential.
const SECRET_LIKE = /(sb_secret_|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,})/;

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export function parseSkill(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new Error('SKILL.md needs a frontmatter block');
  const field = (key) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(match[1])?.[1].trim();
  const name = field('name');
  const description = field('description');
  if (!name || !description) throw new Error('frontmatter needs name and description');
  return { name, description };
}

/** Throws unless the SKILL.md is safe and consistent enough to publish or install. */
export function validateSkill(slug, text) {
  if (!SLUG.test(slug)) throw new Error(`invalid skill name "${slug}"`);
  const { name, description } = parseSkill(text);
  if (name !== slug) throw new Error(`frontmatter name "${name}" must equal the folder name "${slug}"`);
  if (description.length > 240) throw new Error(`${slug}: description is longer than 240 characters`);
  if (text.length > 20000) throw new Error(`${slug}: SKILL.md is longer than 20000 characters`);
  if (SECRET_LIKE.test(text)) throw new Error(`${slug}: contains something that looks like a credential`);
  return { description };
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
 * Pull approved skills into the agent's skills folder.
 * Only folders carrying a .synced.json marker are ever updated or removed; local skills are left alone
 * unless force is set.
 */
export async function syncSkills({ url, key, skillsDir, fetchImpl = fetch, force = false, log = () => {} }) {
  const list = await rpc({ url, key, fn: 'skills_list', fetchImpl });
  const result = { installed: [], updated: [], unchanged: [], skipped: [], removed: [] };
  mkdirSync(skillsDir, { recursive: true });
  const approved = new Set();

  for (const entry of list) {
    const { slug } = entry;
    if (!SLUG.test(slug)) {
      result.skipped.push(`${slug} (invalid name)`);
      continue;
    }
    approved.add(slug);
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

  // Remove synced skills that are no longer approved (retired or unpublished). Local skills have no marker.
  for (const dirent of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory() || approved.has(dirent.name)) continue;
    if (existsSync(join(skillsDir, dirent.name, MARKER))) {
      rmSync(join(skillsDir, dirent.name), { recursive: true, force: true });
      result.removed.push(dirent.name);
    }
  }
  return result;
}

/** Upload skill folders as drafts (unchanged ones create no new version). Never approves anything. */
export async function publishSkills({ url, key, dirs, owner = '', fetchImpl = fetch }) {
  const out = [];
  for (const dir of dirs) {
    const slug = dir.replace(/\/+$/, '').split('/').pop();
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const { description } = validateSkill(slug, text);
    const res = await rpc({
      url, key, fn: 'skills_publish', fetchImpl,
      args: { p_slug: slug, p_description: description, p_owner: owner, p_body: text },
    });
    out.push(res);
  }
  return out;
}

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
    if (Object.values(r).every((items) => !items.length)) console.log('No approved skills in the registry yet.');
    return;
  }
  const key = env('SUPABASE_SECRET_KEY');
  if (cmd === 'publish') {
    const base = join(ROOT, 'examples/skills');
    const names = rest.filter((a) => !a.startsWith('--'));
    const dirs = (names.length ? names : readdirSync(base)).map((n) => (n.includes('/') ? n : join(base, n)));
    for (const r of await publishSkills({ url, key, dirs, owner: process.env.SKILL_OWNER || '' })) {
      console.log(`${r.slug}: v${r.version} (${r.status})${r.changed ? '' : ' unchanged'}`);
    }
  } else if (cmd === 'approve' || cmd === 'retire') {
    if (!rest[0]) throw new Error(`Usage: skills ${cmd} <name>`);
    const r = await setStatus({ url, key, slug: rest[0], status: cmd === 'approve' ? 'approved' : 'retired' });
    console.log(`${r.slug}: ${r.status}`);
  } else if (cmd === 'list') {
    for (const s of await adminList({ url, key })) console.log(`${s.slug}\tv${s.version}\t${s.status}`);
  } else {
    throw new Error('Usage: skills-registry.mjs sync [--force] | publish [name…] | approve <name> | retire <name> | list');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
