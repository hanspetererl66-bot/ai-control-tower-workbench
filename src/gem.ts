/**
 * The geometry of the Werkbank gem: a cut stone with a flat table on top, six crown facets and six pavilion facets down to the point.
 * Pure functions (no React, no browser), so the picture at any angle can be tested. `frame(turn)` returns the visible facets, far to near,
 * each lit by one light, and how strongly a facet looks straight at the viewer right now ("glint"), which is when the stone flashes.
 */
type V = [number, number, number];
export type Face = { idx: number[]; part: 'table' | 'crown' | 'pavilion' };

export const SIDES = 6;

const TILT = -0.34; // the viewer looks slightly down onto the stone
const TABLE: [number, number] = [0.42, -0.62]; // radius, height of the table ring
const GIRDLE: [number, number] = [0.86, -0.2];
const CULET: V = [0, 1, 0];

const ring = (r: number, y: number, turn = 0): V[] => Array.from({ length: SIDES }, (_, i): V => {
  const a = (i / SIDES) * Math.PI * 2 + turn;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
});

// Vertices: 0..5 table, 6..11 girdle, 12 culet.
const BASE: V[] = [...ring(TABLE[0], TABLE[1]), ...ring(GIRDLE[0], GIRDLE[1]), CULET];
export const FACES: Face[] = [
  { idx: [0, 1, 2, 3, 4, 5], part: 'table' },
  ...Array.from({ length: SIDES }, (_, i): Face => ({ idx: [i, (i + 1) % SIDES, SIDES + ((i + 1) % SIDES), SIDES + i], part: 'crown' })),
  ...Array.from({ length: SIDES }, (_, i): Face => ({ idx: [SIDES + i, SIDES + ((i + 1) % SIDES), 12], part: 'pavilion' })),
];

const LIGHT: V = (() => { const v: V = [-0.45, -0.65, 0.62]; const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n]; })();
const STOPS: Array<[number, V]> = [[0, [48, 36, 150]], [0.45, [109, 74, 240]], [0.8, [170, 148, 252]], [1, [255, 255, 255]]];

function shade(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < STOPS.length - 2 && x > STOPS[i + 1][0]) i += 1;
  const [a, ca] = STOPS[i], [b, cb] = STOPS[i + 1];
  const k = (x - a) / (b - a);
  return `rgb(${[0, 1, 2].map((c) => Math.round(ca[c] + (cb[c] - ca[c]) * k)).join(',')})`;
}

const rotate = ([x, y, z]: V, turn: number, tilt = TILT): V => {
  const xr = x * Math.cos(turn) + z * Math.sin(turn);
  const zr = -x * Math.sin(turn) + z * Math.cos(turn);
  return [xr, y * Math.cos(tilt) - zr * Math.sin(tilt), y * Math.sin(tilt) + zr * Math.cos(tilt)];
};
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: V): V => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

export type Frame = { faces: Array<{ index: number; points: string; fill: string; z: number }>; glint: number; star: [number, number] };

/** Pure: the picture of the stone at a given angle (radians). Exported for the tests. */
export function frame(turn: number): Frame {
  const pts = BASE.map((p) => rotate(p, turn));
  const out: Frame['faces'] = [];
  let glint = 0;
  let star: [number, number] = [26, 15];
  FACES.forEach((face, index) => {
    const v = face.idx.map((i) => pts[i]);
    const centroid: V = [0, 0, 0];
    v.forEach((p) => { centroid[0] += p[0] / v.length; centroid[1] += p[1] / v.length; centroid[2] += p[2] / v.length; });
    let n = unit(cross(sub(v[1], v[0]), sub(v[2], v[0])));
    if (dot(n, centroid) < 0) n = [-n[0], -n[1], -n[2]]; // the normal points out of the stone
    if (n[2] <= 0.02) return; // turned away: not visible
    const lambert = Math.max(0, dot(n, LIGHT));
    // The flash: strongest when the facet looks straight at the viewer, gone a little way off to the side.
    // Measured around the stone's axis (not by the slanted normal), so crown and pavilion of the same side flash together.
    const base = face.idx.reduce<V>((acc, i) => [acc[0] + BASE[i][0], acc[1] + BASE[i][1], acc[2] + BASE[i][2]], [0, 0, 0]);
    const yaw = rotate([base[0], 0, base[2]], turn, 0);
    const around = Math.hypot(yaw[0], yaw[2]);
    const facing = face.part === 'table' || around < 1e-6 ? 0 : Math.pow(Math.max(0, yaw[2] / around), 40);
    const t = 0.16 + lambert * 0.62 + facing * 0.55;
    if (facing > glint) { glint = facing; star = [22 + centroid[0] * 17 + 2.5, 22 + centroid[1] * 17 - 1.5]; }
    out.push({ index, points: v.map((p) => `${(22 + p[0] * 17).toFixed(2)},${(22 + p[1] * 17).toFixed(2)}`).join(' '), fill: shade(t), z: centroid[2] });
  });
  out.sort((a, b) => a.z - b.z);
  return { faces: out, glint, star };
}
