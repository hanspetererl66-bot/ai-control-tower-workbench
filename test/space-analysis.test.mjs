import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import test from 'node:test';
import { FEATURES, analyzeSpace, detectFeatures, failedReport, filterReports, fixRequest, summarize } from '../src/space-analysis.ts';

const NOW = Date.parse('2026-11-13');
const meta = (o = {}) => ({ slug: 's', title: 'S', description: 'd', insights: ['i'], domain: 'Sales', cardCount: 3, updatedAt: NOW - 5 * 86_400_000, ...o });
const rules = (r) => r.findings.map((f) => f.rule);

test('a clean Space has no findings and full score', () => {
  const r = analyzeSpace(meta(), '<style>:root{--a:#fff} .x{color:var(--ink,#111)}</style><div class="card">x</div>', NOW);
  assert.deepEqual(r.findings, []); assert.equal(r.health, 'ok'); assert.equal(r.score, 100);
});

test('network and storage use is high, and data blocks are not code', () => {
  const html = '<script>fetch("/x"); localStorage.setItem("a",1)</script><img src="https://cdn.example/a.png"><script type="application/json">{"u":"https://a.b","t":"fetch( and localStorage in text"}</script>';
  const r = analyzeSpace(meta(), html, NOW);
  assert.deepEqual(rules(r).sort(), ['network', 'storage']);
  assert.equal(r.health, 'fix');
  assert.equal(r.findings.find((f) => f.rule === 'network').count, 2);
  const onlyData = analyzeSpace(meta(), '<script type="application/json">{"u":"https://a.b","t":"localStorage fetch("}</script>', NOW);
  assert.deepEqual(onlyData.findings, []);
});

test('colours: tokens, fallbacks, anchors and ids are fine; loose hex is not', () => {
  assert.deepEqual(rules(analyzeSpace(meta(), '<style>:root{--c:#abc123}.a{color:var(--c,#fff)}</style><a href="#top" id="#x">&#8211;</a><svg><use href="#i"/></svg>', NOW)), []);
  const r = analyzeSpace(meta(), '<style>.a{color:#123456;background:#fff}</style>', NOW);
  assert.deepEqual(rules(r), ['colors']); assert.equal(r.findings[0].count, 2); assert.equal(r.findings[0].severity, 'low'); assert.equal(r.health, 'minor', 'only low findings');
  assert.equal(analyzeSpace(meta(), `<style>${'.a{color:#123456}'.repeat(13)}</style>`, NOW).findings[0].severity, 'medium');
});

test('size, cards, description, old data and idle time', () => {
  assert.ok(rules(analyzeSpace(meta(), 'x'.repeat(450_000), NOW)).includes('size'));
  assert.equal(analyzeSpace(meta(), 'x'.repeat(1_100_000), NOW).findings.find((f) => f.rule === 'size').severity, 'medium');
  const e = analyzeSpace(meta({ cardCount: 0 }), '', NOW); assert.deepEqual(rules(e), ['empty']); assert.equal(e.health, 'review');
  const m = analyzeSpace(meta({ description: '', insights: [], domain: undefined }), '', NOW).findings[0];
  assert.equal(m.rule, 'metadata'); assert.equal(m.count, 3); assert.match(m.detail, /description, insights, a group/);
  assert.ok(rules(analyzeSpace(meta(), '{"asOf":"2026-08-01"}', NOW)).includes('stale'));
  assert.ok(!rules(analyzeSpace(meta(), '{"asOf":"2026-11-01"}', NOW)).includes('stale'));
  assert.ok(rules(analyzeSpace(meta({ updatedAt: NOW - 120 * 86_400_000 }), '', NOW)).includes('idle'));
});

test('worst findings come first; health and score follow them', () => {
  const r = analyzeSpace(meta({ cardCount: 0, description: '' }), 'fetch(1) .a{color:#123456}', NOW);
  assert.equal(r.findings[0].severity, 'high'); assert.equal(r.health, 'fix'); assert.equal(r.score, 100 - 25 - 10 - 3 - 3);
});

test('a page that cannot be read is never reported as clean', () => {
  const r = failedReport(meta(), 'HTTP 404'); assert.equal(r.health, 'review'); assert.equal(r.error, 'HTTP 404');
});

test('summary, filter and fix request', () => {
  const a = analyzeSpace(meta({ slug: 'a', title: 'Alpha', domain: 'Sales' }), 'fetch(1)', NOW);
  const b = analyzeSpace(meta({ slug: 'b', title: 'Beta', domain: 'HR' }), '', NOW);
  const c = analyzeSpace(meta({ slug: 'c', title: 'Gamma', domain: 'HR', cardCount: 0 }), '', NOW);
  const all = [b, c, a], s = summarize(all);
  assert.deepEqual([s.spaces, s.clean, s.minor, s.review, s.fix, s.findings], [3, 1, 0, 1, 1, 2]);
  assert.deepEqual(filterReports(all, 'all', '', '').map((r) => r.slug), ['a', 'c', 'b'], 'worst first');
  assert.deepEqual(filterReports(all, 'all', 'HR', '').map((r) => r.slug), ['c', 'b']);
  assert.deepEqual(filterReports(all, 'fix', '', '').map((r) => r.slug), ['a']);
  assert.deepEqual(filterReports(all, 'all', '', 'network').map((r) => r.slug), ['a']);
  assert.match(fixRequest(a), /Alpha.*\n1\. Reaches for the network/);
  assert.match(fixRequest(b), /no findings/);
});

test('every bundled example Space can be analysed, and none uses the network or browser storage', () => {
  const dir = new URL('../examples/', import.meta.url);
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = new URL(`${name}/index.html`, dir); if (!existsSync(p)) continue;
    const r = analyzeSpace(meta({ slug: name, title: name }), readFileSync(p, 'utf8'), NOW); n++;
    assert.ok(Number.isFinite(r.score), name);
    assert.ok(!r.findings.some((f) => f.rule === 'storage'), `${name} uses browser storage`);
  }
  assert.ok(n > 30);
});

test('Space Analysis is a tile of the Admin console, reads only, and keeps the Space rules itself', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const admin = read('src/ui/AdminView.tsx'), view = read('src/ui/SpaceAnalysisView.tsx'), rail = read('src/ui/Rail.tsx'), app = read('src/App.tsx'), css = read('src/theme.css');
  assert.match(admin, /aria-label="Space Analysis"/); assert.match(admin, /Open Space Analysis/); assert.match(admin, /onOpenAnalysis/);
  assert.match(rail, /ADMIN_VIEWS: View\[\] = \[[^\]]*'spaceanalysis'/); assert.match(rail, /View = [^;]*'spaceanalysis'/);
  assert.match(app, /view === 'spaceanalysis'/); assert.match(app, /onBack=\{\(\) => setView\('admin'\)\}/);
  assert.doesNotMatch(read('src/ui/DevelopHub.tsx'), /paceAnalysis/, 'not part of Develop');
  assert.match(view, /fetchHtml/); assert.match(view, /Copy fix request/); assert.match(view, /not counted as clean/);
  assert.doesNotMatch(view, /localStorage|XMLHttpRequest/);
  const block = css.slice(css.indexOf('/* Admin console: Space Analysis'));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}\b/, "colours only as tokens");
});

test('functions are counted from the page, not from its data', () => {
  const html = '<div role="tab">A</div><div role="tab">B</div><table></table><input type="search"><select></select><button>x</button><button>y</button><svg viewBox="0 0 1 1"></svg><div class="kpi-card"></div><dialog></dialog><script>window.parent.postMessage({},"*");document.addEventListener("keydown",f)</script><script type="application/json">{"t":"<table> <button> download"}</script>';
  const f = detectFeatures(html);
  assert.deepEqual([f.tabs, f.tables, f.search, f.actions, f.charts, f.kpis, f.detail, f.chat, f.keyboard], [2, 1, 1, 2, 1, 1, 1, 1, 1]);
  assert.equal(f.export, 0, 'text in a data block is not a function');
  assert.equal(Object.keys(f).length, FEATURES.length);
});

test('the summary says in how many Spaces a function is found, and the filter lists with or without', () => {
  const a = analyzeSpace(meta({ slug: 'a', title: 'A' }), '<table></table><table></table>', NOW);
  const b = analyzeSpace(meta({ slug: 'b', title: 'B' }), '<div></div>', NOW);
  const bad = failedReport(meta({ slug: 'c', title: 'C' }), 'HTTP 500');
  const sum = summarize([a, b, bad]), t = sum.features.find((x) => x.id === 'tables');
  assert.deepEqual([t.spaces, t.total, t.share], [1, 2, 0.5], 'the unreadable Space is not counted either way');
  assert.deepEqual(filterReports([a, b, bad], 'all', '', '', { id: 'tables', has: true }).map((r) => r.slug), ['a']);
  assert.deepEqual(filterReports([a, b, bad], 'all', '', '', { id: 'tables', has: false }).map((r) => r.slug), ['b']);
});
