/**
 * Space package: one JSON file that carries a Space (index.html and space.json) so it can be e-mailed and
 * imported into another Werkbank. Pure functions, used by the dev server and the tests.
 */
export const PACKAGE_FORMAT = 'werkbank-space';
export const PACKAGE_VERSION = 1;
export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;
export const SLUG = /^[a-z0-9][a-z0-9._-]{0,59}$/i;
const FILES = ['index.html', 'space.json'];

export function buildSpacePackage({ slug, title, files, now = new Date() }) {
  if (!SLUG.test(slug)) throw new Error('invalid Space name');
  if (typeof files?.['index.html'] !== 'string' || !files['index.html'].trim()) throw new Error('the Space has no index.html');
  const out = { 'index.html': files['index.html'] };
  if (typeof files['space.json'] === 'string') out['space.json'] = files['space.json'];
  return { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, slug, title: String(title ?? slug).slice(0, 120), exportedAt: now.toISOString(), files: out };
}

/** Parse and validate a package. Throws an Error with a message a person can read. */
export function parseSpacePackage(text) {
  if (typeof text !== 'string' || text.length > MAX_PACKAGE_BYTES) throw new Error('The file is too large for a Space (limit 5 MB).');
  let pkg;
  try { pkg = JSON.parse(text); } catch { throw new Error('This is not a Werkbank Space file.'); }
  if (!pkg || pkg.format !== PACKAGE_FORMAT) throw new Error('This is not a Werkbank Space file.');
  if (pkg.version !== PACKAGE_VERSION) throw new Error('This Space file comes from a newer Werkbank version.');
  if (typeof pkg.slug !== 'string' || !SLUG.test(pkg.slug)) throw new Error('The Space name in the file is not valid.');
  const files = pkg.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('The file contains no Space.');
  for (const name of Object.keys(files)) if (!FILES.includes(name)) throw new Error(`Unexpected file in the package: ${name}`);
  const html = files['index.html'];
  if (typeof html !== 'string' || !html.trim()) throw new Error('The file contains no Space page.');
  // Spaces run in a sandbox without network. A page that loads code or frames from outside is not a Space we want to install.
  if (/<(script|iframe|embed|object)\b[^>]*\b(src|data)\s*=\s*["']?\s*(https?:)?\/\//i.test(html) || /<link\b[^>]*\bhref\s*=\s*["']?\s*(https?:)?\/\//i.test(html)) {
    throw new Error('The Space loads content from the internet, which Spaces do not allow.');
  }
  let meta = null;
  if (files['space.json'] !== undefined) {
    if (typeof files['space.json'] !== 'string') throw new Error('space.json in the package is invalid.');
    try { meta = JSON.parse(files['space.json']); } catch { throw new Error('space.json in the package is invalid.'); }
  }
  const title = typeof meta?.title === 'string' && meta.title.trim() ? meta.title.trim().slice(0, 120) : pkg.slug;
  return { slug: pkg.slug, title, files: { 'index.html': html, ...(meta ? { 'space.json': files['space.json'] } : {}) } };
}

/** `slug`, or `slug-2`, `slug-3` … when taken. */
export function uniqueSlug(slug, existing) {
  const taken = new Set(existing);
  if (!taken.has(slug)) return slug;
  for (let i = 2; i < 100; i += 1) {
    const next = `${slug.slice(0, 55)}-${i}`;
    if (!taken.has(next)) return next;
  }
  throw new Error('too many copies of this Space');
}

export const packageFileName = (slug) => `${slug}.werkbank-space.json`;
