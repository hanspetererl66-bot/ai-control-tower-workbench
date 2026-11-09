import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedMockupData, embedLogic } from '../scripts/sync-mockup-spaces.mjs';
import { makeLogic as moduleLogic, customer360Documents } from '../connectors/_lib/server/customer-360.mjs';
import { buildCustomer360Corpus } from '../scripts/cognee-corpus.mjs';
import { askPrompt, handleCustomer360Message, parseAnswer, MAX_QUESTION } from '../src/customer360-bridge.ts';
import { MAX_ASK_LENGTH } from '../src/space-ask.ts';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/customer-360/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/customer-360/data.json'), 'utf8'));
// The page logic sits between two markers: the test runs the real code from the page, not a copy.
const src = /\/\/ @logic-start([\s\S]*?)\/\/ @logic-end/.exec(page)[1];
const L = new Function(`${src}; return makeLogic;`)()(data);

test('page embeds the current data and the current logic', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
  assert.equal(embedLogic(page, moduleLogic.toString()), page, 'run: npm run sync:mockups');
});

test('sample data: ids are unique and every reference exists', () => {
  const ids = new Set();
  const add = (list, what) => list.forEach((x) => { assert.ok(!ids.has(what + x.id), `duplicate ${what}${x.id}`); ids.add(what + x.id); });
  add(data.entities, 'e'); add(data.contracts, 'c'); add(data.opportunities, 'o'); add(data.orders, 'so'); add(data.invoices, 'i'); add(data.tickets, 't'); add(data.signals, 's');
  const ent = new Set(data.entities.map((e) => e.id));
  for (const c of data.contracts) { assert.ok(ent.has(c.entity), c.id); if (c.billTo) assert.ok(ent.has(c.billTo), c.id); }
  for (const i of data.invoices) assert.ok(ent.has(i.entity), i.id);
  assert.ok(data.entities.length >= 6, 'a group with several subsidiaries');
});

test('graph: edges point at existing nodes, ids are unique, every node has a document', () => {
  const ids = new Set(L.graph.nodes.map((n) => n.id));
  assert.equal(ids.size, L.graph.nodes.length);
  for (const e of L.graph.edges) { assert.ok(ids.has(e.source) && ids.has(e.target), e.id); assert.ok(L.EDGES[e.type], e.type); }
  assert.deepEqual([...L.docs.map((d) => d.id)].sort(), [...ids].sort());
  for (const d of L.docs) assert.ok(d.text.includes(`(${d.id})`), 'the id is in the text so a live engine can report it');
});

test('sums come from the data: money at stake and open invoices', () => {
  const g = L.group();
  const unpaid = data.invoices.filter((i) => i.status !== 'Paid').reduce((s, i) => s + i.grossEur, 0);
  assert.equal(g.exposureGross, unpaid);
  const open = data.opportunities.filter((o) => !/won|lost/i.test(o.stage));
  assert.equal(g.pipeline.weighted, open.reduce((s, o) => s + L.weighted(o), 0));
  assert.ok(g.entities >= 6);
});

test('every story beat finds what it is meant to find', () => {
  const beats = L.beats();
  assert.equal(beats.length, 10);
  assert.deepEqual([...new Set(beats.map((b) => b.act))], [1, 2, 3, 4]);
  for (const b of beats) {
    const r = L.retrieve(b.question);
    assert.ok(r.hits.length > 0, b.id);
    for (const id of b.expect) assert.ok(r.ids.includes(id), `${b.id} expects ${id}`);
    assert.ok(b.text.length > 20 && b.metrics.length === 3, b.id);
  }
  assert.ok(beats.filter((b) => b.inference).length >= 1, 'conclusions from free text are marked');
});

test('retrieval: hits are marked hit, neighbours context, and the question decides', () => {
  const r = L.retrieve('Which invoices are overdue?');
  assert.ok(r.ids.some((i) => i.startsWith('invoice:')));
  assert.equal(r.role[r.hits[0].id], 'hit');
  assert.ok(Object.values(r.role).includes('context'));
  const none = L.retrieve('zzzz qqqq');
  assert.equal(none.hits.length, 0);
});

test('recommendations: ranked by amount at stake times urgency, with evidence that exists', () => {
  const recs = L.recommendations();
  assert.ok(recs.length >= 4);
  const ids = new Set(L.graph.nodes.map((n) => n.id));
  recs.forEach((r, i) => {
    assert.equal(r.rank, i + 1);
    if (i) assert.ok(recs[i - 1].score >= r.score);
    assert.equal(r.score, r.atStakeEur * data.rules.urgencyFactor[r.urgency], `${r.id}: score = at stake x urgency factor`);
    r.evidence.forEach((e) => assert.ok(ids.has(e), `${r.id}: ${e}`));
    assert.ok(r.approval);
  });
});

test('3D layout: finite coordinates, nodes do not sit on top of each other, same result every time', () => {
  const a = L.layout(), b = L.layout();
  const keys = Object.keys(a);
  assert.equal(keys.length, L.graph.nodes.length);
  keys.forEach((k) => { assert.ok(a[k].every(Number.isFinite), k); assert.deepEqual(a[k], b[k]); });
  let min = Infinity;
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) min = Math.min(min, Math.hypot(...a[keys[i]].map((v, n) => v - a[keys[j]][n])));
  assert.ok(min > 20, `closest pair ${min}`);
});

test('the Cognee corpus is the same documents as the page reads', () => {
  const corpus = buildCustomer360Corpus();
  assert.deepEqual(corpus, customer360Documents(data));
  assert.equal(corpus.length, L.docs.length);
});

test('page: only tokens for colour, no network, no storage, no external scripts', () => {
  const own = page.slice(page.indexOf('<style>\nbody{margin:0}'), page.indexOf('</style>', page.indexOf('<style>\nbody{margin:0}')));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(own), 'no hex colours in the page styles');
  assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/.test(page.replace(src, '')));
  assert.ok(!/<script[^>]+src=/.test(page));
});

test('Ask Joule prompts stay under the limit', () => {
  assert.ok(MAX_ASK_LENGTH >= 600);
  for (const r of L.recommendations()) {
    const p = 'Draft a short message for this proposal: ' + r.title + ' (' + r.kind + '). Use only facts from the Customer 360 sample (' + r.why + '). Draft only. Do not send or change anything.';
    assert.ok(p.length <= 600 + 400, 'the page cuts the prompt to 600 characters');
  }
});

// ---- bridge -------------------------------------------------------------------------------------------------------------------------
test('bridge: only the one request passes, ids and sizes are checked', async () => {
  const ask = async () => '```json\n{"answer":"Eight of eight were late. Inference: the run is the cause.","ids":["invoice:INV-2026-N0009","bad id","pay:nl-ma","pay:nl-ma"]}\n```';
  assert.equal(await handleCustomer360Message({ type: 'other', requestId: 'a' }, { ask }), null);
  assert.equal(await handleCustomer360Message({ type: 'c360:ask-request', requestId: 'bad id!', question: 'x' }, { ask }), null);
  const ok = await handleCustomer360Message({ type: 'c360:ask-request', requestId: 'a1', question: 'Who pays late?' }, { ask });
  assert.equal(ok.type, 'c360:ask-answer');
  assert.deepEqual(ok.ids, ['invoice:INV-2026-N0009', 'pay:nl-ma']);
  const long = await handleCustomer360Message({ type: 'c360:ask-request', requestId: 'a2', question: 'x'.repeat(MAX_QUESTION + 1) }, { ask });
  assert.equal(long.type, 'c360:error');
  const none = await handleCustomer360Message({ type: 'c360:ask-request', requestId: 'a3', question: 'q' }, {});
  assert.equal(none.type, 'c360:error');
  const junk = await handleCustomer360Message({ type: 'c360:ask-request', requestId: 'a4', question: 'q' }, { ask: async () => 'no json here' });
  assert.equal(junk.type, 'c360:error');
  const stopped = await handleCustomer360Message({ type: 'c360:ask-request', requestId: 'a5', question: 'q' }, { ask: async () => '' });
  assert.equal(stopped.type, 'c360:error');
});

test('bridge: the prompt allows recall only and parseAnswer rejects an empty reply', () => {
  const p = askPrompt('Who is the blocker?');
  assert.match(p, /"recall"/);
  assert.match(p, /Do not write, remember or forget/);
  assert.equal(parseAnswer('{"answer":"","ids":[]}'), null);
  assert.equal(parseAnswer('{"answer":"x","ids":"no"}'), null);
});

test('customer 360: an answer without ids is matched to nodes by name', () => {
  const L = moduleLogic(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'examples/customer-360/data.json'), 'utf8')));
  const ids = L.mentions('Katrin Brandt is the Head of Accounts Payable. Invoice INV-2026-N0009 is open; Brandts team knows.');
  assert.deepEqual(ids.slice(0, 2), ['contact:brandt', 'invoice:INV-2026-N0009'], 'full name, last name and identifiers, in order of appearance');
  assert.deepEqual(L.mentions('Nothing named here.'), []);
  assert.equal(L.mentions('Brandtmann and Xinv-2026-N0009x').length, 0, 'whole words only');
});
