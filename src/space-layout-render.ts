/**
 * Turns a Space Designer layout into the self-contained page a Space is (see space-layout.ts).
 *
 * Rules every generated page follows, the same as the hand-built Spaces:
 * - no network, no fonts or scripts from outside, no localStorage;
 * - colours only as tokens, so light and dark, skins and layouts apply;
 * - every visual block is an element with class "card" (the overview counts them);
 * - charts are inline SVG with the data palette of the dataviz method (fixed colour order, 2 px gaps and rings,
 *   thin marks, a legend for two or more series, a hover text on every column and a "Show data" table).
 *
 * The layout travels inside the page (<script type="application/json" id="wb-layout">), so the page can be opened in
 * the Designer again after it was copied, shared or imported.
 */
import { cellNumber, normalizeLayout, type Block, type ChartKind, type Dataset, type Layout, type Tone } from './space-layout.ts';

export const LAYOUT_SCRIPT_ID = 'wb-layout';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const inline = (text: string): string => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/** Plain text with blank-line paragraphs, "- " bullet lists and **bold**; everything else is escaped. */
export function richHtml(text: string): string {
  const source = String(text ?? '').trim();
  if (!source) return '';
  return source
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = paragraph.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
}

/** 12,400 / 1.2K / 4.2M: in full under 10,000, compact above. */
export function fmtNumber(n: number, compact = false): string {
  const a = Math.abs(n);
  const trim = (v: number) => String(Number(v.toFixed(1)));
  if (compact || a >= 10_000) {
    if (a >= 1e9) return `${trim(n / 1e9)}B`;
    if (a >= 1e6) return `${trim(n / 1e6)}M`;
    if (a >= 1e4) return `${trim(n / 1e3)}K`;
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/* ---------------------------------------------------------------- styles */

/** Chart colours: the eight slots of the reference palette (see the dataviz skill), stepped for each mode. */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const vars = (colors: string[]) => colors.map((c, i) => `--wb-c${i + 1}:${c}`).join(';');

export const LAYOUT_CSS = `
:root{${vars(SERIES_LIGHT)}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${vars(SERIES_DARK)}}}
:root[data-theme="dark"]{${vars(SERIES_DARK)}}
.wb-page{max-width:1180px;margin:0 auto;padding:32px 32px 64px}
.wb-page>*{margin-bottom:16px}
.wb-page p,.wb-page ul{margin:0 0 8px;line-height:1.6}
.wb-page ul{padding-left:20px}
.wb-page p:last-child,.wb-page ul:last-child{margin-bottom:0}
.wb-heading h2{margin:8px 0 4px;font-size:22px;font-weight:650;letter-spacing:-.02em;color:var(--ink)}
.wb-heading.wb-h-2 h2{font-size:16px;letter-spacing:0}
.wb-heading p{margin:0;color:var(--muted);font-size:13px}
.wb-title{margin:0 0 12px;font-size:15px;font-weight:650;color:var(--ink)}
.wb-sub{margin:-8px 0 12px;font-size:12px;color:var(--muted)}
.wb-hr{border:0;border-top:1px solid var(--line);margin:24px 0}
.wb-quote{border-left:3px solid var(--purple)}
.wb-quote p{font-size:17px;line-height:1.5;color:var(--ink)}
.wb-quote footer{margin-top:8px;font-size:12px;color:var(--muted)}
.wb-callout{display:flex;gap:14px;align-items:flex-start}
.wb-callout .wb-ico{flex:none;width:24px;height:24px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
.wb-callout strong{display:block;margin-bottom:2px;color:var(--ink)}
.wb-tone-info{border-color:var(--purple-border)}.wb-tone-info .wb-ico{background:var(--purple-dim);color:var(--purple)}
.wb-tone-ok{border-color:var(--green-border)}.wb-tone-ok .wb-ico{background:var(--green-dim);color:var(--green)}
.wb-tone-warn{border-color:var(--amber-border)}.wb-tone-warn .wb-ico{background:var(--amber-dim);color:var(--amber)}
.wb-tone-bad{border-color:var(--red-border)}.wb-tone-bad .wb-ico{background:var(--red-dim);color:var(--red)}
.wb-cols{display:grid;gap:16px;grid-template-columns:repeat(var(--n,3),minmax(0,1fr))}
.wb-cols .card{margin:0}
.wb-cols h3{margin:0 0 8px;font-size:14px;font-weight:650;color:var(--ink)}
.wb-cols-head{margin:0 0 12px}
.wb-cmp{display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,1fr))}
.wb-cmp .card{margin:0}
.wb-cmp h3{margin:0 0 8px;font-size:14px;font-weight:650;display:flex;align-items:center;gap:8px;color:var(--ink)}
.wb-cmp ul{list-style:none;padding:0}
.wb-cmp li{position:relative;padding-left:22px;margin:0 0 6px}
.wb-cmp li::before{position:absolute;left:0;top:0;font-weight:700}
.wb-cmp-ok li::before{content:"✓";color:var(--green)}.wb-cmp-bad li::before{content:"✕";color:var(--red)}
.wb-cmp-warn li::before{content:"!";color:var(--amber)}.wb-cmp-info li::before{content:"•";color:var(--purple)}
.wb-cmp-ok{border-top:3px solid var(--green)}.wb-cmp-bad{border-top:3px solid var(--red)}.wb-cmp-warn{border-top:3px solid var(--amber)}.wb-cmp-info{border-top:3px solid var(--purple)}
.wb-acc{border-top:1px solid var(--line-2)}
.wb-acc:first-of-type{border-top:0}
.wb-acc summary{cursor:pointer;padding:12px 0;font-weight:600;color:var(--ink);list-style:none;display:flex;gap:10px;align-items:center}
.wb-acc summary::-webkit-details-marker{display:none}
.wb-acc summary::before{content:"";width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);transition:transform .15s;flex:none}
.wb-acc[open] summary::before{transform:rotate(45deg)}
.wb-acc>div{padding:0 0 12px 17px;color:var(--ink-2)}
.wb-kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.wb-kpi{border:1px solid var(--line);border-radius:var(--radius-s);padding:14px 16px;background:var(--wash)}
.wb-kpi:first-child{background:var(--purple-dim);border-color:var(--purple-border)}
.wb-kpi .wb-k{font-size:12px;color:var(--muted)}
.wb-kpi .wb-v{font-size:28px;font-weight:650;letter-spacing:-.025em;color:var(--ink);line-height:1.2;margin:2px 0}
.wb-delta{font-size:12px;font-weight:600;color:var(--muted)}
.wb-delta.wb-tone-ok{color:var(--green)}.wb-delta.wb-tone-bad{color:var(--red)}.wb-delta.wb-tone-warn{color:var(--amber)}
.wb-spark{display:block;margin-top:6px}
.wb-tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:99px;border:1px solid var(--line);color:var(--ink-2)}
.wb-tag.wb-tone-ok{background:var(--green-dim);border-color:var(--green-border);color:var(--green)}
.wb-tag.wb-tone-warn{background:var(--amber-dim);border-color:var(--amber-border);color:var(--amber)}
.wb-tag.wb-tone-bad{background:var(--red-dim);border-color:var(--red-border);color:var(--red)}
.wb-tag.wb-tone-info{background:var(--purple-dim);border-color:var(--purple-border);color:var(--purple)}
.wb-tablewrap{overflow-x:auto}
.wb-table{width:100%}
.wb-table th.num,.wb-table td.num{text-align:right}
.wb-table tfoot td{font-weight:650;border-top:1px solid var(--line);border-bottom:0}
.wb-sortbtn{all:unset;cursor:pointer;display:inline-flex;gap:4px;align-items:center;font:inherit;color:inherit}
.wb-sortbtn:focus-visible{outline:2px solid var(--purple);outline-offset:2px;border-radius:4px}
th[aria-sort] .wb-sortbtn::after{content:"▲";font-size:8px}
th[aria-sort="descending"] .wb-sortbtn::after{content:"▼"}
.wb-chart{width:100%;height:auto;display:block}
.wb-chart text{font-family:inherit}
.wb-t{fill:var(--muted);font-size:11px}
.wb-tv{fill:var(--ink-2);font-size:11px;font-weight:600}
.wb-grid{stroke:var(--line);stroke-width:1}
.wb-axis{stroke:var(--faint);stroke-width:1}
.wb-hit{fill:transparent}
.wb-hit:hover{fill:var(--purple-dim)}
.wb-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0 0;padding:0;list-style:none;font-size:12px;color:var(--ink-2)}
.wb-legend li{display:flex;align-items:center;gap:6px;margin:0}
.wb-legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.wb-donut{display:flex;flex-wrap:wrap;gap:20px;align-items:center}
.wb-donut svg{width:240px;max-width:100%;height:auto;flex:none}
.wb-donut ul{margin:0;padding:0;list-style:none;display:grid;gap:6px;font-size:13px;color:var(--ink-2)}
.wb-donut li{display:flex;gap:8px;align-items:center;margin:0}
.wb-donut b{margin-left:auto;padding-left:16px;font-weight:600;color:var(--ink)}
.wb-data{margin-top:12px;font-size:12px}
.wb-data summary{cursor:pointer;color:var(--muted)}
.wb-data table{margin-top:8px}
.wb-meter{margin:0 0 14px}
.wb-meter-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;margin-bottom:6px;color:var(--ink-2)}
.wb-meter-row b{color:var(--ink);font-weight:600}
.wb-meter .bt{height:8px;background:var(--line-2)}
.wb-meter .bf{height:100%}
.wb-steps{list-style:none;margin:0;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.wb-step{border:1px solid var(--line);border-radius:var(--radius-s);padding:14px 16px;background:var(--wash)}
.wb-step .wb-num{display:inline-flex;width:24px;height:24px;border-radius:99px;background:var(--purple);color:#fff;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin-bottom:8px}
:root[data-theme="dark"] .wb-step .wb-num{color:#1a0a2b}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .wb-step .wb-num{color:#1a0a2b}}
.wb-step strong{display:block;color:var(--ink);margin-bottom:2px}
.wb-step p{font-size:13px;color:var(--ink-2)}
.wb-timeline{list-style:none;margin:0;padding:0}
.wb-timeline li{display:grid;grid-template-columns:90px 18px 1fr;gap:10px;padding-bottom:16px;position:relative}
.wb-timeline li::before{content:"";position:absolute;left:99px;top:14px;bottom:-2px;width:2px;background:var(--line)}
.wb-timeline li:last-child::before{display:none}
.wb-when{font-size:12px;font-weight:600;color:var(--muted);text-align:right;padding-top:2px}
.wb-dot{width:12px;height:12px;border-radius:99px;background:var(--purple);margin-top:4px;box-shadow:0 0 0 3px var(--surface);position:relative}
.wb-timeline strong{color:var(--ink)}
.wb-timeline p{font-size:13px;color:var(--ink-2)}
.wb-ask{display:flex;align-items:center;gap:12px}
.wb-empty{color:var(--muted)}
@media(max-width:700px){.wb-page{padding:20px 16px 48px}.wb-cols,.wb-cmp{grid-template-columns:1fr}.wb-timeline li{grid-template-columns:60px 18px 1fr}.wb-timeline li::before{left:69px}}
`.trim();

/* ---------------------------------------------------------------- charts */

const W = 640;
const H = 300;
const PAD = { l: 52, r: 16, t: 16, b: 34 };

function niceScale(lo: number, hi: number): { min: number; max: number; ticks: number[] } {
  lo = Math.min(0, lo);
  hi = Math.max(0, hi);
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { min, max, ticks };
}

type Series = { name: string; values: (number | null)[] };
type ChartData = { labels: string[]; series: Series[] };

export function chartData(ds: Dataset | undefined): ChartData {
  if (!ds) return { labels: [], series: [] };
  const labels = ds.rows.map((r) => r[0] ?? '');
  const series = ds.columns
    .slice(1)
    .map((name, i) => ({ name, values: ds.rows.map((r) => cellNumber(r[i + 1] ?? '')) }))
    .filter((s) => s.values.some((v) => v !== null))
    .slice(0, 8);
  return { labels, series };
}

const color = (i: number) => `var(--wb-c${(i % 8) + 1})`;
const short = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const r1 = (n: number) => Number(n.toFixed(1));

function barPath(x: number, w: number, y0: number, y1: number, radius = 4): string {
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return '';
  const r = Math.min(radius, h, w / 2);
  if (y1 < y0) return `M${r1(x)},${r1(y0)}L${r1(x)},${r1(y1 + r)}Q${r1(x)},${r1(y1)} ${r1(x + r)},${r1(y1)}L${r1(x + w - r)},${r1(y1)}Q${r1(x + w)},${r1(y1)} ${r1(x + w)},${r1(y1 + r)}L${r1(x + w)},${r1(y0)}Z`;
  return `M${r1(x)},${r1(y0)}L${r1(x)},${r1(y1 - r)}Q${r1(x)},${r1(y1)} ${r1(x + r)},${r1(y1)}L${r1(x + w - r)},${r1(y1)}Q${r1(x + w)},${r1(y1)} ${r1(x + w)},${r1(y1 - r)}L${r1(x + w)},${r1(y0)}Z`;
}

function legend(series: { name: string }[]): string {
  if (series.length < 2) return '';
  return `<ul class="wb-legend">${series.map((s, i) => `<li><i style="background:${color(i)}"></i>${esc(s.name)}</li>`).join('')}</ul>`;
}

/** The numbers behind a chart as a table (screen readers, copy and paste, people who do not read charts). */
function dataTable(ds: Dataset): string {
  return `<details class="wb-data"><summary>Show data</summary><table class="tbl"><thead><tr>${ds.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${ds.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c.replace(/^\{(?:ok|warn|bad|info)\}\s*/, ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
}

function axisChart(kind: Exclude<ChartKind, 'donut'>, data: ChartData): string {
  const { labels, series } = data;
  const n = labels.length;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const band = plotW / Math.max(1, n);
  let lo = 0;
  let hi = 0;
  if (kind === 'stacked') {
    for (let i = 0; i < n; i += 1) hi = Math.max(hi, series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  } else {
    for (const s of series) for (const v of s.values) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  const scale = niceScale(lo, hi);
  const y = (v: number) => PAD.t + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
  const compact = Math.max(Math.abs(scale.min), Math.abs(scale.max)) >= 10_000;
  const out: string[] = [];
  for (const t of scale.ticks) {
    out.push(`<line class="wb-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${r1(y(t))}" y2="${r1(y(t))}"/><text class="wb-t" x="${PAD.l - 8}" y="${r1(y(t) + 4)}" text-anchor="end">${esc(fmtNumber(t, compact))}</text>`);
  }
  out.push(`<line class="wb-axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${r1(y(0))}" y2="${r1(y(0))}"/>`);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
  labels.forEach((label, i) => {
    if (i % every === 0) out.push(`<text class="wb-t" x="${r1(PAD.l + band * (i + 0.5))}" y="${H - 12}" text-anchor="middle">${esc(short(label, 12))}</text>`);
  });
  const m = series.length;
  if (kind === 'bar') {
    const groupW = Math.min(band * 0.8, m * 24 + (m - 1) * 2);
    const bw = Math.min(24, (groupW - (m - 1) * 2) / m);
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (v === null) return;
        const x = PAD.l + band * i + (band - (bw * m + (m - 1) * 2)) / 2 + si * (bw + 2);
        const d = barPath(x, bw, y(0), y(v));
        if (d) out.push(`<path d="${d}" fill="${color(si)}"/>`);
        if (m === 1 && n <= 12) out.push(`<text class="wb-tv" x="${r1(x + bw / 2)}" y="${r1(v >= 0 ? y(v) - 6 : y(v) + 14)}" text-anchor="middle">${esc(fmtNumber(v))}</text>`);
      });
    });
  } else if (kind === 'stacked') {
    const bw = Math.min(24, band * 0.6);
    for (let i = 0; i < n; i += 1) {
      let acc = 0;
      const parts = series.map((s, si) => ({ si, v: Math.max(0, s.values[i] ?? 0) })).filter((p) => p.v > 0);
      parts.forEach((p, pi) => {
        const x = PAD.l + band * i + (band - bw) / 2;
        const y0 = y(acc);
        acc += p.v;
        const y1 = y(acc);
        out.push(pi === parts.length - 1
          ? `<path d="${barPath(x, bw, y0, y1)}" fill="${color(p.si)}" stroke="var(--surface)" stroke-width="2"/>`
          : `<rect x="${r1(x)}" y="${r1(y1)}" width="${r1(bw)}" height="${r1(Math.max(0, y0 - y1))}" fill="${color(p.si)}" stroke="var(--surface)" stroke-width="2"/>`);
      });
    }
  } else {
    const x = (i: number) => PAD.l + band * (i + 0.5);
    series.forEach((s, si) => {
      const segments: [number, number][][] = [];
      let current: [number, number][] = [];
      s.values.forEach((v, i) => {
        if (v === null) { if (current.length) segments.push(current); current = []; } else current.push([x(i), y(v)]);
      });
      if (current.length) segments.push(current);
      for (const seg of segments) {
        const pts = seg.map(([px, py]) => `${r1(px)},${r1(py)}`);
        if (kind === 'area' && seg.length > 1) out.push(`<path d="M${pts.join('L')}L${r1(seg[seg.length - 1][0])},${r1(y(0))}L${r1(seg[0][0])},${r1(y(0))}Z" fill="${color(si)}" fill-opacity=".10"/>`);
        out.push(seg.length > 1 ? `<path d="M${pts.join('L')}" fill="none" stroke="${color(si)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '');
      }
      const last = segments.length ? segments[segments.length - 1][segments[segments.length - 1].length - 1] : null;
      if (last) {
        const lastValue = [...s.values].reverse().find((v) => v !== null) as number;
        out.push(`<circle cx="${r1(last[0])}" cy="${r1(last[1])}" r="4" fill="${color(si)}" stroke="var(--surface)" stroke-width="2"/>`);
        if (m === 1 || si === 0) out.push(`<text class="wb-tv" x="${r1(last[0])}" y="${r1(last[1] - 10)}" text-anchor="end">${esc(fmtNumber(lastValue))}</text>`);
      }
    });
  }
  // One hover area per category: the browser shows all values of that category.
  labels.forEach((label, i) => {
    const text = [label, ...series.map((s) => `${s.name}: ${s.values[i] === null ? '–' : fmtNumber(s.values[i] as number)}`)].join('\n');
    out.push(`<rect class="wb-hit" x="${r1(PAD.l + band * i)}" y="${PAD.t}" width="${r1(band)}" height="${plotH}"><title>${esc(text)}</title></rect>`);
  });
  return `<svg class="wb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${kind} chart with ${m} series and ${n} categories`)}">${out.join('')}</svg>`;
}

function donutChart(data: ChartData): string {
  const first = data.series[0];
  let parts = data.labels.map((label, i) => ({ label, v: Math.max(0, first?.values[i] ?? 0) })).filter((p) => p.v > 0);
  if (parts.length > 8) {
    const rest = parts.slice(7).reduce((s, p) => s + p.v, 0);
    parts = [...parts.slice(0, 7), { label: 'Other', v: rest }];
  }
  const total = parts.reduce((s, p) => s + p.v, 0);
  if (total <= 0) return '<p class="wb-empty">Add a column with positive numbers to draw the donut.</p>';
  const cx = 120;
  const cy = 120;
  const R = 108;
  const r = 70;
  let angle = -Math.PI / 2;
  const arcs = parts.map((p, i) => {
    const sweep = (p.v / total) * Math.PI * 2;
    const fill = parts.length === 8 && i === 7 && p.label === 'Other' ? 'var(--faint)' : color(i);
    const a0 = angle;
    angle += sweep;
    if (parts.length === 1) return `<path d="M${cx - R},${cy}A${R},${R} 0 1 1 ${cx + R},${cy}A${R},${R} 0 1 1 ${cx - R},${cy}ZM${cx - r},${cy}A${r},${r} 0 1 0 ${cx + r},${cy}A${r},${r} 0 1 0 ${cx - r},${cy}Z" fill="${fill}" fill-rule="evenodd"><title>${esc(`${p.label}: ${fmtNumber(p.v)} (100%)`)}</title></path>`;
    const a1 = a0 + sweep;
    const big = sweep > Math.PI ? 1 : 0;
    const pt = (rad: number, a: number) => `${r1(cx + rad * Math.cos(a))},${r1(cy + rad * Math.sin(a))}`;
    return `<path d="M${pt(R, a0)}A${R},${R} 0 ${big} 1 ${pt(R, a1)}L${pt(r, a1)}A${r},${r} 0 ${big} 0 ${pt(r, a0)}Z" fill="${fill}" stroke="var(--surface)" stroke-width="2"><title>${esc(`${p.label}: ${fmtNumber(p.v)} (${Math.round((p.v / total) * 100)}%)`)}</title></path>`;
  });
  const key = parts.map((p, i) => `<li><i style="width:10px;height:10px;border-radius:3px;display:inline-block;background:${parts.length === 8 && i === 7 && p.label === 'Other' ? 'var(--faint)' : color(i)}"></i>${esc(p.label)}<b>${esc(fmtNumber(p.v))} · ${Math.round((p.v / total) * 100)}%</b></li>`).join('');
  return `<div class="wb-donut"><svg viewBox="0 0 240 240" role="img" aria-label="Donut chart of ${esc(first?.name ?? 'values')}">${arcs.join('')}<text x="${cx}" y="${cy + 2}" text-anchor="middle" style="fill:var(--ink);font-size:22px;font-weight:650">${esc(fmtNumber(total))}</text><text class="wb-t" x="${cx}" y="${cy + 20}" text-anchor="middle">Total</text></svg><ul>${key}</ul></div>`;
}

function chartBlock(block: Extract<Block, { type: 'chart' }>, layout: Layout): string {
  const ds = layout.datasets.find((d) => d.id === block.dataset);
  const data = chartData(ds);
  const body = !ds || data.series.length === 0 || data.labels.length === 0
    ? '<p class="wb-empty">Add a column with numbers to draw this chart.</p>'
    : block.kind === 'donut' ? donutChart(data) : `${axisChart(block.kind, data)}${legend(data.series)}`;
  return `<section class="card" data-wb-block="${block.id}">${titleHtml(block.title)}${block.sub ? `<p class="wb-sub">${esc(block.sub)}</p>` : ''}${body}${ds && data.series.length ? dataTable(ds) : ''}</section>`;
}

/* ---------------------------------------------------------------- other blocks */

const titleHtml = (title: string) => (title ? `<h2 class="wb-title">${esc(title)}</h2>` : '');
const ICON: Record<Tone, string> = { info: 'i', ok: '✓', warn: '!', bad: '✕' };

/** "{ok} Done" in a table cell becomes a coloured tag with the word next to the colour. */
function cellHtml(cell: string): string {
  const m = /^\{(ok|warn|bad|info)\}\s*(.*)$/.exec(cell);
  return m ? `<span class="wb-tag wb-tone-${m[1]}">${esc(m[2])}</span>` : esc(cell);
}

function tableBlock(block: Extract<Block, { type: 'table' }>, layout: Layout): string {
  const ds = layout.datasets.find((d) => d.id === block.dataset);
  if (!ds) return `<section class="card" data-wb-block="${block.id}">${titleHtml(block.title)}<p class="wb-empty">No data.</p></section>`;
  const numeric = ds.columns.map((_, c) => {
    const cells = ds.rows.map((r) => r[c] ?? '').filter((v) => v.trim() !== '');
    return cells.length > 0 && cells.every((v) => cellNumber(v) !== null && !/^\{/.test(v));
  });
  const head = ds.columns.map((c, i) => `<th${numeric[i] ? ' class="num"' : ''}>${block.sortable ? `<button type="button" class="wb-sortbtn">${esc(c)}</button>` : esc(c)}</th>`).join('');
  const rows = ds.rows.map((r) => `<tr>${r.map((cell, i) => `<td${numeric[i] ? ` class="num" data-n="${cellNumber(cell) ?? ''}"` : ''}>${cellHtml(cell)}</td>`).join('')}</tr>`).join('');
  const foot = block.totals && numeric.some(Boolean)
    ? `<tfoot><tr>${ds.columns.map((_, i) => (i === 0 && !numeric[0] ? '<td>Total</td>' : numeric[i] ? `<td class="num">${esc(fmtNumber(ds.rows.reduce((s, r) => s + (cellNumber(r[i] ?? '') ?? 0), 0)))}</td>` : '<td></td>')).join('')}</tr></tfoot>`
    : '';
  return `<section class="card" data-wb-block="${block.id}">${titleHtml(block.title)}<div class="wb-tablewrap"><table class="tbl wb-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody>${foot}</table></div></section>`;
}

function sparkline(trend: string): string {
  const values = trend.split(/[;,\s]+/).map((v) => cellNumber(v)).filter((v): v is number => v !== null).slice(-12);
  if (values.length < 2) return '';
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => 2 + (i * 76) / (values.length - 1);
  const y = (v: number) => (hi === lo ? 12 : 22 - ((v - lo) / (hi - lo)) * 20);
  const pts = values.map((v, i) => `${r1(x(i))},${r1(y(v))}`);
  const last = values.length - 1;
  return `<svg class="wb-spark" width="80" height="24" viewBox="0 0 80 24" aria-hidden="true"><path d="M${pts.join('L')}" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${r1(x(last))}" cy="${r1(y(values[last]))}" r="3.5" fill="var(--wb-c1)" stroke="var(--surface)" stroke-width="2"/></svg>`;
}

function kpiBlock(block: Extract<Block, { type: 'kpis' }>): string {
  const items = block.items.map((k) => {
    const sign = /^\s*\+/.test(k.delta) ? '▲ ' : /^\s*[-−]/.test(k.delta) ? '▼ ' : '';
    return `<div class="wb-kpi"><div class="wb-k">${esc(k.label)}</div><div class="wb-v">${esc(k.value)}</div>${k.delta ? `<div class="wb-delta wb-tone-${k.tone}">${sign}${esc(k.delta)}</div>` : ''}${sparkline(k.trend)}</div>`;
  });
  return `<section class="card" data-wb-block="${block.id}"><div class="wb-kpis">${items.join('')}</div></section>`;
}

function progressBlock(block: Extract<Block, { type: 'progress' }>): string {
  const rows = block.items.map((p) => {
    const ratio = p.value / p.max;
    const pct = Math.max(0, Math.min(100, ratio * 100));
    const state = block.mode === 'limit' ? (ratio >= 1 ? 'bad' : ratio >= 0.85 ? 'warn' : null) : null;
    const fill = state === 'bad' ? 'var(--red)' : state === 'warn' ? 'var(--amber)' : 'var(--purple)';
    const word = state === 'bad' ? '<span class="wb-tag wb-tone-bad">Over limit</span> ' : state === 'warn' ? '<span class="wb-tag wb-tone-warn">Close to limit</span> ' : '';
    return `<div class="wb-meter"><div class="wb-meter-row"><span>${esc(p.label)}</span><span>${word}<b>${esc(fmtNumber(p.value))}</b> / ${esc(fmtNumber(p.max))} · ${Math.round(ratio * 100)}%</span></div><div class="bt" role="progressbar" aria-valuemin="0" aria-valuemax="${p.max}" aria-valuenow="${p.value}" aria-label="${esc(p.label)}"><div class="bf" style="width:${r1(pct)}%;background:${fill}"></div></div></div>`;
  });
  return `<section class="card" data-wb-block="${block.id}">${titleHtml(block.title)}${rows.join('') || '<p class="wb-empty">No items.</p>'}</section>`;
}

function matrixBlock(block: Extract<Block, { type: 'matrix' }>): string {
  const mw = 640;
  const mh = 340;
  const L = 56;
  const R = 24;
  const T = 16;
  const B = 46;
  const px = (v: number) => L + ((mw - L - R) * v) / 100;
  const py = (v: number) => T + (mh - T - B) * (1 - v / 100);
  const out = [
    `<rect x="${L}" y="${T}" width="${mw - L - R}" height="${mh - T - B}" fill="none" stroke="var(--line)"/>`,
    `<line class="wb-grid" x1="${r1(px(50))}" x2="${r1(px(50))}" y1="${T}" y2="${mh - B}"/><line class="wb-grid" x1="${L}" x2="${mw - R}" y1="${r1(py(50))}" y2="${r1(py(50))}"/>`,
    `<text class="wb-t" x="${r1(px(50))}" y="${mh - 12}" text-anchor="middle">${esc(block.xLabel)} →</text>`,
    `<text class="wb-t" transform="translate(16 ${r1(py(50))}) rotate(-90)" text-anchor="middle">${esc(block.yLabel)} →</text>`,
  ];
  for (const p of block.points) {
    const left = p.x > 78;
    out.push(`<circle cx="${r1(px(p.x))}" cy="${r1(py(p.y))}" r="6" fill="var(--wb-c1)" stroke="var(--surface)" stroke-width="2"><title>${esc(`${p.label}: ${block.xLabel} ${p.x}, ${block.yLabel} ${p.y}`)}</title></circle><text class="wb-tv" x="${r1(px(p.x) + (left ? -11 : 11))}" y="${r1(py(p.y) + 4)}" text-anchor="${left ? 'end' : 'start'}">${esc(short(p.label, 24))}</text>`);
  }
  return `<section class="card" data-wb-block="${block.id}">${titleHtml(block.title)}<svg class="wb-chart" viewBox="0 0 ${mw} ${mh}" role="img" aria-label="${esc(`Matrix of ${block.points.length} points`)}">${out.join('')}</svg></section>`;
}

function renderBlock(block: Block, layout: Layout): string {
  const id = `data-wb-block="${block.id}"`;
  switch (block.type) {
    case 'heading': return `<header class="wb-heading wb-h-${block.level}" ${id}><h2>${esc(block.text)}</h2>${block.sub ? `<p>${esc(block.sub)}</p>` : ''}</header>`;
    case 'text': return `<section class="card" ${id}>${titleHtml(block.title)}${richHtml(block.text)}</section>`;
    case 'quote': return `<section class="card wb-quote" ${id}><p>${esc(block.text)}</p>${block.by ? `<footer>— ${esc(block.by)}</footer>` : ''}</section>`;
    case 'callout': return `<section class="card wb-callout wb-tone-${block.tone}" role="note" ${id}><span class="wb-ico" aria-hidden="true">${ICON[block.tone]}</span><div>${block.title ? `<strong>${esc(block.title)}</strong>` : ''}${richHtml(block.text)}</div></section>`;
    case 'columns': return `<div ${id}>${block.title ? `<h2 class="wb-title wb-cols-head">${esc(block.title)}</h2>` : ''}<div class="wb-cols" style="--n:${block.count}">${block.boxes.map((b) => `<section class="card">${b.title ? `<h3>${esc(b.title)}</h3>` : ''}${richHtml(b.text)}</section>`).join('')}</div></div>`;
    case 'compare': return `<div ${id}>${block.title ? `<h2 class="wb-title wb-cols-head">${esc(block.title)}</h2>` : ''}<div class="wb-cmp">${[block.left, block.right].map((s) => `<section class="card wb-cmp-${s.tone}"><h3>${esc(s.title)}</h3>${richHtml(s.lines.split('\n').map((l) => (/^\s*[-*]\s+/.test(l) || !l.trim() ? l : `- ${l}`)).join('\n'))}</section>`).join('')}</div></div>`;
    case 'accordion': return `<section class="card" ${id}>${titleHtml(block.title)}${block.items.map((i) => `<details class="wb-acc"><summary>${esc(i.title)}</summary><div>${richHtml(i.text)}</div></details>`).join('')}</section>`;
    case 'kpis': return kpiBlock(block);
    case 'table': return tableBlock(block, layout);
    case 'chart': return chartBlock(block, layout);
    case 'progress': return progressBlock(block);
    case 'matrix': return matrixBlock(block);
    case 'steps': return `<section class="card" ${id}>${titleHtml(block.title)}<ol class="wb-steps">${block.items.map((s, i) => `<li class="wb-step"><span class="wb-num">${i + 1}</span><strong>${esc(s.title)}</strong>${richHtml(s.text)}</li>`).join('')}</ol></section>`;
    case 'timeline': return `<section class="card" ${id}>${titleHtml(block.title)}<ol class="wb-timeline">${block.items.map((t) => `<li><span class="wb-when">${esc(t.when)}</span><span class="wb-dot"></span><div><strong>${esc(t.title)}</strong>${richHtml(t.text)}</div></li>`).join('')}</ol></section>`;
    case 'divider': return `<hr class="wb-hr" ${id}>`;
    case 'ask': return `<section class="card wb-ask" ${id}><button type="button" class="primary" data-wb-ask="${esc(block.prompt)}"${block.prompt ? '' : ' disabled'}>${esc(block.label)}</button></section>`;
  }
}

/* ---------------------------------------------------------------- the page */

const SORT_SCRIPT = `document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.wb-sortbtn');if(!b)return;var th=b.parentNode,tb=th.closest('table'),i=Array.prototype.indexOf.call(th.parentNode.children,th),dir=th.getAttribute('aria-sort')==='ascending'?'descending':'ascending';Array.prototype.forEach.call(th.parentNode.children,function(h){h.removeAttribute('aria-sort')});th.setAttribute('aria-sort',dir);var body=tb.tBodies[0],rows=Array.prototype.slice.call(body.rows);rows.sort(function(a,c){var x=a.cells[i],y=c.cells[i],nx=x.getAttribute('data-n'),ny=y.getAttribute('data-n'),r;if(nx!==null&&ny!==null&&nx!==''&&ny!=='')r=parseFloat(nx)-parseFloat(ny);else r=(x.textContent||'').localeCompare(y.textContent||'');return dir==='ascending'?r:-r});rows.forEach(function(r){body.appendChild(r)})});`;
const ASK_SCRIPT = `document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-wb-ask]');if(!b)return;var p=b.getAttribute('data-wb-ask');if(p&&window.parent!==window)window.parent.postMessage({type:'wb:ask',prompt:p},'*')});`;

/** JSON that is safe inside a <script> element. */
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(LINE_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

export function renderSpacePage({ title, layout, css }: { title: string; layout: Layout; css: string }): string {
  const checked = normalizeLayout(layout);
  const body = checked.blocks.length
    ? checked.blocks.map((b) => renderBlock(b, checked)).join('\n')
    : '<section class="card wb-empty"><p>This page is empty. Open the Designer and add a first block.</p></section>';
  const scripts = [checked.blocks.some((b) => b.type === 'table' && b.sortable) ? SORT_SCRIPT : '', checked.blocks.some((b) => b.type === 'ask') ? ASK_SCRIPT : ''].filter(Boolean);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style id="design-system">
${css.trim()}
</style>
<style id="space-layout">
${LAYOUT_CSS}
</style>
</head>
<body>
<main class="wb-page">
${body}
</main>
<script type="application/json" id="${LAYOUT_SCRIPT_ID}">${scriptJson(checked)}</script>${scripts.length ? `\n<script>${scripts.join('\n')}</script>` : ''}
</body>
</html>
`;
}

/** The layout a page was made from, or null when the page was not made by the Designer. */
export function layoutFromHtml(html: string): Layout | null {
  const m = new RegExp(`<script type="application/json" id="${LAYOUT_SCRIPT_ID}">([\\s\\S]*?)</script>`).exec(html);
  if (!m) return null;
  try { return normalizeLayout(JSON.parse(m[1])); } catch { return null; }
}

export const isDesignedPage = (html: string): boolean => html.includes(`id="${LAYOUT_SCRIPT_ID}"`);
