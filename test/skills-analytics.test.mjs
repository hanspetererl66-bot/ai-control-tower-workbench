import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const html = read('examples/skill-marketplace/index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const errs = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollTo/.test(m)) errs.push(m); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  await sleep(200);
  const w = dom.window, d = w.document;
  const post = (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w }));
  return { w, d, post, errs, $: (q) => d.querySelector(q), $$: (q) => [...d.querySelectorAll(q)] };
}

test('the marketplace tab that was called "Insights" is now "Skills analytics" (tab and sub-navigation), and no old name is left in the page', async () => {
  const p = await open();
  try {
    assert.equal(p.$('#tabs [data-group="insights"]').textContent, 'Skills analytics');
    assert.equal(p.$('#subtabs').getAttribute('aria-label'), 'Skills analytics');
    assert.deepEqual(p.$$('#subtabs button').map((b) => b.dataset.tab), ['overview', 'ranking', 'impact', 'governance', 'gaps', 'approvals', 'hints'], 'the sub-tabs are the same');
    assert.doesNotMatch(p.d.body.innerHTML.replace(/data-group="insights"/g, ''), /\bInsights\b/);
    assert.deepEqual(p.errs, []);
  } finally { p.w.close(); }
});

test('the app can open a tab of the marketplace (the Admin tile opens the overview); only a known tab name is used', async () => {
  const p = await open();
  try {
    const shown = () => p.$$('.pg.on').map((x) => x.id);
    assert.deepEqual(shown(), ['pg-discover']);
    p.post({ type: 'ct:open-tab', tab: 'overview' });
    assert.deepEqual(shown(), ['pg-overview']);
    assert.equal(p.$('#tabs [data-group="insights"]').getAttribute('aria-selected'), 'true');
    assert.equal(p.$('#subtabs').hidden, false);
    p.post({ type: 'ct:open-tab', tab: 'ranking' });
    assert.deepEqual(shown(), ['pg-ranking']);
    for (const bad of ['nope', '', '__proto__', 'overview ', 5, null, { x: 1 }]) { p.post({ type: 'ct:open-tab', tab: bad }); assert.deepEqual(shown(), ['pg-ranking'], String(bad)); }
    p.post({ type: 'other', tab: 'catalog' });
    assert.deepEqual(shown(), ['pg-ranking'], 'only the one message type');
    const foreign = new p.w.MessageEvent('message', { data: { type: 'ct:open-tab', tab: 'catalog' }, source: null });
    p.w.dispatchEvent(foreign);
    assert.deepEqual(shown(), ['pg-ranking'], 'a message that does not come from the app is ignored');
    assert.deepEqual(p.errs, []);
  } finally { p.w.close(); }
});

test('the Admin console has a fourth tile "Skills analytics" that opens the marketplace overview, and the app wires it', () => {
  const admin = read('src/ui/AdminView.tsx');
  assert.match(admin, /aria-label="Skills analytics"/);
  assert.match(admin, /<span className="develop-card-title">Skills analytics<\/span>/);
  assert.match(admin, /onClick=\{onOpenSkillsAnalytics\}>Open Skills analytics</);
  assert.equal((admin.match(/<section className="develop-card develop-card-block"/g) ?? []).length, 5, 'with Space Analysis from main');
  const app = read('src/App.tsx');
  assert.match(app, /onOpenSkillsAnalytics=\{openSkillsAnalytics\}/);
  assert.match(app, /setSelectedSpace\('skill-marketplace'\);\s*setSpaceTab\(\{ tab: 'overview', nonce: Date\.now\(\), space: 'skill-marketplace' \}\)/);
  assert.match(app, /The Skill Marketplace Space is not installed/);
  const css = read('src/theme.css');
  assert.match(css, /\.adm-logo-analytics \{ --adm-tone: var\(--adm-rose\); \}/);
  assert.match(css, /--adm-rose: #be185d/);
  assert.match(css, /\[data-theme="dark"\] \{[^}]*--adm-rose: #f9a8d4/);
});
