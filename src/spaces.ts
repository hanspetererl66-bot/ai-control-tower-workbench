export type Space = {
  slug: string;
  title: string;
  description: string;
  insights: string[];
  /** Optional group named in space.json; the person can override it. */
  domain?: string;
  /** Optional slug of the Space this one belongs to (a subspace); the person can override it. */
  parent?: string;
  cardCount: number;
  updatedAt: number;
};

export async function listSpaces(): Promise<Space[]> {
  try {
    const res = await fetch('/__spaces', { cache: 'no-store' });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

/**
 * Fetched here and handed to the iframe as `srcdoc` rather than set as `src`.
 * A sandboxed frame loads network URLs with `Origin: null`, which vite's dev
 * server rejects — the frame renders blank. Fetching from the app (a normal
 * same-origin request) and injecting the markup avoids that, and srcdoc content
 * still gets an opaque origin, so the page cannot reach this window.
 * The bust param is unused by the server; it just defeats the fetch cache.
 */
export async function fetchSpaceHtml(slug: string, bust: number): Promise<string> {
  const res = await fetch(`/__spaces/${encodeURIComponent(slug)}/index.html?v=${bust}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`space ${slug}: ${res.status}`);
  return res.text();
}

export function relativeTime(ms: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * The contract the agent has to follow to produce a Space. Sent as part of the
 * prompt rather than living in a skill, so the convention travels with the app.
 */
export const SPACE_BRIEF = `Create a "Space" — a persistent visual dashboard — in the folder
spaces/<slug>/ under your working directory, where <slug> is short and kebab-case.

Write exactly two files:

1. spaces/<slug>/index.html — a SELF-CONTAINED page. All CSS and JS inline; no
   external requests of any kind (no CDNs, no web fonts, no remote images) — it is
   rendered in a sandboxed iframe with no network. Draw charts as inline SVG you
   generate yourself from the data. Match the Werkbank visual system: a #f4f4f7
   canvas with white cards; system typography; text #1c1c1e; muted #6b7280;
   #e6e6ec borders; 12px card corners; restrained shadows; and #6d28d9 for
   primary chart marks. Keep content dense and board-ready. Give every top-level
   visual card the exact class "card" so the
   desktop can report the real card count. Start with a single bordered KPI card,
   then insight/table and chart cards separated by 18px. Do not add a second page
   title inside the Space
   because the desktop chrome already shows it. No <html>/<head>/<body> wrapper
   is needed but is allowed.

2. spaces/<slug>/space.json — {"title": "...", "description": "one sentence",
   "insights": ["3-6 short findings, each one sentence, most important first"],
   "prompt": "<the request that produced this space>"}

   This must be valid JSON. Escape newlines, tabs, quotes, and other control
   characters inside string values.

Base every number on data you actually retrieved. Do not invent figures.`;
