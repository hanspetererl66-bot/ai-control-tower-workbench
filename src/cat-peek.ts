/**
 * Casimir peeks over a ledge: a small pixel cat (in purple tones) that can be dragged anywhere on the screen.
 * Only 60 % of his face shows, a thin black ledge always runs along the bottom of him, he blinks, twitches an ear,
 * follows the pointer with his eyes and pulls faces. Pure logic (position, drawing into a grid, faces); the drawing
 * on screen is in `ui/CatPeek.tsx`, the colours are the `--cat-*` tokens in theme.css.
 */

export type CatPrefs = {
  enabled: boolean;
  /** Where he sits: share of the free room in the window, 0 (left / top) to 1 (right / bottom). y = 1: the ledge touches the bottom of the window. */
  x: number;
  y: number;
};
export const DEFAULT_CAT: CatPrefs = { enabled: true, x: 1, y: 1 };

export function sanitizeCat(value: unknown): CatPrefs {
  const v = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const share = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000 : fallback);
  return { enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_CAT.enabled, x: share(v.x, DEFAULT_CAT.x), y: share(v.y, DEFAULT_CAT.y) };
}

/** The whole face is FACE_ROWS pixels tall, only VISIBLE_ROWS of them are drawn: 24 / 40 = 60 %. Below them runs the ledge. */
export const FACE_COLS = 36;
export const FACE_ROWS = 40;
export const VISIBLE_ROWS = 24;
export const LEDGE_ROWS = 2;
export const GRID_ROWS = VISIBLE_ROWS + LEDGE_ROWS;
export const VISIBLE_SHARE = VISIBLE_ROWS / FACE_ROWS;
/** Screen pixels per cat pixel. */
export const CAT_PIXEL = 2;

/** Colours of the grid. 0 is empty; the rest are `--cat-<n>` in theme.css. */
export const TONE = { none: 0, line: 1, dark: 2, mid: 3, light: 4, pale: 5, white: 6, pupil: 7, pink: 8, ledge: 9 } as const;
export type Tone = (typeof TONE)[keyof typeof TONE];
export const TONE_COUNT = 10;
export type Grid = Tone[][];

export const FACE_NAMES = ['neutral', 'wink', 'blep', 'crosseyed', 'surprised', 'grumpy', 'smug', 'dizzy', 'love', 'derp', 'yawn', 'sideeye', 'sleep'] as const;
export type CatFace = (typeof FACE_NAMES)[number];
export const CAT_FACES: readonly CatFace[] = FACE_NAMES;

/** Faces that play a little script: the number of steps (`phase`) and how long each lasts (ms). */
export const PHASES: Partial<Record<CatFace, { steps: number; ms: number }>> = { yawn: { steps: 4, ms: 600 }, sleep: { steps: 4, ms: 850 } };

/** How long a face stays, in ms: sleeping is long, yawning is one go through its script, the rest 4 to 9 s. `random` is 0 up to 1. */
export function faceDuration(face: CatFace, random: number): number {
  const r = Math.min(1, Math.max(0, random));
  const script = PHASES[face];
  if (face === 'yawn' && script) return script.steps * script.ms + 400;
  if (face === 'sleep') return 9000 + r * 5000;
  return 4000 + r * 5000;
}

/** What comes after a face: after a yawn he often falls asleep, a sleeper often wakes with a yawn, otherwise any other face. */
export function afterFace(current: CatFace, random: number): CatFace {
  const r = Math.min(0.999, Math.max(0, random));
  if (current === 'yawn' && r < 0.5) return 'sleep';
  if (current === 'sleep' && r < 0.5) return 'yawn';
  const others = CAT_FACES.filter((f) => f !== current && f !== 'sleep');
  return others[Math.floor(r * others.length)];
}

/** Whether his paws rest on the ledge: always when asleep, often when yawning, now and then otherwise. */
export function pawsUp(face: CatFace, random: number): boolean {
  return face === 'sleep' ? true : face === 'yawn' ? random < 0.6 : random < 0.3;
}

/** One or two hearts when he is in love. */
export function heartCount(random: number): 1 | 2 {
  return random < 0.5 ? 1 : 2;
}

/** The pixel heart sent off by a cat in love (and used in the eyes). */
export const HEART: readonly string[] = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];

/** The next face: never the same twice in a row. `random` is a number from 0 up to (not including) 1. */
export function nextFace(current: CatFace, random: number): CatFace {
  const others = CAT_FACES.filter((f) => f !== current);
  return others[Math.min(others.length - 1, Math.floor(Math.max(0, Math.min(1, random)) * others.length))];
}

export type Pose = {
  face: CatFace;
  /** Eyes closed for a moment. */
  blink?: boolean;
  /** Where the pupils look, each -1, 0 or 1. */
  look?: { x: -1 | 0 | 1; y: -1 | 0 | 1 };
  /** One ear flicks down by a pixel. */
  flick?: 'left' | 'right' | null;
  /** Step of the little script of yawn and sleep (see PHASES). */
  phase?: number;
  /** Both paws rest on the ledge. */
  paws?: boolean;
};

type Spec = {
  /** Eye shape: round (open), arc (happy ^), line (closed), slit (half closed), x (dizzy), heart, big (wide with tiny pupil). */
  eyes: 'round' | 'arc' | 'line' | 'slit' | 'x' | 'heart' | 'big' | 'sleep';
  /** Eyebrows: slope in pixels (positive = outer ends down = angry; negative = worried), 0 = none. */
  brow?: number;
  mouth: 'smile' | 'grin' | 'tongue' | 'o' | 'frown' | 'smirk' | 'wavy' | 'yawn' | 'yawn1' | 'flat' | 'side';
  blush?: boolean;
  /** Pupils of both eyes are pushed this way regardless of the pointer (cross-eyed, side eye). */
  gaze?: { x: number; y: number };
  /** Right eye differs: its own shape and size of pupil (derp, wink). */
  right?: { eyes?: Spec['eyes']; pupil?: number };
  /** Pupil radius. */
  pupil?: number;
};

const SPECS: Record<CatFace, Spec> = {
  neutral: { eyes: 'round', mouth: 'smile', pupil: 2 },
  wink: { eyes: 'round', mouth: 'grin', pupil: 2, right: { eyes: 'arc' }, brow: 0 },
  blep: { eyes: 'round', mouth: 'tongue', pupil: 2, blush: true },
  crosseyed: { eyes: 'round', mouth: 'wavy', pupil: 2, gaze: { x: 99, y: 0 } },
  surprised: { eyes: 'big', mouth: 'o', pupil: 1, brow: -1 },
  grumpy: { eyes: 'slit', mouth: 'frown', pupil: 2, brow: 2 },
  smug: { eyes: 'slit', mouth: 'smirk', pupil: 2, brow: -1 },
  dizzy: { eyes: 'x', mouth: 'wavy', blush: false },
  love: { eyes: 'heart', mouth: 'grin', blush: true },
  derp: { eyes: 'round', mouth: 'side', pupil: 3, right: { pupil: 1 }, gaze: { x: 1, y: -1 } },
  yawn: { eyes: 'line', mouth: 'yawn', brow: -1 },
  sideeye: { eyes: 'slit', mouth: 'flat', pupil: 2, gaze: { x: 2, y: 0 }, brow: 1 },
  sleep: { eyes: 'sleep', mouth: 'flat' },
};

const CX = (FACE_COLS - 1) / 2;
const EYE_Y = 14;
const EYE_DX = 7;

function blank(): Grid {
  return Array.from({ length: GRID_ROWS }, () => Array<Tone>(FACE_COLS).fill(TONE.none));
}
function put(g: Grid, x: number, y: number, t: Tone, only: Tone | null = null) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= FACE_COLS || py >= VISIBLE_ROWS) return;
  if (only !== null && g[py][px] !== only) return;
  g[py][px] = t;
}
function inTriangle(px: number, py: number, a: [number, number], b: [number, number], c: [number, number]): boolean {
  const s = (p1: [number, number], p2: [number, number], p3: [number, number]) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const p: [number, number] = [px, py];
  const d1 = s(p, a, b);
  const d2 = s(p, b, c);
  const d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, t: Tone, only: Tone | null = null) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(g, x, y, t, only);
  }
}
function points(g: Grid, list: ReadonlyArray<readonly [number, number]>, t: Tone, dx = 0, dy = 0) {
  for (const [x, y] of list) put(g, x + dx, y + dy, t);
}

/** Head, ears, fur shading and muzzle. */
function drawHead(g: Grid, flick: Pose['flick']) {
  const filled: boolean[][] = Array.from({ length: VISIBLE_ROWS }, () => Array<boolean>(FACE_COLS).fill(false));
  const head: boolean[][] = Array.from({ length: VISIBLE_ROWS }, () => Array<boolean>(FACE_COLS).fill(false));
  const set = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < FACE_COLS && y < VISIBLE_ROWS) filled[y][x] = true; };
  // Head: a wide ellipse whose lower part is hidden behind the ledge.
  for (let y = 0; y < VISIBLE_ROWS; y++) for (let x = 0; x < FACE_COLS; x++) {
    if (((x - CX) / 17.5) ** 2 + ((y - 22) / 18) ** 2 <= 1) { set(x, y); head[y][x] = true; }
  }
  // Ears (the flicked one sits one pixel lower).
  const ear = (side: 'left' | 'right') => {
    const m = side === 'left' ? 1 : -1;
    const o = side === 'left' ? 0 : FACE_COLS - 1;
    const dy = flick === side ? 1 : 0;
    const A: [number, number] = [o + m * 2, 10];
    const B: [number, number] = [o + m * 4, 0 + dy];
    const C: [number, number] = [o + m * 14, 6];
    for (let y = 0; y < 12; y++) for (let x = 0; x < FACE_COLS; x++) if (inTriangle(x, y, A, B, C)) set(x, y);
  };
  ear('left'); ear('right');
  const edge = (x: number, y: number) => filled[y][x] && [[1, 0], [-1, 0], [0, -1], [0, 1]].some(([ax, ay]) => {
    const nx = x + ax; const ny = y + ay;
    return nx >= 0 && nx < FACE_COLS && ny >= 0 && ny < VISIBLE_ROWS && !filled[ny][nx];
  });
  for (let y = 0; y < VISIBLE_ROWS; y++) for (let x = 0; x < FACE_COLS; x++) {
    if (!filled[y][x]) continue;
    // Dark purple head, light purple ears (what sticks out of the head ellipse).
    g[y][x] = edge(x, y) ? TONE.line : head[y][x] ? TONE.dark : TONE.light;
  }
  // Inner ears.
  for (const side of ['left', 'right'] as const) {
    const m = side === 'left' ? 1 : -1;
    const o = side === 'left' ? 0 : FACE_COLS - 1;
    const dy = flick === side ? 1 : 0;
    const A: [number, number] = [o + m * 4.5, 8]; const B: [number, number] = [o + m * 5.5, 3 + dy]; const C: [number, number] = [o + m * 10, 6.5];
    for (let y = 1; y < 10; y++) for (let x = 0; x < FACE_COLS; x++) if (inTriangle(x, y, A, B, C)) put(g, x, y, TONE.pink, TONE.light);
  }
  // Fur: tabby stripes, pale muzzle and softer cheeks on the dark purple head.
  for (const [x, y0, y1] of [[17, 6, 10], [18, 6, 10], [13, 7, 9], [22, 7, 9], [9, 9, 10], [26, 9, 10]] as const) for (let y = y0; y <= y1; y++) put(g, x, y, TONE.line, TONE.dark);
  ellipse(g, CX, 22, 9, 5.5, TONE.pale, TONE.dark);
  ellipse(g, CX - 11, 21, 4, 3, TONE.mid, TONE.dark);
  ellipse(g, CX + 11, 21, 4, 3, TONE.mid, TONE.dark);
  // Nose.
  points(g, [[17, 19], [18, 19], [16, 19], [19, 19], [17, 20], [18, 20]], TONE.pink);
  put(g, 17, 18, TONE.pink); put(g, 18, 18, TONE.pink);
}

function drawEye(g: Grid, cx: number, shape: Spec['eyes'], pupil: number, gaze: { x: number; y: number }, mirror: 1 | -1) {
  const cy = EYE_Y;
  const wide = shape === 'big';
  if (shape === 'round' || shape === 'big') {
    ellipse(g, cx, cy, wide ? 4.5 : 3.6, wide ? 5 : 4.2, TONE.white);
    const px = cx + Math.max(-2, Math.min(2, gaze.x));
    const py = cy + Math.max(-2, Math.min(2, gaze.y));
    ellipse(g, px, py, pupil / 1.3 + 0.4, pupil + 0.6, TONE.pupil);
    put(g, px - 0.6, py - 1.4, TONE.white);
  } else if (shape === 'slit') {
    // Half-closed lid: white lower half, lid line above.
    for (let y = cy - 1; y <= cy + 3; y++) for (let x = cx - 4; x <= cx + 4; x++) if (((x - cx) / 4.4) ** 2 + ((y - cy - 1) / 3.2) ** 2 <= 1) put(g, x, y, TONE.white);
    const px = cx + Math.max(-2, Math.min(2, gaze.x));
    for (let y = cy; y <= cy + 3; y++) for (let x = px - 1; x <= px + 1; x++) put(g, x, y, TONE.pupil, TONE.white);
    for (let x = cx - 4; x <= cx + 4; x++) put(g, x, cy - 1, TONE.line);
  } else if (shape === 'arc') {
    points(g, [[-4, 2], [-3, 1], [-2, 0], [-1, -1], [0, -1], [1, -1], [2, 0], [3, 1], [4, 2]], TONE.line, cx, cy);
    points(g, [[-3, 2], [3, 2]], TONE.line, cx, cy);
  } else if (shape === 'sleep') {
    // Closed and relaxed: a downward curve, like a sleeping cat.
    points(g, [[-4, 0], [-3, 1], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2], [3, 1], [4, 0]], TONE.line, cx, cy);
  } else if (shape === 'line') {
    for (let x = cx - 4; x <= cx + 4; x++) put(g, x, cy + 1, TONE.line);
    points(g, [[-4, 0], [4, 0]], TONE.line, cx, cy + 1);
  } else if (shape === 'x') {
    for (let i = -3; i <= 3; i++) { put(g, cx + i, cy + i, TONE.line); put(g, cx + i, cy - i, TONE.line); put(g, cx + i + 1, cy + i, TONE.line); put(g, cx + i + 1, cy - i, TONE.line); }
  } else {
    HEART.forEach((row, ry) => [...row].forEach((c, rx) => { if (c === '#') put(g, cx - 3 + rx, cy - 3 + ry, TONE.pink); }));
    put(g, cx - 2, cy - 2, TONE.white);
  }
  void mirror;
}

function drawBrow(g: Grid, cx: number, slope: number, side: 1 | -1) {
  if (!slope) return;
  // The outer end (away from the nose) is lower when slope > 0 (angry) and higher when slope < 0 (worried or surprised).
  for (let i = -3; i <= 3; i++) {
    const outer = i * side;
    const y = 8 + (outer > 0 ? slope * (outer / 3) : -slope * (-outer / 3) * 0.5);
    put(g, cx + i, y, TONE.light);
    put(g, cx + i, y + 1, TONE.light);
  }
}

const MOUTHS: Record<Spec['mouth'], { line: ReadonlyArray<readonly [number, number]>; fill?: ReadonlyArray<readonly [number, number]>; tongue?: ReadonlyArray<readonly [number, number]> }> = {
  smile: { line: [[17, 21], [18, 21], [16, 22], [15, 22], [14, 22], [13, 21], [19, 22], [20, 22], [21, 22], [22, 21]] },
  grin: { line: [[13, 21], [14, 22], [15, 23], [16, 23], [17, 23], [18, 23], [19, 23], [20, 23], [21, 22], [22, 21], [23, 21], [17, 21], [18, 21], [14, 21], [22, 22]] },
  tongue: { line: [[13, 21], [14, 22], [15, 22], [16, 22], [17, 22], [18, 22], [19, 22], [20, 22], [21, 22], [22, 21], [17, 21], [18, 21]], tongue: [[17, 23], [18, 23], [19, 23], [17, 22], [18, 22], [19, 22]] },
  o: { line: [[16, 22], [17, 21], [18, 21], [19, 22], [16, 23], [19, 23], [17, 23], [18, 23]], fill: [[17, 22], [18, 22]] },
  frown: { line: [[17, 21], [18, 21], [14, 23], [15, 22], [16, 22], [19, 22], [20, 22], [21, 23], [13, 23], [22, 23]] },
  smirk: { line: [[17, 21], [18, 21], [18, 22], [19, 22], [20, 22], [21, 22], [22, 21], [23, 20], [17, 22], [16, 22], [15, 23]] },
  wavy: { line: [[17, 21], [18, 21], [12, 23], [13, 22], [14, 22], [15, 23], [16, 23], [17, 22], [18, 22], [19, 23], [20, 23], [21, 22], [22, 22], [23, 23]] },
  yawn: { line: [[14, 21], [15, 21], [16, 21], [17, 21], [18, 21], [19, 21], [20, 21], [21, 21], [13, 22], [22, 22], [13, 23], [22, 23], [14, 23], [21, 23], [15, 23], [20, 23], [16, 23], [17, 23], [18, 23], [19, 23]], fill: [[14, 22], [15, 22], [16, 22], [17, 22], [18, 22], [19, 22], [20, 22], [21, 22]], tongue: [[16, 23], [17, 23], [18, 23], [19, 23]] },
  yawn1: { line: [[15, 21], [16, 21], [17, 21], [18, 21], [19, 21], [20, 21], [14, 22], [21, 22], [14, 23], [21, 23], [15, 23], [20, 23], [16, 23], [17, 23], [18, 23], [19, 23]], fill: [[15, 22], [16, 22], [17, 22], [18, 22], [19, 22], [20, 22]] },
  flat: { line: [[14, 22], [15, 22], [16, 22], [17, 22], [18, 22], [19, 22], [20, 22], [21, 22], [17, 21], [18, 21]] },
  side: { line: [[17, 21], [18, 21], [18, 22], [19, 22], [20, 22], [21, 22], [22, 22], [19, 23], [20, 23]], tongue: [[22, 23], [23, 23], [23, 24], [22, 24]] },
};

/** The snore bubble at his nose: 0 none, 1 small, 2 big. */
function drawBubble(g: Grid, size: number) {
  if (!size) return;
  const r = size === 1 ? 1.4 : 2.6;
  const cx = 23.5;
  const cy = 19 - (size === 1 ? 0 : 1);
  ellipse(g, cx, cy, r + 0.8, r + 0.8, TONE.line);
  ellipse(g, cx, cy, r, r, TONE.white);
  put(g, cx - r / 2, cy - r / 2, TONE.pale);
}

/** Both paws on the ledge, one on each side of the muzzle, with toes. */
function drawPaws(g: Grid) {
  for (const cx of [5.5, FACE_COLS - 1 - 5.5]) {
    ellipse(g, cx, 22.6, 4.6, 3.2, TONE.line);
    ellipse(g, cx, 22.6, 3.7, 2.4, TONE.pale);
    for (const dx of [-1.2, 1.2]) { put(g, cx + dx, 22, TONE.light); put(g, cx + dx, 23, TONE.light); }
  }
}

/** Draws one picture of Casimir: VISIBLE_ROWS rows of face, then LEDGE_ROWS rows of black ledge. */
export function drawCat(pose: Pose): Grid {
  const g = blank();
  drawHead(g, pose.flick ?? null);
  const spec = SPECS[pose.face];
  const look = pose.look ?? { x: 0, y: 0 };
  const gaze = spec.gaze ?? look;
  const pupil = spec.pupil ?? 2;
  const phase = pose.phase ?? 0;
  const closed = pose.blink && !['arc', 'line', 'x', 'heart', 'sleep'].includes(spec.eyes);
  const leftShape: Spec['eyes'] = closed ? 'line' : spec.eyes;
  const rightShape: Spec['eyes'] = closed ? 'line' : (spec.right?.eyes ?? spec.eyes);
  const crossed = pose.face === 'crosseyed';
  drawEye(g, CX - EYE_DX, leftShape, pupil, crossed ? { x: 2, y: 0 } : gaze, 1);
  drawEye(g, CX + EYE_DX, rightShape, spec.right?.pupil ?? pupil, crossed ? { x: -2, y: 0 } : gaze, -1);
  if (spec.brow) { drawBrow(g, CX - EYE_DX, spec.brow, 1); drawBrow(g, CX + EYE_DX, spec.brow, -1); }
  if (spec.blush) { for (const x of [CX - 11, CX + 11]) for (const dx of [-2, 0, 2]) put(g, x + dx, 19, TONE.pink); }
  let mouth = spec.mouth;
  if (pose.face === 'yawn') mouth = (['o', 'yawn1', 'yawn', 'yawn1'] as const)[phase % 4];
  if (pose.face === 'sleep') mouth = phase % 2 ? 'o' : 'flat';
  const m = MOUTHS[mouth];
  if (m.fill) points(g, m.fill, TONE.dark);
  points(g, m.line, TONE.line);
  if (m.tongue) points(g, m.tongue, TONE.pink);
  if (pose.face === 'sleep') drawBubble(g, [0, 1, 2, 1][phase % 4]);
  if (pose.paws) drawPaws(g);
  // The ledge: a thin black line along the bottom, a little wider than the head.
  for (let y = VISIBLE_ROWS; y < GRID_ROWS; y++) g[y].fill(TONE.ledge);
  return g;
}

/** A grid as runs of one colour per row, for drawing: [x, y, length, tone]. Empty cells are left out. */
export function runsOf(grid: Grid): Array<[number, number, number, Tone]> {
  const out: Array<[number, number, number, Tone]> = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const t = row[x];
      let n = 1;
      while (x + n < row.length && row[x + n] === t) n++;
      if (t !== TONE.none) out.push([x, y, n, t]);
      x += n;
    }
  });
  return out;
}

/** Size of Casimir on screen. */
export function boxSize(pixel = CAT_PIXEL): { width: number; height: number } {
  return { width: FACE_COLS * pixel, height: GRID_ROWS * pixel };
}

/** Where he sits (top-left, px) in a window of vw × vh. He stays fully inside. */
export function placement(cat: Pick<CatPrefs, 'x' | 'y'>, vw: number, vh: number, pixel = CAT_PIXEL): { left: number; top: number; width: number; height: number } {
  const { width, height } = boxSize(pixel);
  const along = (share: number, room: number) => Math.round(Math.min(1, Math.max(0, share)) * Math.max(0, room));
  return { left: along(cat.x, vw - width), top: along(cat.y, vh - height), width, height };
}

/** The shares for a top-left corner in px (while dragging and on release), clamped to the window. */
export function shareAt(left: number, top: number, vw: number, vh: number, pixel = CAT_PIXEL): Pick<CatPrefs, 'x' | 'y'> {
  const { width, height } = boxSize(pixel);
  const share = (pos: number, room: number) => (room > 0 ? Math.round(Math.min(1, Math.max(0, pos / room)) * 1000) / 1000 : 0);
  return { x: share(left, vw - width), y: share(top, vh - height) };
}

/** Which way the pupils look to follow a point, seen from the middle of Casimir (a dead zone keeps them centred when the pointer is close). */
export function lookToward(pointer: { x: number; y: number }, center: { x: number; y: number }): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  const dead = 40;
  const sign = (n: number): -1 | 0 | 1 => (n > dead ? 1 : n < -dead ? -1 : 0);
  return { x: sign(dx), y: sign(dy) };
}
