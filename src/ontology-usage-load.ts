/**
 * Reads what the finder needs (registry cards, skills, spaces) and says honestly what it could and could not read.
 * Pure apart from the functions it is given: the window hands in the real ones (database, skills, spaces), tests hand in
 * fakes. Each source is read on its own; one failing never hides the others, and the result names what is missing.
 * Reads only. Nothing is written anywhere.
 */
import type { RItem } from './registry.ts';
import { sourcesFromRegister, sourcesFromSkills, sourcesFromSpaces, type Source } from './ontology-usage.ts';

export interface LoadDeps {
  /** The whole registry (`loadRegistry`), or undefined when there is no database. */
  registry?: () => Promise<RItem[]>;
  skills?: () => Promise<Array<{ name: string; description: string; dir: string }>>;
  readSkill?: (dir: string) => Promise<string>;
  spaces?: () => Promise<Array<{ slug: string; title: string; description: string; insights: readonly string[] }>>;
  readSpaceHtml?: (slug: string) => Promise<string>;
}

export type SourceName = 'registry' | 'skills' | 'spaces';
export interface LoadNote { source: SourceName; status: 'ok' | 'partial' | 'failed' | 'missing'; read: number; of: number; detail: string }
export interface Loaded { sources: Source[]; notes: LoadNote[] }

export const MAX_SKILL_TEXTS = 200;
export const MAX_SPACE_PAGES = 100;
const PARALLEL = 4;
const msg = (e: unknown) => String((e as { message?: unknown })?.message ?? e).slice(0, 160);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '-', ndash: '-', hellip: '...' };

/** The text a person would read on a Space page, plus the strings of its embedded JSON data. No script, no style, no markup. */
export function htmlToText(html: string): string {
  const strings: string[] = [];
  const collect = (v: unknown, depth: number) => {
    if (depth > 6 || strings.length > 4000) return;
    if (typeof v === 'string') { if (v.trim().length >= 3) strings.push(v.trim()); }
    else if (Array.isArray(v)) v.forEach((x) => collect(x, depth + 1));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => collect(x, depth + 1));
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collect(JSON.parse(m[1]), 0); } catch { /* not valid JSON: skip this block */ }
  }
  const page = html
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (_m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? ' '));
  return `${page} ${strings.join(' · ')}`.replace(/\s+/g, ' ').trim();
}

/** Runs `fn` over the items a few at a time; returns how many worked and what the first error said. */
async function each<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<{ ok: number; failed: number; first: string }> {
  let next = 0, ok = 0, failed = 0, first = '';
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      try { await fn(items[i]); ok++; } catch (e) { failed++; first = first || msg(e); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  return { ok, failed, first };
}

export async function loadUsageSources(deps: LoadDeps): Promise<Loaded> {
  const sources: Source[] = [];
  const notes: LoadNote[] = [];

  if (!deps.registry) notes.push({ source: 'registry', status: 'missing', read: 0, of: 0, detail: 'No connection to the shared database: the registry was not read.' });
  else {
    try { const items = await deps.registry(); sources.push(...sourcesFromRegister(items)); notes.push({ source: 'registry', status: 'ok', read: items.length, of: items.length, detail: '' }); }
    catch (e) { notes.push({ source: 'registry', status: 'failed', read: 0, of: 0, detail: `The registry could not be read: ${msg(e)}` }); }
  }

  if (!deps.skills) notes.push({ source: 'skills', status: 'missing', read: 0, of: 0, detail: 'Skills are not available here.' });
  else {
    try {
      const list = await deps.skills();
      const texts: Record<string, string> = {};
      let result = { ok: list.length, failed: 0, first: '' };
      if (deps.readSkill) {
        const read = deps.readSkill;
        result = await each(list.slice(0, MAX_SKILL_TEXTS), async (s) => { texts[s.dir] = await read(s.dir); });
      }
      sources.push(...sourcesFromSkills(list, texts));
      const of = Math.min(list.length, MAX_SKILL_TEXTS);
      notes.push({ source: 'skills', status: result.failed ? 'partial' : 'ok', read: result.ok, of: list.length,
        detail: result.failed ? `${result.failed} skill texts could not be read (${result.first}).` : list.length > of ? `Only the texts of the first ${of} skills were read.` : '' });
    } catch (e) { notes.push({ source: 'skills', status: 'failed', read: 0, of: 0, detail: `Skills could not be read: ${msg(e)}` }); }
  }

  if (!deps.spaces) notes.push({ source: 'spaces', status: 'missing', read: 0, of: 0, detail: 'Spaces are not available here.' });
  else {
    try {
      const list = await deps.spaces();
      const texts: Record<string, string> = {};
      let result = { ok: list.length, failed: 0, first: '' };
      if (deps.readSpaceHtml) {
        const read = deps.readSpaceHtml;
        result = await each(list.slice(0, MAX_SPACE_PAGES), async (s) => { texts[s.slug] = htmlToText(await read(s.slug)); });
      }
      sources.push(...sourcesFromSpaces(list, texts));
      notes.push({ source: 'spaces', status: result.failed ? 'partial' : 'ok', read: result.ok, of: list.length,
        detail: result.failed ? `${result.failed} pages could not be read (${result.first}).` : list.length > MAX_SPACE_PAGES ? `Only the pages of the first ${MAX_SPACE_PAGES} Spaces were read.` : '' });
    } catch (e) { notes.push({ source: 'spaces', status: 'failed', read: 0, of: 0, detail: `Spaces could not be read: ${msg(e)}` }); }
  }
  return { sources, notes };
}
