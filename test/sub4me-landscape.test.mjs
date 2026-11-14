import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/sub4me/index.html'), 'utf8');
const data = JSON.parse(/id="s4m-data">([\s\S]*?)<\/script>/.exec(html)[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(reduce = false) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, beforeParse(win) { if (reduce) win.matchMedia = (q) => ({ matches: /reduce/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }); } });
  const w = dom.window, d = w.document;
  const $ = (q) => d.querySelector(q), $$ = (q) => [...d.querySelectorAll(q)];
  const tab = (id) => $(`[data-tab=${id}]`).click();
  return { w, d, $, $$, tab, errs, close: () => w.close() };
}
async function withPage(fn, reduce = false) {
  const page = open(reduce);
  try { await fn(page); } finally { page.close(); }
}
const unpaid = data.invoices.filter((i) => i.status === 'Open' || i.status === 'Overdue');
const openTickets = (p) => data.tickets.filter((t) => t.product === p && t.status !== 'Closed' && t.status !== 'Solution provided');

test('the map shows a node per active contract, an offer mark per offer, an invoice mark per contract with unpaid invoices, and a ring per AI product', async () => withPage(async ({ $$, tab, errs }) => {
  tab('landscape');
  assert.equal($$('#land .node').length, $$('#land .orb').length / 2, 'every contract has a back and a front group');
  const offerMarks = $$('#land .mk.off');
  assert.equal(offerMarks.length, data.offers.length, 'every offer is on the map, one without a contract next to the hub');
  assert.deepEqual(offerMarks.map((m) => m.dataset.id).sort(), data.offers.map((o) => o.id).sort());
  const contractsWithUnpaid = new Set(unpaid.map((i) => i.contractId).filter(Boolean));
  assert.deepEqual($$('#land .mk.inv').map((m) => m.dataset.c).sort(), [...contractsWithUnpaid].filter((id) => $$('#land .node').some((n) => n.dataset.c === id)).sort());
  assert.equal($$('#land .mk.inv.bad').length, 1, 'the overdue invoice is marked red');
  assert.equal($$('#land .sat').length, 5);
  for (const t of $$('#land .tk')) {
    const p = data.products[Number(t.dataset.p)];
    assert.equal(Number(t.querySelector('text').textContent), openTickets(p.name).length, p.name);
  }
  assert.equal($$('#land .tk').length, data.products.filter((p) => openTickets(p.name).length).length, 'a ring without open tickets has no number');
  assert.deepEqual(errs, []);
  }, false));

test('summary chips count what is on the page; "to decide" selects the most urgent contract', async () => withPage(async ({ $, $$, tab }) => {
  tab('landscape');
  await sleep(1100);
  const chips = $$('#land .lchip').map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  assert.match(chips.join('|'), new RegExp(`${unpaid.length} unpaid invoices \\(1 overdue\\)`));
  assert.match(chips.join('|'), new RegExp(`${data.tickets.filter((t) => t.status !== 'Closed' && t.status !== 'Solution provided').length} open tickets`));
  const before = $('#land .node.sel').dataset.c;
  $('#land [data-go=decide]').click();
  const urgent = $('#land .node.sel').dataset.c;
  assert.ok(urgent, 'a contract is selected');
  assert.equal($$('#land .node.sel').length, 1);
  assert.ok(before);
  }, false));

test('a click on an offer, an unpaid-invoice mark, a ring and a ticket number opens the right page and marks the rows', async () => withPage(async ({ $, $$, tab }) => {
  tab('landscape');
  const offer = $$('#land .mk.off').find((m) => m.dataset.id === 'OFF-2026-0318');
  offer.dispatchEvent(new offer.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  assert.equal($('#pg-contracts').classList.contains('on'), true);
  const row = $('#offers tbody tr[aria-selected=true]');
  assert.match(row.textContent, /OFF-2026-0318/);
  assert.ok(row.classList.contains('flash'));
  tab('landscape');
  const inv = $('#land .mk.inv.bad');
  inv.dispatchEvent(new inv.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  assert.equal($('#pg-invoices').classList.contains('on'), true);
  const flashed = $$('#invoices tr.flash').map((r) => r.dataset.id);
  assert.ok(flashed.includes('INV-2026-10621'), 'the overdue invoice is marked');
  assert.ok($$('#invoices tr.flash').every((r) => r.dataset.contract === inv.dataset.c && r.dataset.open === '1'), 'only unpaid invoices of that contract');
  tab('landscape');
  const ring = $('#land .sat[data-p="1"]');
  ring.dispatchEvent(new ring.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  assert.equal($('#pg-usage').classList.contains('on'), true);
  assert.match($('#products tr[aria-selected=true]').textContent, new RegExp(data.products[1].name));
  tab('landscape');
  const tk = $('#land .tk[data-p="1"]');
  tk.dispatchEvent(new tk.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  assert.equal($('#pg-tickets').classList.contains('on'), true);
  assert.deepEqual($$('#tickets tr.flash').map((r) => r.dataset.id), openTickets(data.products[1].name).map((t) => t.id));
  }, false));

test('Enter and Space on a mark do the same as a click', async () => withPage(async ({ $, tab }) => {
  tab('landscape');
  const w = $('#land').ownerDocument.defaultView;
  const mark = $('#land .mk.off');
  mark.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal($('#pg-contracts').classList.contains('on'), true);
  }, false));

test('the detail of a contract lists its offers and unpaid invoices; the AI-units contract lists the products with their tickets', async () => withPage(async ({ $, $$, tab }) => {
  tab('landscape');
  const ariba = $$('#land .node').find((n) => n.dataset.c === 'C-2023-0390');
  ariba.dispatchEvent(new ariba.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  const det = $('#land-det').textContent.replace(/\s+/g, ' ');
  assert.match(det, /Offers for this contract/);
  assert.match(det, /OFF-2026-0318/);
  assert.match(det, /Unpaid invoices/);
  assert.match(det, /1 overdue/);
  const ai = $$('#land .node').find((n) => /AI units/.test(n.getAttribute('aria-label')));
  ai.dispatchEvent(new ai.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  const rel = $$('#land-det .land-rel').map((r) => r.textContent.replace(/\s+/g, ' '));
  for (const p of data.products) assert.ok(rel.some((r) => r.includes(p.name)), p.name);
  assert.match(rel.join('|'), /BTP AI Core · \d+% used · 1 open ticket/);
  }, false));

test('the orbit turns the contracts, keeps texts upright, waits while the pointer is on the map, and Pause stops it', async () => withPage(async ({ $, $$, tab }) => {
  tab('landscape');
  const w = $('#land').ownerDocument.defaultView;
  const angle = () => Number(/rotate\(([-\d.]+)/.exec($('#land .orb').getAttribute('transform') ?? 'rotate(0')[1]);
  await sleep(700);
  const a1 = angle();
  assert.ok(a1 > 0, 'the contracts have started to turn');
  const up = $('#land .up');
  assert.ok(Math.abs(Number(/rotate\(([-\d.]+)/.exec(up.getAttribute('transform'))[1]) + a1) < 0.5, 'the text is turned back by the same angle');
  assert.equal($$('#land .orb').every((g) => g.getAttribute('transform') === $('#land .orb').getAttribute('transform')), true, 'all contracts turn together, so nothing starts to overlap');
  $('#land').dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  const svg = $('#land svg');
  svg.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  const held = angle();
  await sleep(400);
  assert.equal(angle(), held, 'the orbit waits while the pointer is on the map');
  $('#land').dispatchEvent(new w.MouseEvent('mouseleave'));
  await sleep(400);
  assert.ok(angle() > held, 'and goes on when it leaves');
  $('#land-play').click();
  assert.equal($('#land-play').getAttribute('aria-pressed'), 'true');
  const stopped = angle();
  await sleep(300);
  assert.equal(angle(), stopped, 'Pause holds it');
  $('#land-play').click();
  await sleep(300);
  assert.ok(angle() > stopped, 'Play starts it again');
  tab('overview');
  const away = angle();
  await sleep(300);
  assert.equal(angle(), away, 'nothing turns while another tab is shown');
  }, false));

test('with reduced motion nothing turns and there is no Pause button; the marks are still there and clickable', async () => withPage(async ({ $, $$, tab }) => {
  tab('landscape');
  await sleep(400);
  assert.equal($('#land-play'), null);
  assert.equal($('#land .orb').getAttribute('transform'), null, 'no turning');
  assert.ok($$('#land .mk').length > 0 && $$('#land .sat').length === 5);
  }, true));

test('page: the new landscape styles use only tokens, the page still makes no network calls, and the map is described for screen readers', () => {
  const css = html.slice(html.indexOf('/* Landscape */'), html.indexOf('<style id="design-system">'));
  assert.doesNotMatch(css.replace(/#fff/g, ''), /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  assert.doesNotMatch(html.slice(html.indexOf('<body')), /fetch\(|localStorage|XMLHttpRequest/);
  assert.match(html, /aria-label="Contract landscape\. Contracts, offers, unpaid invoices and AI-unit products are buttons that open their page\."/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{body\.s4m \.pg \*/, 'the existing rule that stops animations for reduced motion covers the landscape');
});
