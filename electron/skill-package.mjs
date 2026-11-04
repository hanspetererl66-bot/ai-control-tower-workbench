/**
 * Skill packages: a skill is a folder with a SKILL.md (plus optional scripts and reference files). To hand it on it is
 * packed into one .zip with the folder as its only top-level entry, `<slug>/SKILL.md` and so on. Pure Node, no
 * dependencies; the Electron main process only adds the file dialogs and the install directory.
 */
import { deflateRawSync, inflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SLUG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
export const LIMITS = { files: 100, fileBytes: 2 * 1024 * 1024, totalBytes: 8 * 1024 * 1024, zipBytes: 12 * 1024 * 1024 };
const SKIP = /^(\.|node_modules$|__pycache__$)/;

const crc = (buf) => (typeof zlibCrc32 === 'function' ? zlibCrc32(buf) >>> 0 : slowCrc(buf));
function slowCrc(buf) {
  let c = 0xffffffff;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}

/** Reads name and description from the SKILL.md frontmatter. */
export function parseFrontmatter(md) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const grab = (key) => {
    const m = fm ? new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm[1]) : null;
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  return { name: grab('name'), description: grab('description') };
}

/** All files of a skill folder (relative paths with forward slashes). Dotfiles, node_modules and symlinks are left out. */
export function collectSkillFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (SKIP.test(e.name)) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      const full = join(abs, e.name);
      if (lstatSync(full).isSymbolicLink()) continue;
      if (e.isDirectory()) walk(full, path);
      else if (e.isFile()) out.push({ path, data: readFileSync(full) });
    }
  };
  walk(dir, '');
  return out;
}

function check(files) {
  if (!files.some((f) => f.path === 'SKILL.md')) throw new Error('The folder has no SKILL.md.');
  if (files.length > LIMITS.files) throw new Error(`Too many files (${files.length}, at most ${LIMITS.files}).`);
  let total = 0;
  for (const f of files) {
    if (f.data.length > LIMITS.fileBytes) throw new Error(`${f.path} is larger than ${LIMITS.fileBytes >> 20} MB.`);
    total += f.data.length;
  }
  if (total > LIMITS.totalBytes) throw new Error(`The skill is larger than ${LIMITS.totalBytes >> 20} MB in total.`);
}

/** Packs files as `<slug>/<path>` (or without the folder when slug is empty), deflated. */
export function makeZip(slug, files, now = new Date()) {
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(slug ? `${slug}/${f.path}` : f.path, 'utf8');
    const raw = f.data;
    const packed = deflateRawSync(raw);
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;
    const sum = crc(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(sum, 16);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

const TEXT_FILE = /\.(md|txt|json|ya?ml|toml|csv|py|js|mjs|cjs|ts|sh|bash|sql|html|css)$/i;
/** The text files of a skill in one string (for the automatic review), cut at 200 KB. */
export function joinText(files) {
  return files.filter((f) => TEXT_FILE.test(f.path)).map((f) => `# ${f.path}\n${f.data.toString('utf8')}`).join('\n\n').slice(0, 200_000);
}
export const listOf = (files) => files.map((f) => ({ path: f.path, bytes: f.data.length }));

/** Packs a skill folder. Returns the zip, the list of files in it and their text. */
export function packSkill(slug, dir) {
  if (!SLUG.test(slug)) throw new Error('Unsupported skill folder name.');
  const files = collectSkillFiles(dir);
  check(files);
  return { zip: makeZip(slug, files), files: listOf(files), text: joinText(files) };
}

/** Reads the entries of a zip (stored or deflated). Throws on anything it does not understand. */
export function readZip(buf) {
  if (buf.length > LIMITS.zipBytes) throw new Error(`The file is larger than ${LIMITS.zipBytes >> 20} MB.`);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('This is not a zip file.');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count > LIMITS.files + 50) throw new Error('The package has too many entries.');
  const out = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('The zip is damaged.');
    const flags = buf.readUInt16LE(at + 8), method = buf.readUInt16LE(at + 10), sum = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20), usize = buf.readUInt32LE(at + 24);
    const nlen = buf.readUInt16LE(at + 28), xlen = buf.readUInt16LE(at + 30), clen = buf.readUInt16LE(at + 32);
    const lho = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nlen).toString('utf8');
    at += 46 + nlen + xlen + clen;
    if (flags & 1) throw new Error('Encrypted zips are not supported.');
    if (name.endsWith('/')) continue;
    if (usize > LIMITS.fileBytes) throw new Error(`${name} is larger than ${LIMITS.fileBytes >> 20} MB.`);
    total += usize;
    if (total > LIMITS.totalBytes) throw new Error(`The package is larger than ${LIMITS.totalBytes >> 20} MB unpacked.`);
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('The zip is damaged.');
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const body = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = inflateRawSync(body, { maxOutputLength: LIMITS.fileBytes });
    else throw new Error('Unsupported compression in the zip.');
    if (data.length !== usize || crc(data) !== sum) throw new Error(`${name} is damaged (checksum).`);
    out.push({ path: name, data });
  }
  return out;
}

/** A safe relative path: no absolute paths, no `..`, no drive letters, no backslashes, no hidden parts. */
export function safeRelative(path) {
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((p) => p && p !== '.' && p !== '..' && !SKIP.test(p));
}

/**
 * Checks a package and turns it into `{ slug, name, description, files }`. The skill may sit in one top-level folder
 * (what export writes) or directly in the zip root; the folder name or, at the root, the `name` in the frontmatter
 * becomes the skill's directory.
 */
export function openSkillPackage(buf) {
  const entries = readZip(buf).filter((e) => !e.path.startsWith('__MACOSX/') && !/(^|\/)\.DS_Store$/.test(e.path));
  if (!entries.length) throw new Error('The package is empty.');
  for (const e of entries) if (!safeRelative(e.path)) throw new Error(`Unsafe path in the package: ${e.path}`);
  const tops = new Set(entries.map((e) => e.path.split('/')[0]));
  const rooted = entries.some((e) => e.path === 'SKILL.md');
  let slug, files;
  if (rooted) {
    files = entries.map((e) => ({ path: e.path, data: e.data }));
    slug = '';
  } else if (tops.size === 1) {
    slug = [...tops][0];
    files = entries.map((e) => ({ path: e.path.slice(slug.length + 1), data: e.data }));
  } else throw new Error('The package must contain one skill folder with a SKILL.md.');
  check(files);
  const md = files.find((f) => f.path === 'SKILL.md').data.toString('utf8');
  const meta = parseFrontmatter(md);
  if (!meta.name) throw new Error('SKILL.md has no name in its frontmatter.');
  if (!slug) slug = meta.name;
  if (!SLUG.test(slug)) throw new Error(`“${slug}” is not a valid skill name (letters, digits, dot, dash, underscore).`);
  return { slug, name: meta.name, description: meta.description, files };
}
