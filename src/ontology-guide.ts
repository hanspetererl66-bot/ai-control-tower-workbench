/**
 * Guided tips of the Ontology Manager: speech bubbles that point at a part of the page and say what it is for and how to use it.
 * Pure logic (steps per tab, bubble placement, remembered switch); the component is `ui/OntologyGuide.tsx`. Nothing here touches
 * the catalog; the only thing remembered is the tips switch and which tabs were already shown, in the browser of this computer.
 */
export type GuideTab = 'catalog' | 'map' | 'questions' | 'proposals' | 'quality' | 'use' | 'history' | 'export';
export type GuideStep = { target: string; title: string; text: string; side?: 'below' | 'above' | 'right' };

export const GUIDE_STEPS: Record<GuideTab, GuideStep[]> = {
  catalog: [
    { target: 'tips', title: 'Welcome to the Ontology Manager', text: 'This is where the meaning of your terms is kept, so every agent reads "DSO" or "customer" the same way. A short tour shows each part. This Tips switch turns the bubbles off or on again.', side: 'below' },
    { target: 'tabs', title: 'Eight views, one vocabulary', text: 'Catalog is the home base. Map shows how terms depend on each other, Proposals turns a document into new terms, Quality lists what needs fixing. Click a tab to see its tips.', side: 'below' },
    { target: 'kpis', title: 'How healthy is it?', text: 'Counts of classes, properties and certified metrics. The bar shows how many classes have a definition: aim for all of them.', side: 'below' },
    { target: 'side', title: 'Pick an ontology', text: 'Each card is one vocabulary (Finance, Sales, IT operations …). Click one to see its terms. Under the list you can set its owner, domain and who approves changes.', side: 'right' },
    { target: 'search', title: 'Find a term', text: 'Search by name, synonym, definition or owner. The buttons next to it narrow the list to metrics, classes, deprecated terms, or those that need attention.', side: 'below' },
    { target: 'terms', title: 'Open a term', text: 'Click a row. The panel on the right shows the definition, the owner, what depends on the term and what it is used by.', side: 'above' },
    { target: 'detail', title: 'Before you change anything', text: 'Here you see what would be affected by a change. Use "Plan a change" to write down who must be asked first. It never edits the catalog.', side: 'above' },
  ],
  map: [{ target: 'tab-map', title: 'The map', text: 'Every term as a dot, linked to what it depends on. The map has its own four-step guide: press "? Guide" above the map. Click a dot and red shows everything that would be affected if it changed.', side: 'below' }],
  questions: [{ target: 'tab-questions', title: 'Competency questions', text: 'Write the questions your vocabulary has to answer ("Which invoices are overdue?"). The check says whether all needed terms exist and are defined. It checks the vocabulary, not the data.', side: 'below' }],
  proposals: [{ target: 'tab-proposals', title: 'Terms from a document', text: 'Ask the agent to read a handbook or policy and propose terms. You see each proposal with the quotes it is based on. Nothing changes until you tick the box and confirm.', side: 'below' }],
  quality: [{ target: 'tab-quality', title: 'What needs fixing', text: 'Missing owner or definition, duplicates, terms that are deprecated but still in use. Click a finding to jump to the term.', side: 'below' }],
  use: [{ target: 'tab-use', title: 'Who uses which term', text: 'Link agents, skills and reports to the terms they rely on. That is what makes "what is affected?" accurate. The view per agent shows which ontologies it gets.', side: 'below' }],
  history: [{ target: 'tab-history', title: 'Earlier versions', text: 'Every confirmed change keeps the version before it. Here you see what was added and removed.', side: 'below' }],
  export: [{ target: 'tab-export', title: 'Take it with you', text: 'Download the vocabulary as Turtle (OWL + SKOS), JSON-LD or a CSV glossary for people. Everything is prepared on this computer.', side: 'below' }],
};

export const stepsFor = (tab: GuideTab): GuideStep[] => GUIDE_STEPS[tab] ?? [];

export type Box = { left: number; top: number; width: number; height: number };
export type Placement = { left: number; top: number; side: 'below' | 'above' | 'right' | 'left'; arrow: number };

/**
 * Where a bubble of `size` goes next to `target` inside a `view` of the given width and height. Prefers the asked side, flips when
 * it does not fit, and keeps the bubble inside the view (margin 12). `arrow` is the distance of the tip from the bubble's near edge.
 */
export function placeBubble(target: Box, size: { width: number; height: number }, view: { width: number; height: number }, prefer: GuideStep['side'] = 'below'): Placement {
  const gap = 14, margin = 12, { width: w, height: h } = size;
  const fits = {
    below: target.top + target.height + gap + h <= view.height - margin,
    above: target.top - gap - h >= margin,
    right: target.left + target.width + gap + w <= view.width - margin,
    left: target.left - gap - w >= margin,
  };
  const order: Placement['side'][] = prefer === 'above' ? ['above', 'below', 'right', 'left'] : prefer === 'right' ? ['right', 'below', 'above', 'left'] : ['below', 'above', 'right', 'left'];
  const side = order.find((s) => fits[s]) ?? 'below';
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const cx = target.left + target.width / 2, cy = target.top + target.height / 2;
  let left: number, top: number, arrow: number;
  if (side === 'below' || side === 'above') {
    left = clamp(cx - w / 2, margin, Math.max(margin, view.width - margin - w));
    top = side === 'below' ? target.top + target.height + gap : target.top - gap - h;
    arrow = clamp(cx - left, 18, Math.max(18, w - 18));
  } else {
    top = clamp(cy - h / 2, margin, Math.max(margin, view.height - margin - h));
    left = side === 'right' ? target.left + target.width + gap : target.left - gap - w;
    arrow = clamp(cy - top, 18, Math.max(18, h - 18));
  }
  top = clamp(top, margin, Math.max(margin, view.height - margin - h));
  return { left, top, side, arrow };
}

/** What is remembered: the switch, and the tabs whose tour was already shown. Unreadable or broken storage means "tips on, nothing seen". */
export type GuidePref = { on: boolean; seen: GuideTab[] };
export const GUIDE_KEY = 'werkbank.ontology.guide';
export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function readGuidePref(storage: StorageLike | null | undefined): GuidePref {
  try {
    const raw = storage?.getItem(GUIDE_KEY);
    if (!raw) return { on: true, seen: [] };
    const j = JSON.parse(raw) as { on?: unknown; seen?: unknown };
    const seen = Array.isArray(j.seen) ? (j.seen.filter((t) => typeof t === 'string' && t in GUIDE_STEPS) as GuideTab[]) : [];
    return { on: j.on !== false, seen };
  } catch { return { on: true, seen: [] }; }
}

export function writeGuidePref(storage: StorageLike | null | undefined, pref: GuidePref): boolean {
  try { storage?.setItem(GUIDE_KEY, JSON.stringify(pref)); return Boolean(storage); } catch { return false; }
}
