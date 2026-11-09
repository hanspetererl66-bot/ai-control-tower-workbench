import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/order-to-cash-software/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/order-to-cash-software/data.json'), 'utf8'));
const logic = /\/\/ @logic-start([\s\S]*?)\/\/ @logic-end/.exec(page)[1];
const L = new Function(`${logic}; return makeLogic;`)()(data);

test('the page embeds the current sample data and starts with the intro collapsed', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
  assert.match(page, /<details class="intro"><summary>What is this page\?/);
  assert.doesNotMatch(page, /<details class="intro" open/);
});

test('six committed positions and two rate items: three software kinds and three services', () => {
  const kinds = data.lines.map((l) => l.kind);
  assert.deepEqual(kinds.filter((k) => k !== 'Service' && k !== 'Overage'), ['License', 'Subscription', 'Consumption']);
  assert.equal(kinds.filter((k) => k === 'Service').length, 3);
  const A = L.allocate();
  assert.equal(A.price, 388000);
  assert.equal(A.ssp, 416700);
  assert.equal(A.discount, 28700);
  assert.equal(Object.values(A.byLine).reduce((s, v) => s + v, 0).toFixed(2), '388000.00', 'the shares add up to the price');
});

test('billing, revenue and cash agree over the whole term and differ in between', () => {
  const end = L.position('2029-12-31', { trueUp: true });
  assert.equal(end.total.billed, end.total.recognized);
  assert.equal(end.total.billed, end.total.collected);
  assert.equal(end.remaining, 0);
  const dec = L.position('2026-12-31', { trueUp: true });
  assert.equal(dec.total.billed, 78800);
  assert.equal(dec.total.recognized, 96052.64);
  assert.equal(dec.total.collected, 73400);
  assert.equal(dec.contractAsset, 17252.64, 'revenue is ahead of the invoices');
  assert.equal(dec.contractLiability, 0);
  const nov = L.position('2026-11-30', { trueUp: true });
  assert.equal(nov.contractLiability, 766.12, 'in November the invoices are ahead');
});

test('overage and the consumption true-up come out of the sample data', () => {
  const r = L.recon();
  const dec = r.find((x) => x.line === 'L30' && x.month === '2026-12');
  assert.equal(dec.diff, 2300000);
  assert.equal(dec.amount, 920);
  const over = r.find((x) => x.line === 'L21' && x.month === '2026-12');
  assert.equal(over.over, 18);
  assert.equal(over.billedAmount, 612);
  const without = L.position('2027-01-31', {}).total.billed;
  const withTrue = L.position('2027-01-31', { trueUp: true }).total.billed;
  assert.equal(withTrue - without, 920);
});

test('the process runs in 14 steps and stops at the three decisions until a person decides', () => {
  assert.equal(data.stages.length, 14);
  let S = L.newState();
  const run = () => { for (;;) { const r = L.advance(S); if (!r.ok) return r; S = r.state; } };
  let r = run();
  assert.equal(S.step, 3, 'stops at the entitlement check');
  assert.match(r.reason, /D1, D2/);
  S.approved = { D1: true };
  run();
  assert.equal(S.step, 3, 'one deviation is not enough');
  S.approved = { D1: true, D2: true };
  r = run();
  assert.equal(S.step, 5, 'stops at the receipt');
  assert.match(r.reason, /Architect Server licences, Insight Cloud subscription, Flow Engine consumption/);
  S.receipt = { L10: true, L20: true };
  run();
  assert.equal(S.step, 5);
  S.receipt = { L10: true, L20: true, L30: true };
  r = run();
  assert.equal(S.step, 10, 'stops at consumption against billing');
  S.trueUp = true;
  run();
  assert.equal(S.step, 14);
  assert.equal(L.canAdvance(S).ok, false);
});

test('the bill of material follows the corrections and every system of the process is used', () => {
  const before = L.bom({ approved: {} }), after = L.bom({ approved: { D1: true, D2: true } });
  assert.match(before.find((b) => b.id === 'L60').tier, /Standard/);
  assert.match(after.find((b) => b.id === 'L60').tier, /Premium/);
  assert.match(before.find((b) => b.id === 'L30').rate, /0\.45/);
  assert.match(after.find((b) => b.id === 'L30').rate, /0\.40/);
  assert.deepEqual([...new Set(data.stages.map((s) => s.system))].sort(), data.systems.map((s) => s.id).sort(), 'all seven systems are called');
  assert.equal(data.systems.length, 7);
});

test('the n8n workflow calls every stage in order, with a Wait node at each decision and no credentials', () => {
  const wf = JSON.parse(readFileSync(join(ROOT, data.n8n.file), 'utf8'));
  const names = wf.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === 'o2c-software'));
  const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.equal(http.length, 14);
  data.stages.forEach((s, i) => assert.match(http[i].parameters.url, new RegExp(`/tools/${s.tool}$`)));
  assert.equal(wf.nodes.filter((n) => n.type === 'n8n-nodes-base.wait').length, 3);
  assert.ok(wf.nodes.every((n) => n.credentials === undefined));
  for (const [from, o] of Object.entries(wf.connections)) { assert.ok(names.includes(from)); for (const t of o.main[0]) assert.ok(names.includes(t.node)); }
  // every node is on the single path from the webhook
  let cur = 'Contract signed', seen = 1;
  while (wf.connections[cur]) { cur = wf.connections[cur].main[0][0].node; seen++; }
  assert.equal(seen, wf.nodes.length - 1, 'all nodes but the note are on the path');
});

test('the page runs: six tabs, Entitlement and Provisioning are separate, the n8n process sits under the flowchart, three tenants', async () => {
  const { JSDOM, VirtualConsole } = await import('jsdom');
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errs.push(e.message));
  const w = new JSDOM(page, { runScripts: 'dangerously', virtualConsole: vc }).window;
  const labels = [...w.document.querySelectorAll('#tabs button')].map((b) => b.textContent);
  assert.deepEqual(labels, ['End-to-End O2C Process', 'Order and bill of material', 'Entitlement', 'Provisioning', 'Billing and consumption', 'Revenue and cash']);
  for (const t of ['proc', 'bom', 'ent', 'prov', 'bill', 'rev']) w.document.querySelector(`[data-act=tab][data-id=${t}]`).click();
  w.document.querySelector('[data-act=tab][data-id=proc]').click();
  assert.match(w.document.querySelector('#main').textContent, /n8n process behind it/);
  assert.equal(data.tenants.length, 3);
  assert.ok(data.includedServices.length >= 4);
  assert.deepEqual(errs, []);
});
