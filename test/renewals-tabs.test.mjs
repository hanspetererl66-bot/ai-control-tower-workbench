import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/renewals/index.html'), 'utf8');
const data = JSON.parse(/<script type="application\/json" id="renewal-data">\s*([\s\S]*?)<\/script>/.exec(html)[1]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollIntoView/.test(m)) errors.push(m); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; w.HTMLElement.prototype.scrollIntoView = () => {}; } });
  await wait(120);
  const w = dom.window, d = w.document;
  return { w, d, q: (s) => d.querySelector(s), qa: (s) => [...d.querySelectorAll(s)], errors, visible: () => [...d.querySelectorAll('.pg')].filter((p) => !p.hidden).map((p) => p.id) };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

test('renewals: five tabs, the overview is the start page, only one panel is shown', async () => {
  const p = await open();
  assert.deepEqual(p.qa('#tabs [role=tab]').map((b) => b.textContent), ['Overview', 'Renewal process', 'Next best action', 'Renewal radar', 'By decision date']);
  assert.deepEqual(p.visible(), ['pg-overview']);
  for (const [id, pg] of [['nba', 'pg-nba'], ['radar', 'pg-radar'], ['list', 'pg-list'], ['process', 'pg-process'], ['overview', 'pg-overview']]) { click(p.w, p.q('#tab-' + id)); assert.deepEqual(p.visible(), [pg], id); assert.equal(p.q('#tab-' + id).getAttribute('aria-selected'), 'true'); }
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals overview: the next six weeks list the late and the upcoming decisions and nothing else', async () => {
  const p = await open();
  const model = p.w.__renewals(), asOf = Date.UTC(2026, 9, 19);
  const days = (c) => Math.round((Date.UTC(+c.decisionDate.slice(0, 4), +c.decisionDate.slice(5, 7) - 1, +c.decisionDate.slice(8, 10)) - asOf) / 864e5);
  const expected = Array.from(model.filter((c) => c.status !== 'Lapsed' && c.stage < 4 && days(c) <= 42), (c) => c.id).sort();
  assert.ok(expected.length >= 4, 'the sample has renewals in the window');
  assert.deepEqual(p.qa('#six .srow').map((b) => b.dataset.id).sort(), expected);
  assert.equal(p.qa('#six .rdot').length, expected.length);
  const late = p.qa('#six .sdate.late').length;
  assert.equal(late, model.filter((c) => c.status !== 'Lapsed' && days(c) < 0).length, 'late renewals come first and say so');
  // the customer context narrows the list
  const sel = p.q('#customer'); sel.value = 'lindenau'; sel.dispatchEvent(new p.w.Event('change'));
  assert.deepEqual(p.qa('#six .srow').map((b) => b.dataset.id).sort(), Array.from(model.filter((c) => c.customerId === 'lindenau' && expected.includes(c.id)), (c) => c.id).sort());
  p.w.close();
});

test('renewals overview: every customer is a planet and every contract a dot; a click opens the customer or the renewal', async () => {
  const p = await open();
  assert.equal(p.qa('#land .planet').length, data.customers.length);
  assert.equal(p.qa('#land .moon').length, data.cases.length);
  click(p.w, p.qa('#land .moon')[0]);
  assert.deepEqual(p.visible(), ['pg-list']);
  assert.ok(p.w.__state.sel);
  click(p.w, p.q('#tab-overview'));
  click(p.w, p.qa('#land .planet')[1]);
  assert.deepEqual(p.visible(), ['pg-process']);
  assert.equal(p.w.__state.customer, data.customers[1].id);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals process: the customer map, the four standing tiles and the details with the e-mails belong to the chosen customer', async () => {
  const p = await open();
  click(p.w, p.q('#tab-process'));
  assert.equal(p.qa('#cust-cards .ccard').length, data.customers.length, 'without a customer the three customers can be chosen');
  assert.equal(p.q('#cmap-wrap').hidden, true);
  for (const cu of data.customers) {
    const sel = p.q('#customer'); sel.value = cu.id; sel.dispatchEvent(new p.w.Event('change'));
    const mine = data.cases.filter((c) => c.customerId === cu.id);
    assert.equal(p.q('#cmap-wrap').hidden, false);
    assert.equal(p.qa('#cmap .cnode').length, mine.length, `${cu.id}: one node per contract`);
    assert.equal(p.qa('#stand .stile').length, 4, 'tickets, invoices, usage, growth');
    assert.deepEqual(p.qa('#stand .stile').map((b) => b.dataset.focus), ['ticket', 'invoice', 'usage', 'growth']);
    assert.match(p.q('#cust-panel h2').textContent, new RegExp(cu.name.split(' ')[0]));
    assert.ok(p.q('#cust-panel .mtl, #cust-panel .sub'), 'e-mail communication in the details');
    assert.equal(p.q('#cmap h2').textContent.includes(cu.name), true);
  }
  // a contract is picked: its details and its phase come up, the full details open on request
  const node = p.qa('#cmap .cnode')[0]; click(p.w, node);
  assert.equal(p.w.__state.csel, node.dataset.id);
  assert.ok(p.q('#cust-panel .cmini'));
  assert.equal(p.qa('#process .ph.here').length, 1, 'the phase of the picked contract is marked');
  p.q('#stand .stile[data-focus=ticket]').click();
  assert.equal(p.w.__state.focus, 'ticket');
  p.q('#cm-open').click();
  assert.deepEqual(p.visible(), ['pg-list']);
  assert.equal(p.w.__state.sel, node.dataset.id);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals: next best action queue, radar and list follow the customer; the demo opens the right tab at every step', async () => {
  const p = await open();
  const model = p.w.__renewals();
  click(p.w, p.q('#tab-nba'));
  const all = p.qa('#queue .qrow').length;
  assert.equal(all, model.filter((c) => c.status !== 'Lapsed' && c.stage < 4 && !c.autoRun).length);
  const sel = p.q('#customer'); sel.value = 'hanse'; sel.dispatchEvent(new p.w.Event('change'));
  assert.equal(p.qa('#queue .qrow').length, model.filter((c) => c.customerId === 'hanse' && c.status !== 'Lapsed' && c.stage < 4 && !c.autoRun).length);
  click(p.w, p.q('#tab-list'));
  assert.ok(p.qa('#rows tr').every((tr) => /Hanse/.test(tr.textContent)));
  p.q('#reset').click();
  assert.deepEqual(p.visible(), ['pg-overview'], 'reset starts at the overview');
  p.q('#g-start').click();
  const seen = [];
  for (let i = 0; i < 10; i++) { seen.push(p.visible()[0]); assert.ok(p.q('.spot'), `step ${i + 1} outlines its place`); const next = p.q('#g-next'); if (i < 9) next.click(); }
  assert.deepEqual(seen, ['pg-overview', 'pg-process', 'pg-process', 'pg-radar', 'pg-list', 'pg-list', 'pg-list', 'pg-list', 'pg-overview', 'pg-list']);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals motion: entrance runs once per picture, with reduced motion nothing animates, colours are tokens, no network', () => {
  assert.match(html, /const enter = \(key\) => \{ if \(REDUCED \|\| played\[key\]\) return ''; played\[key\] = true; return ' enter'; \};/);
  assert.match(html, /prefers-reduced-motion:reduce\)\{\.pg:not\(\[hidden\]\)\{animation:none\}/);
  const css = html.slice(html.indexOf('/* ---- Tabs and customer context'), html.indexOf('</style>', html.indexOf('/* ---- Tabs and customer context')));
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b|rgba?\(/, 'only tokens in the new styles');
  assert.doesNotMatch(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});

test('renewals journey: the rail names the customer, a hand-over from Sales opens the renewal of the contract, stops in other Spaces hand over with the deal', async () => {
  const p = await open();
  const sent = [];
  Object.defineProperty(p.w, 'parent', { value: { postMessage: (m) => sent.push(m) } });
  assert.equal(p.q('.jr-who b').textContent, 'Lindenau Pharma AG');
  assert.equal(p.q('.jr button[aria-current=true]').textContent, 'Renewals due');
  p.w.dispatchEvent(new p.w.MessageEvent('message', { data: { type: 'wb:restore', state: null, handoffs: [{ from: 'sales', payload: { journey: { customer: 'lindenau', step: 'decide', deal: 'C-2026-0051' } } }, { payload: { journey: { customer: 'evil', deal: 'C-2026-0051' } } }, { payload: { journey: { customer: 'nordlicht', step: 'decide' } } }] }, source: p.w.parent }));
  assert.deepEqual(p.visible(), ['pg-list']);
  assert.equal(p.w.__state.customer, 'lindenau');
  assert.equal(p.w.__state.sel, 'R-C-2026-0051', 'the renewal of the contract (deal id) opens');
  click(p.w, p.q('.jr button[data-jr-stop=renewal-actions]'));
  assert.deepEqual(p.visible(), ['pg-nba']);
  click(p.w, p.q('.jr button[data-jr-stop=pipeline]'));
  click(p.w, p.q('.jr button[data-jr-stop=mails]'));
  assert.deepEqual(sent.map((m) => [m.to, m.payload.journey.customer, m.payload.journey.deal]), [['sales', 'lindenau', 'C-2026-0051'], ['customer-emails', 'lindenau', 'C-2026-0051']]);
  assert.deepEqual(p.errors, []);
  p.w.close();
});
