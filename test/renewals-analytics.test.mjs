import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/renewals-analytics/index.html'), 'utf8');
const sourceLogic = readFileSync(join(ROOT, 'examples/renewals/logic.js'), 'utf8');
const data = JSON.parse(/<script type="application\/json" id="renewal-data">\s*([\s\S]*?)<\/script>/.exec(html)[1]);
const logic = vm.runInNewContext(`${sourceLogic}; ({ signals, retention })`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/' });
  await wait(100);
  return { w: dom.window, d: dom.window.document, errors };
}

test('renewal analytics: embeds the shared logic and the same data as the Renewals Space', () => {
  const embedded = /<script id="renewal-logic">\n([\s\S]*?)\n<\/script>/.exec(html)[1];
  assert.equal(embedded, sourceLogic.replace(/\n$/, ''), 'the page carries examples/renewals/logic.js unchanged');
  assert.deepEqual(data, JSON.parse(readFileSync(join(ROOT, 'examples/renewals/renewals.json'), 'utf8')));
});

test('renewal analytics: header numbers come from the data and the rules', async () => {
  const p = await open();
  const live = data.cases.filter((c) => c.status !== 'Lapsed');
  const health = (c) => logic.signals(c, data.asOf).health;
  const eur = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const open_ = live.reduce((a, c) => a + c.annualEur, 0);
  const red = live.filter((c) => health(c) === 'red');
  const kpis = [...p.d.querySelectorAll('#kpis .kpi')].map((k) => k.querySelector('.v').textContent);
  assert.equal(kpis[0], eur(open_));
  assert.equal(kpis[2], eur(red.reduce((a, c) => a + c.annualEur, 0)));
  assert.equal(kpis[4], String(live.filter((c) => !c.offer).length));
  const held = Math.round(live.reduce((a, c) => a + c.annualEur * logic.retention(c, health(c), data.rules), 0));
  assert.equal(kpis[1], eur(held));
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewal analytics: names are hidden by default and shown only on request', async () => {
  const p = await open();
  const owners = [...new Set(data.cases.filter((c) => c.status !== 'Lapsed').map((c) => c.owner))];
  const text = () => p.d.querySelector('#team').textContent;
  for (const o of owners) assert.ok(!text().includes(o), `${o} is hidden`);
  assert.match(text(), /Owner 1/);
  p.d.querySelector('#names').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  for (const o of owners) assert.ok(text().includes(o), `${o} is shown after the switch`);
  assert.equal(p.d.querySelector('#names').getAttribute('aria-pressed'), 'true');
  p.w.close();
});

test('renewal analytics: read only, no network and no storage', () => {
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
  const posts = [...script.matchAll(/window\.parent\.postMessage/g)].length;
  assert.equal(posts, 1, 'one single place posts to the app');
  assert.deepEqual([...new Set([...script.matchAll(/type: '(wb:[a-z-]+)'/g)].map((m) => m[1]))].sort(), ['wb:ask', 'wb:handoff'], 'only questions to Joule and hand-overs');
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
});

test('renewal analytics: is installed by npm run install:examples', () => {
  assert.equal(EXAMPLE_SPACES['renewals-analytics'], 'renewals-analytics');
});

test('renewal analytics: the sample offers cover several stages, a price above the cap and two competitors', () => {
  const offers = data.cases.filter((c) => c.offer && c.status !== 'Lapsed').map((c) => c.offer);
  assert.ok(new Set(offers.map((o) => o.stage)).size >= 2, 'at least two offer stages');
  assert.ok(data.cases.some((c) => c.offer && c.offer.annualEur / c.offer.currentAnnualEur - 1 > c.upliftCapPct / 100), 'a price above the cap');
  assert.ok(new Set(offers.map((o) => o.competitor).filter((x) => x && x !== 'None')).size >= 2, 'two competitors');
  const ids = data.cases.filter((c) => c.offer).map((c) => c.offer.id);
  assert.equal(new Set(ids).size, ids.length, 'offer ids are unique');
});

async function openInApp() {
  const sent = [], errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { Object.defineProperty(w, 'parent', { value: { postMessage: (m) => sent.push(m) }, configurable: true }); } });
  await wait(100);
  return { w: dom.window, d: dom.window.document, sent, errors };
}

test('renewal analytics: a row opens the renewal in the Renewals Space with a hand-over the Renewals page accepts', async () => {
  const p = await openInApp();
  const row = p.d.querySelector('#risks tr[data-c]');
  row.dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  const m = p.sent.find((x) => x.type === 'wb:handoff');
  assert.ok(m, 'a hand-over was posted');
  assert.equal(m.to, 'renewals');
  const c = data.cases.find((x) => x.contractId === row.dataset.c);
  assert.deepEqual(JSON.parse(JSON.stringify(m.payload.journey)), { customer: c.customerId, step: 'decide', tab: 'list', deal: c.contractId });
  assert.match(m.payload.journey.deal, /^[A-Za-z0-9-]{1,30}$/, 'passes the journey check of the Renewals page');
  p.d.querySelector('#to-renewals').click();
  assert.equal(p.sent.at(-1).to, 'renewals');
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewal analytics: the question to an owner names no person unless names are shown', async () => {
  const p = await openInApp();
  const ask = () => p.sent.filter((x) => x.type === 'wb:ask').at(-1).prompt;
  p.d.querySelector('#team [data-ask]').click();
  const owners = [...new Set(data.cases.map((c) => c.owner))];
  for (const o of owners) assert.ok(!ask().includes(o), o + ' stays out of the prompt');
  assert.match(ask(), /workload and blockers, not performance/);
  assert.ok(ask().length <= 600);
  p.d.querySelector('#names').click();
  p.d.querySelector('#team [data-ask]').click();
  assert.ok(owners.some((o) => ask().includes(o)), 'the name appears once the person chose to show names');
  p.w.close();
});
