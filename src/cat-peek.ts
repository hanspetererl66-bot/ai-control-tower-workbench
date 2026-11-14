/**
 * Casimir peeks over the edge of the window: a small pixel cat the user can drag to any edge. Only 60 % of the face is
 * shown (the rest is "behind" the edge), and from time to time it makes another face.
 * Pure logic (position, snapping, faces); the drawing is in `ui/CatPeek.tsx`.
 */

export const CAT_EDGES = ['bottom', 'top', 'left', 'right'] as const;
export type CatEdge = (typeof CAT_EDGES)[number];

export type CatPrefs = {
  enabled: boolean;
  edge: CatEdge;
  /** Where along the edge, 0 (start) to 1 (end). */
  at: number;
};
export const DEFAULT_CAT: CatPrefs = { enabled: true, edge: 'bottom', at: 0.82 };

export function sanitizeCat(value: unknown): CatPrefs {
  const v = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const at = typeof v.at === 'number' && Number.isFinite(v.at) ? Math.min(1, Math.max(0, v.at)) : DEFAULT_CAT.at;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_CAT.enabled,
    edge: (CAT_EDGES as readonly string[]).includes(v.edge as string) ? (v.edge as CatEdge) : DEFAULT_CAT.edge,
    at: Math.round(at * 1000) / 1000,
  };
}

/** The whole face is FACE_ROWS pixels tall, only VISIBLE_ROWS of them are drawn: 12 / 20 = 60 %. */
export const FACE_COLS = 16;
export const FACE_ROWS = 20;
export const VISIBLE_ROWS = 12;
export const VISIBLE_SHARE = VISIBLE_ROWS / FACE_ROWS;
/** Screen pixels per cat pixel. */
export const CAT_PIXEL = 6;

/** The head up to the edge: ears at the top, cheeks below. `#` is fur. Eyes, nose and mouth come from the face. */
export const HEAD: readonly string[] = [
  '.##..........##.',
  '.###........###.',
  '.####......####.',
  '.##############.',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
];
/** Inner ears. `n` draws in the accent colour. */
export const EARS: readonly string[] = [
  '................',
  '..n..........n..',
  '..nn........nn..',
  '................',
  '................', '................', '................', '................', '................', '................', '................', '................',
];

/** Faces: rows 5 to 11 of the head. `b` = light (eyes, mouth), `p` = dark (pupil), `n` = accent (nose, tongue). */
export const FACES = {
  neutral: ['................', '..bbb......bbb..', '..bpb......bpb..', '..bbb......bbb..', '.......nn.......', '......b..b......', '.......bb.......'],
  wink: ['................', '..bbb...........', '..bpb...........', '..bbb......bbb..', '.......nn.......', '......b..b......', '.......bb.......'],
  tongue: ['................', '..bbb......bbb..', '..bpb......bpb..', '..bbb......bbb..', '.......nn.......', '......bbbb......', '........nn......'],
  crosseyed: ['................', '..bbb......bbb..', '..bbp......pbb..', '..bbb......bbb..', '.......nn.......', '......b..b......', '.......bb.......'],
  surprised: ['..bbb......bbb..', '..bpb......bpb..', '..bpb......bpb..', '..bbb......bbb..', '.......nn.......', '.......bb.......', '.......bb.......'],
  bored: ['................', '................', '................', '..bbb......bbb..', '.......nn.......', '.....bbbbbb.....', '................'],
  happy: ['................', '...b........b...', '..b.b......b.b..', '................', '.......nn.......', '......bbbb......', '.......bb.......'],
} as const satisfies Record<string, readonly string[]>;
export type CatFace = keyof typeof FACES;
export const CAT_FACES = Object.keys(FACES) as CatFace[];

/** The next face: never the same twice in a row. `random` is a number from 0 up to (not including) 1. */
export function nextFace(current: CatFace, random: number): CatFace {
  const others = CAT_FACES.filter((f) => f !== current);
  return others[Math.min(others.length - 1, Math.floor(Math.max(0, random) * others.length))];
}

export type Cell = { x: number; y: number; kind: 'fur' | 'light' | 'dark' | 'accent' };
/** All pixels of one face as cells, in head coordinates (before turning to the edge). */
export function faceCells(face: CatFace): Cell[] {
  const out: Cell[] = [];
  HEAD.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') out.push({ x, y, kind: 'fur' }); }));
  EARS.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'n') out.push({ x, y, kind: 'accent' }); }));
  FACES[face].forEach((row, i) => [...row].forEach((c, x) => {
    const kind = c === 'b' ? 'light' : c === 'p' ? 'dark' : c === 'n' ? 'accent' : null;
    if (kind) out.push({ x, y: 5 + i, kind });
  }));
  return out;
}

/** The size of the visible part on screen (px) for an edge. At the left and right edge the head is turned, so width and height swap. */
export function boxSize(edge: CatEdge, pixel = CAT_PIXEL): { width: number; height: number } {
  const w = FACE_COLS * pixel;
  const h = VISIBLE_ROWS * pixel;
  return edge === 'left' || edge === 'right' ? { width: h, height: w } : { width: w, height: h };
}

/** Where the box sits (top-left, px) in a window of vw × vh. The box touches its edge, `at` moves it along the edge. */
export function placement(cat: Pick<CatPrefs, 'edge' | 'at'>, vw: number, vh: number, pixel = CAT_PIXEL): { left: number; top: number; width: number; height: number } {
  const { width, height } = boxSize(cat.edge, pixel);
  const along = (room: number) => Math.round(Math.min(1, Math.max(0, cat.at)) * Math.max(0, room));
  switch (cat.edge) {
    case 'bottom': return { left: along(vw - width), top: Math.max(0, vh - height), width, height };
    case 'top': return { left: along(vw - width), top: 0, width, height };
    case 'left': return { left: 0, top: along(vh - height), width, height };
    default: return { left: Math.max(0, vw - width), top: along(vh - height), width, height };
  }
}

/** The edge nearest to a point, and the position along it. Used while dragging and on release. */
export function snapToEdge(x: number, y: number, vw: number, vh: number, pixel = CAT_PIXEL): Pick<CatPrefs, 'edge' | 'at'> {
  const dist: Record<CatEdge, number> = { left: x, right: vw - x, top: y, bottom: vh - y };
  const edge = CAT_EDGES.reduce((best, e) => (dist[e] < dist[best] ? e : best), 'bottom' as CatEdge);
  const { width, height } = boxSize(edge, pixel);
  const horizontal = edge === 'top' || edge === 'bottom';
  const room = horizontal ? vw - width : vh - height;
  const pos = (horizontal ? x - width / 2 : y - height / 2);
  const at = room > 0 ? Math.min(1, Math.max(0, pos / room)) : 0;
  return { edge, at: Math.round(at * 1000) / 1000 };
}

/** How the head is turned so that its top points away from the edge. */
export function turnFor(edge: CatEdge): number {
  return edge === 'bottom' ? 0 : edge === 'top' ? 180 : edge === 'left' ? 90 : -90;
}
