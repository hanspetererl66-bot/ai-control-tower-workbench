/**
 * Saving a designed Space. The dev server gives this function a small view of the Spaces folder; the function
 * decides what is written. Pure, so the rules are tested without a server:
 * - the layout is checked again, the page is generated here (the browser never sends HTML);
 * - a Space the Designer did not make is never overwritten, even when its folder name is given;
 * - a new Space gets a free folder name made from its title;
 * - fields of an existing space.json that the Designer does not know (domain, parent, insights) are kept.
 */
import { layoutSummary, normalizeLayout, slugFromTitle } from './space-layout.ts';
import { isDesignedPage, renderSpacePage } from './space-layout-render.ts';

export type SpaceFiles = {
  slugs(): string[];
  read(slug: string, file: 'index.html' | 'space.json'): string | null;
  write(slug: string, file: 'index.html' | 'space.json', content: string): void;
};

export type SaveRequest = { slug?: unknown; title?: unknown; description?: unknown; domain?: unknown; layout?: unknown; asNew?: unknown };
export type SaveResult = { slug: string; title: string; created: boolean; notes: string[] };

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;

function freeSlug(base: string, taken: string[]): string {
  const used = new Set(taken.map((s) => s.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i += 1) {
    const next = `${base.slice(0, 55)}-${i}`;
    if (!used.has(next.toLowerCase())) return next;
  }
  throw new Error('There are too many Spaces with this name.');
}

export function saveDesignedSpace(files: SpaceFiles, css: string, request: SaveRequest): SaveResult {
  const notes: string[] = [];
  const title = (typeof request.title === 'string' ? request.title : '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled Space';
  const layout = normalizeLayout(request.layout, notes);
  const slugs = files.slugs();

  let slug = typeof request.slug === 'string' ? request.slug : '';
  let created = false;
  if (slug && request.asNew !== true) {
    if (!SLUG.test(slug)) throw new Error('The Space name is not valid.');
    const existing = files.read(slug, 'index.html');
    if (existing === null) throw new Error('This Space does not exist any more.');
    if (!isDesignedPage(existing)) throw new Error('This Space was not made in the Designer, so the Designer will not overwrite it. Save it as a new Space instead.');
  } else {
    slug = freeSlug(slugFromTitle(title), slugs);
    created = true;
  }

  let meta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(files.read(slug, 'space.json') ?? '');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
  } catch { /* new Space */ }
  const description = typeof request.description === 'string' && request.description.trim() ? request.description.replace(/\s+/g, ' ').trim().slice(0, 300) : typeof meta.description === 'string' && meta.description ? meta.description : layoutSummary(layout);
  const next: Record<string, unknown> = { ...meta, title, description };
  if (typeof request.domain === 'string' && request.domain.trim()) next.domain = request.domain.trim().slice(0, 30);
  if (!Array.isArray(next.insights)) next.insights = [];
  if (typeof next.prompt !== 'string') next.prompt = 'Designed in the Space Designer.';

  files.write(slug, 'index.html', renderSpacePage({ title, layout, css }));
  files.write(slug, 'space.json', JSON.stringify(next, null, 2));
  return { slug, title, created, notes };
}
