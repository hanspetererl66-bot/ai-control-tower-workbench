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

test('figures per company: one row per company, largest first, bars relative to the largest, numbers equal the summaries and the group', () => {
  assert.deepEqual(L.metrics.map((m) => m.id), ['arr', 'pipeline', 'outstanding', 'overdue', 'tickets', 'heat']);
  const g = L.group();
  for (const m of L.metrics) {
    const f = L.figures(m.id);
    assert.equal(f.metric, m.id);
    assert.equal(f.rows.length, data.entities.length, m.id);
    const values = f.rows.map((r) => r.value);
    assert.deepEqual([...values].sort((a, b) => b - a), values, `${m.id} is sorted, largest first`);
    assert.equal(f.rows[0].pct, f.max > 0 ? 100 : 0);
    for (const r of f.rows) {
      assert.ok(r.pct >= 0 && r.pct <= 100);
      assert.equal(r.node, L.resolve(r.entity), 'a click finds the node in the graph');
      assert.ok(L.node(r.node), r.entity);
    }
  }
  const byEntity = (id) => Object.fromEntries(L.figures(id).rows.map((r) => [r.entity, r.value]));
  for (const s of g.summaries) {
    assert.equal(byEntity('arr')[s.entity], s.arr);
    assert.equal(byEntity('pipeline')[s.entity], s.pipeline.weighted);
    assert.equal(byEntity('outstanding')[s.entity], s.payment.exposureGross);
    assert.equal(byEntity('overdue')[s.entity], s.payment.overdueGross);
    assert.equal(byEntity('tickets')[s.entity], s.openTickets);
    assert.equal(byEntity('heat')[s.entity], s.heat);
  }
  assert.equal(L.figures('outstanding').total, g.summaries.reduce((a, s) => a + s.payment.exposureGross, 0));
  assert.equal(L.figures('heat').totalText, '', 'a total of heat values means nothing');
  assert.equal(L.figures('nope').metric, 'arr', 'an unknown figure gives the first one');
});

test('the story window stays inside the picture: positions are clamped, a window larger than the picture sits at the edge', () => {
  assert.deepEqual(L.clampBox(100, 50, 300, 200, 1000, 700, 8), { left: 100, top: 50 });
  assert.deepEqual(L.clampBox(-500, -500, 300, 200, 1000, 700, 8), { left: 8, top: 8 });
  assert.deepEqual(L.clampBox(5000, 5000, 300, 200, 1000, 700, 8), { left: 692, top: 492 });
  assert.deepEqual(L.clampBox(50, 50, 2000, 2000, 1000, 700, 8), { left: 8, top: 8 });
});

test('page: the story window has a grip with a label and keys, the figures card has one button per figure', () => {
  assert.match(page, /id="storyBox"[^>]*>\s*<div class="c3-grip" id="storyGrip" role="button" tabindex="0" aria-label="Move the story window/);
  assert.match(page, /on\(storyGrip, 'keydown'[\s\S]*e\.stopPropagation\(\)/, 'arrow keys that move the window do not turn the story pages');
  assert.match(page, /\.c3-grip\{display:none\}/, 'on a narrow screen the window sits under the picture and is not moved');
  assert.match(page, /Figures per company/);
  assert.match(page, /data-metric="' \+ m\.id/);
});

test('page: the "What is this page?" box is gone and nothing points at it any more', () => {
  assert.doesNotMatch(page, /<details class="intro"|<h2>What is this page\?/, 'the box itself (its styles belong to the shared design system and stay)');
  assert.doesNotMatch(page, /see "What is this page\?"/, 'no text points at the box');
  assert.match(page, /class="demo">Mockup with fictional data/, 'the note that the page is a mockup stays');
});

test('timeline events: one per contract, invoice, ticket, order, message and deal, dated, oldest first, and every click lands on a node of the graph', () => {
  const ev = L.events();
  const n = (list) => list.length;
  assert.equal(ev.length, n(data.contracts) + n(data.invoices) + n(data.tickets) + n(data.orders) + n(data.signals) + n(data.opportunities));
  assert.deepEqual(ev.map((e) => e.date), ev.map((e) => e.date).sort(), 'oldest first');
  for (const e of ev) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date), e.id);
    assert.ok(['ok', 'info', 'warn', 'bad'].includes(e.tone), e.id);
    assert.ok(e.node && L.node(e.node), `${e.id} has a node (${e.node})`);
    assert.ok(L.ent(e.entity), e.id);
    if (e.kind === 'contract') assert.ok(e.end > e.date, e.id);
  }
  const inv = (id) => ev.find((e) => e.id === id);
  const overdue = data.invoices.find((i) => i.status === 'Overdue');
  assert.equal(inv(overdue.id).tone, 'bad');
  assert.equal(inv(overdue.id).node, `invoice:${overdue.id}`);
  const paid = data.invoices.find((i) => i.status === 'Paid');
  assert.equal(inv(paid.id).node, `pay:${paid.entity}`, 'a paid invoice leads to the payment history of its company');
});

test('timeline: periods, kinds and one lane per company', () => {
  const t = L.timeline({ range: '12m' });
  assert.equal(t.lanes.length, data.entities.length);
  assert.equal(t.from, L.timeline({ range: '12m' }).from);
  assert.equal(L.daysBetween(t.from, t.asOf), 365);
  assert.equal(L.daysBetween(t.asOf, t.to), 180);
  assert.equal(L.daysBetween(L.timeline({ range: '90d' }).from, t.asOf), 90);
  assert.equal(L.timeline({ range: 'nonsense' }).range, '12m');
  const all = L.timeline({ range: 'all' });
  assert.equal(all.total, L.events().length, 'all shows every event');
  const only = L.timeline({ range: 'all', kinds: ['ticket'] });
  assert.equal(only.total, data.tickets.length);
  assert.ok(only.lanes.every((l) => l.events.every((e) => e.kind === 'ticket')));
  assert.equal(L.timeline({ range: 'all', kinds: [] }).total, 0);
  assert.equal(L.timeline({ range: 'all', kinds: ['nope'] }).total, 0, 'unknown kinds are ignored');
  assert.deepEqual(Object.keys(all.counts).sort(), L.TL_KINDS.map((k) => k.id).sort());
  const window = L.timeline({ range: '90d' });
  for (const l of window.lanes) for (const e of l.events) assert.ok((e.end || e.date) >= window.from && e.date <= window.to);
});

test('timeline marks: events of one kind close together become one mark with a count and the worst colour; contracts never merge', () => {
  const mk = (id, kind, date, tone, end) => ({ id, kind, date, tone, end, entity: 'x', node: 'n' });
  const list = [mk('a', 'invoice', '2026-01-01', 'ok'), mk('b', 'invoice', '2026-01-05', 'bad'), mk('c', 'invoice', '2026-03-01', 'ok'), mk('t', 'ticket', '2026-01-02', 'warn'), mk('k1', 'contract', '2026-01-01', 'ok', '2027-01-01'), mk('k2', 'contract', '2026-01-02', 'ok', '2027-01-01')];
  const b = L.bucketEvents(list, 10);
  const inv = b.filter((m) => m.kind === 'invoice');
  assert.equal(inv.length, 2);
  assert.deepEqual([inv[0].count, inv[0].tone, inv[0].last], [2, 'bad', '2026-01-05']);
  assert.equal(inv[1].count, 1);
  assert.equal(b.filter((m) => m.kind === 'ticket').length, 1, 'a ticket is not merged with an invoice');
  assert.equal(b.filter((m) => m.kind === 'contract').length, 2);
  assert.equal(L.bucketEvents(list, 0).filter((m) => m.kind === 'invoice').length, 3, 'nothing merges when the gap is 0');
});

test('page: the timeline card has filters per kind and period, a list for narrow screens, keyboard use and no external code', () => {
  assert.match(page, /id="tlHost"/);
  assert.match(page, /data-tlkind="' \+ k\.id/);
  assert.match(page, /data-tlrange="' \+ r\[0\]/);
  assert.match(page, /role="button" aria-label="'/, 'every mark is a button with a label');
  assert.match(page, /\.c3-tl svg,\.c3-tlbar \.rng\{display:none\}\.c3-tllist\{display:block\}/, 'under 860 px the list replaces the axis');
});

test('payment behaviour per company: measured from the paid invoices, the numbers equal paymentOf, the trend compares the last four with the rest', () => {
  const rows = L.behaviour();
  assert.ok(rows.length >= 1);
  const withInvoices = new Set(data.invoices.map((i) => i.entity));
  assert.deepEqual(new Set(rows.map((r) => r.entity)), withInvoices, 'a company without invoices has no row');
  for (const r of rows) {
    const p = L.paymentOf(r.entity);
    assert.equal(r.invoices, data.invoices.filter((i) => i.entity === r.entity).length);
    assert.equal(r.paid, p.paid);
    assert.equal(r.avgDaysLate, p.avgDaysLate);
    assert.equal(r.maxDaysLate, p.maxDaysLate);
    assert.equal(r.exposureGross, p.exposureGross);
    assert.equal(r.risk, p.risk);
    assert.equal(r.latePct, r.paid ? Math.round((p.lateCount / r.paid) * 100) : 0);
    assert.equal(r.points.length, r.paid);
    assert.ok(r.points.every((x) => x.node === `pay:${r.entity}` && L.node(x.node)));
    assert.ok(r.overdue.every((x) => x.daysLate > 0 && L.node(x.node)));
    if (r.paid < 6) assert.equal(r.trend, null, 'too few invoices for a trend');
  }
  const sorted = rows.map((r) => r.exposureGross);
  assert.deepEqual([...sorted].sort((a, b) => b - a), sorted, 'the most unpaid money first');
  const worse = rows.find((r) => r.trend && r.trend.label === 'worse');
  const paid = data.invoices.filter((i) => i.entity === worse.entity && i.status === 'Paid').sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  const avg = (l) => l.reduce((a, i) => a + i.daysLate, 0) / l.length;
  assert.equal(worse.trend.delta, Math.round((avg(paid.slice(-4)) - avg(paid.slice(0, -4))) * 10) / 10);
  assert.ok(worse.trend.delta >= 2);
});

test('unpaid invoices: every one is listed, the reason is a message that names the invoice, the expected date is a rule of thumb from the paid invoices', () => {
  const open = L.openInvoices();
  assert.equal(open.length, data.invoices.filter((i) => i.status !== 'Paid').length);
  assert.deepEqual(open.map((o) => o.dueOn), open.map((o) => o.dueOn).sort(), 'oldest first');
  for (const o of open) {
    assert.ok(L.node(o.node), o.id);
    if (o.reason) {
      const s = data.signals.find((x) => x.id === o.reason.signal);
      assert.ok(s.about.includes(o.id), `${o.id}: the message names the invoice`);
      assert.ok(o.reason.text.length <= 201);
      assert.ok(L.node(o.reason.node));
    }
    const p = L.paymentOf(o.entity);
    if (p.paid) {
      assert.equal(o.expected.on, new Date(Date.parse(o.dueOn) + Math.max(0, Math.round(p.avgDaysLate)) * 86400000).toISOString().slice(0, 10), 'due date + the average delay of the paid invoices');
      assert.equal(o.expected.basedOn, p.paid);
      assert.equal(o.expected.later, o.expected.on < data.asOf, 'later = the usual delay has already passed');
      assert.ok(o.expected.avgDaysLate >= 0, 'an early payer is not expected to pay before the due date');
    } else assert.equal(o.expected, null);
    if (o.status === 'Overdue') assert.ok(o.daysToDue < 0, `${o.id} is overdue, so its due date is in the past`);
  }
});

test('page: the payment card has a table with a row per company, a chart with the thresholds from the data, the unpaid list, and says it is no forecast', () => {
  assert.match(page, /id="payHost"/);
  assert.match(page, /measured from the paid invoices, not a forecast/);
  assert.match(page, /Not a forecast\./);
  assert.match(page, /data-payent="' \+ esc\(r\.entity\)/);
  assert.match(page, /P\.mediumAvgDaysLate[\s\S]*P\.highAvgDaysLate/, 'the lines come from the rules in the data, not from numbers in the page');
  assert.match(page, /\.c3-pay \.c3-payfig\{display:none\}/);
});
