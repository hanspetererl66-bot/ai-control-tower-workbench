/**
 * Source registry and license gate for the knowledge feeder.
 * The registry (sources/registry.json) decides what software may fetch and store. Nothing here reads a flag or an
 * environment variable to widen a status: a source is collected only if its status says so.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STATUSES = ['allowed', 'metadata_only', 'needs_review', 'blocked'];
export const KINDS = ['git-org', 'git-repo', 'feed', 'page'];
/** The only licenses whose full text may be fetched and stored. Share-alike, unknown or missing ones are skipped. */
export const ALLOWED_LICENSES = Object.freeze(['CC-BY-4.0', 'Apache-2.0', 'MIT']);

export class SourceBlockedError extends Error {
  constructor(source, why) {
    super(`Source ${source.id} is ${source.status}: ${why ?? source.reason}`);
    this.name = 'SourceBlockedError';
    this.sourceId = source.id;
    this.status = source.status;
    this.reason = source.reason;
  }
}

const REQUIRED = ['id', 'title', 'owner', 'url', 'kind', 'license', 'terms_url', 'status', 'reason', 'attribution_text', 'dataset', 'id_prefix', 'checked_on'];

/** Checks the registry against the rules of sources/registry.schema.json (no schema library; the rules are few). Returns a list of problems. */
export function validateRegistry(reg) {
  const problems = [];
  if (!reg || typeof reg !== 'object' || reg.version !== 1 || !Array.isArray(reg.sources)) return ['registry must be {version: 1, sources: []}'];
  const ids = new Set();
  const prefixes = new Set();
  for (const s of reg.sources) {
    const at = `source ${s?.id ?? '?'}`;
    for (const k of REQUIRED) if (typeof s?.[k] !== 'string') problems.push(`${at}: ${k} is missing`);
    if (typeof s?.id !== 'string') continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(s.id)) problems.push(`${at}: id must be lowercase letters, digits and dashes`);
    if (ids.has(s.id)) problems.push(`${at}: duplicate id`);
    ids.add(s.id);
    if (prefixes.has(s.id_prefix)) problems.push(`${at}: duplicate id_prefix ${s.id_prefix}`);
    prefixes.add(s.id_prefix);
    if (!STATUSES.includes(s.status)) problems.push(`${at}: status must be one of ${STATUSES.join(', ')}`);
    if (!KINDS.includes(s.kind)) problems.push(`${at}: kind must be one of ${KINDS.join(', ')}`);
    if (!/^https:\/\//.test(s.url ?? '')) problems.push(`${at}: url must be https`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.checked_on ?? '')) problems.push(`${at}: checked_on must be YYYY-MM-DD`);
    if ((s.status === 'allowed' || s.status === 'metadata_only') && !s.dataset) problems.push(`${at}: a collectable source needs a dataset`);
    if (s.status === 'allowed' && !s.attribution_text) problems.push(`${at}: an allowed source needs an attribution_text`);
    if (s.status === 'allowed' && !['git-org', 'git-repo'].includes(s.kind)) problems.push(`${at}: only git sources may be allowed (full text)`);
    if (s.status === 'metadata_only' && s.kind !== 'feed') problems.push(`${at}: only feeds may be metadata_only`);
    if (s.kind === 'page' && !['blocked', 'needs_review'].includes(s.status)) problems.push(`${at}: page sources must be blocked or needs_review`);
  }
  return problems;
}

export function loadRegistry(file = join(ROOT, 'sources', 'registry.json')) {
  const reg = JSON.parse(readFileSync(file, 'utf8'));
  const problems = validateRegistry(reg);
  if (problems.length) throw new Error(`Invalid source registry:\n- ${problems.join('\n- ')}`);
  return reg;
}

export const sourceById = (reg, id) => reg.sources.find((s) => s.id === id) ?? null;

/**
 * The gate. `mode` is what the collector wants to do: 'full-text' (git sources) or 'metadata' (feeds).
 * Blocked and needs_review sources are refused for both; a metadata_only source is refused for full text.
 * @returns the source, or throws SourceBlockedError
 */
export function assertCollectable(source, mode) {
  if (!source || typeof source !== 'object') throw new Error('Unknown source.');
  if (source.status === 'blocked') throw new SourceBlockedError(source);
  if (source.status === 'needs_review') throw new SourceBlockedError(source, `needs review before anything is fetched: ${source.reason}`);
  if (mode === 'full-text' && source.status !== 'allowed') throw new SourceBlockedError(source, `only metadata may be stored, not full text. ${source.reason}`);
  if (mode === 'metadata' && source.status !== 'metadata_only') throw new SourceBlockedError(source, `this collector is for metadata_only feeds; status is ${source.status}`);
  if (mode !== 'full-text' && mode !== 'metadata') throw new Error(`Unknown mode ${mode}.`);
  return source;
}

/** Stub for sources that must not be touched: always throws, with the registry's reason. */
export function blockedCollector(source) {
  throw new SourceBlockedError(source);
}

/** Decision for one repository from the license GitHub detected (SPDX id, or null / NOASSERTION). */
export function licenseDecision(spdx) {
  const id = typeof spdx === 'string' ? spdx : null;
  if (id && ALLOWED_LICENSES.includes(id)) return { ok: true, license: id };
  if (id && /^(CC-BY-SA|CC-BY-NC|CC-BY-ND|GPL|AGPL|LGPL|SSPL|EUPL|MPL|CC-BY-NC-SA)/i.test(id)) return { ok: false, license: id, status: 'needs_review', why: `${id} is a share-alike or restricted license` };
  if (!id || id === 'NOASSERTION' || id === 'other') return { ok: false, license: id ?? 'unknown', status: 'needs_review', why: 'no license detected' };
  return { ok: false, license: id, status: 'needs_review', why: `${id} is not on the allowed list (${ALLOWED_LICENSES.join(', ')})` };
}

const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
export const attributionFor = (source, vars) => fill(source.attribution_text, { title: source.title, license: source.license, url: source.url, ...vars }).replace(/\s+/g, ' ').trim();
