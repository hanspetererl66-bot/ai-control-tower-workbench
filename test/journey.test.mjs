import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeJourney } from '../shared/journey.mjs';
import { embedJourney, JOURNEY_PAGES } from '../scripts/sync-mockup-spaces.mjs';
import { makeLogic } from '../connectors/_lib/server/customer-360.mjs';
import { parseHandoffMessage, MAX_HANDOFF_BYTES } from '../src/space-handoff.ts';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const J = makeJourney();
const sales = JSON.parse(read('examples/sales/pipeline.json'));
const mails = JSON.parse(read('examples/customer-emails/threads.json'));
const c360 = makeLogic(JSON.parse(read('examples/customer-360/data-lindenau.json')));

test('journey: the three pages carry the current rail code', () => {
  assert.equal(JOURNEY_PAGES.length, 4);
  for (const page of JOURNEY_PAGES) assert.equal(embedJourney(read(page), makeJourney.toString()), read(page), `${page}: run npm run sync:mockups`);
});

test('journey: every stop is a Space that can be installed, every Sales stop is a tab of the Sales page, every step has a stop', () => {
  const slugs = new Set(Object.values(EXAMPLE_SPACES));
  const page = read('examples/sales/index.html');
  // Governance, Workflow and Rules are panels of the tab "Settings & info" (data-sub), the rest are tabs of their own.
  const tabs = new Set([...page.matchAll(/<button role="tab"[^>]*data-tab="([a-z]+)"/g)].map((m) => m[1]).filter((t) => t !== 'more'));
  for (const m of page.matchAll(/<button[^>]*data-sub="([a-z]+)"/g)) tabs.add(m[1]);
  for (const s of J.STOPS) {
    assert.ok(slugs.has(s.space), `${s.id}: ${s.space} is an example Space`);
    if (s.space === 'sales') assert.ok(tabs.has(s.tab), `${s.id}: Sales has the tab ${s.tab}`);
    assert.ok(J.STEPS.some((x) => x.id === s.step), s.id);
  }
  for (const st of J.STEPS) assert.ok(J.STOPS.some((s) => s.step === st.id), `step ${st.id} has a stop`);
  for (const t of tabs) assert.ok(J.TAB_STEP[t], `Sales tab ${t} belongs to a step`);
});

test('journey: a hand-over passes the host check and only known values come out of parse()', () => {
  const s = J.stop('c360');
  const msg = J.handoff(s, { customer: 'lindenau', deal: 'OFF-2026-0518', thread: 'T-202', focus: 'rec:R-1' });
  const host = parseHandoffMessage(msg);
  assert.ok(host && host.to === 'customer-360' && host.open, 'the app accepts it');
  assert.ok(JSON.stringify(host.payload).length < MAX_HANDOFF_BYTES / 20);
  assert.deepEqual(J.parse(host.payload), { customer: 'lindenau', step: 'understand', deal: 'OFF-2026-0518', thread: 'T-202', focus: 'rec:R-1' });
  // nothing unknown gets through
  assert.equal(J.parse({ journey: { customer: 'evil' } }), null);
  assert.equal(J.parse({}), null);
  assert.equal(J.parse(null), null);
  const dirty = J.parse({ journey: { customer: 'muster', step: 'nope', tab: 'x;alert(1)', deal: '<img>', thread: 'T-1; drop', focus: 'rec:../../x', extra: 1 } });
  assert.deepEqual(dirty, { customer: 'muster', step: 'today' });
  const bad = J.handoff(J.stop('pipeline'), { customer: 'hanse', deal: '"><script>', thread: 'x', focus: 'y' });
  assert.deepEqual(bad.payload.journey, { customer: 'hanse', step: 'decide', tab: 'pipeline' });
});

test('journey: a stop is only open for a customer with sample data for it', () => {
  assert.ok(J.available(J.stop('c360'), 'lindenau') && J.available(J.stop('c360'), 'nordlicht'));
  assert.ok(!J.available(J.stop('c360'), 'muster') && !J.available(J.stop('c360'), 'hanse'));
  assert.ok(J.available(J.stop('mails'), 'muster') && !J.available(J.stop('mails'), 'hanse') && !J.available(J.stop('mails'), 'nordlicht'));
  assert.ok(!J.available(J.stop('pipeline'), 'nordlicht'), 'Nordlicht has no deals in Sales');
  for (const k of ['muster', 'hanse', 'lindenau']) assert.ok(J.available(J.stop('renewals'), k) && J.available(J.stop('renewal-map'), k) && J.available(J.stop('renewal-actions'), k), `${k} has renewals`);
  assert.ok(!J.available(J.stop('renewals'), 'nordlicht'), 'Nordlicht has no renewals');
  assert.ok(!J.available(J.stop('pipeline'), 'unknown'));
  for (const [k, c] of Object.entries(J.CUSTOMERS)) if (c.sales) assert.ok(sales.deals.some((d) => d.account === c.name), `${k} has deals in Sales`);
  for (const [k, c] of Object.entries(J.CUSTOMERS)) if (c.mail) assert.ok(mails.customers.some((m) => m.id === c.mail && m.name === c.name), `${k} has a mailbox`);
});

test('journey: proposals, deals and mail threads of Lindenau point at each other', () => {
  const recs = c360.recommendations();
  const threads = new Map(mails.threads.map((t) => [t.id, t]));
  for (const r of recs) {
    for (const id of r.deals || []) {
      const d = sales.deals.find((x) => x.id === id);
      assert.ok(d && d.account === 'Lindenau Pharma AG', `${r.id}: ${id} is a Lindenau deal in Sales`);
      assert.deepEqual(d.proposal, { rec: r.id, rank: r.rank, title: r.title }, `${id}: the Sales drawer shows the same proposal (run: node scripts/sync-journey-proposals.mjs)`);
    }
    if (r.thread) assert.equal(threads.get(r.thread)?.customer, 'Lindenau Pharma AG', `${r.id}: thread ${r.thread}`);
  }
  for (const d of sales.deals) if (d.proposal) assert.ok(recs.some((r) => r.id === d.proposal.rec && (r.deals || []).includes(d.id)), `${d.id}: proposal ${d.proposal.rec} exists`);
  for (const d of sales.deals) for (const t of d.links?.threads ?? []) assert.equal(threads.get(t).customer, d.account, `${d.id}: thread ${t} belongs to the same customer`);
  const lindDeals = sales.deals.filter((d) => d.account === 'Lindenau Pharma AG' && d.links?.threads);
  assert.ok(lindDeals.length >= 3, 'Lindenau deals link to their mails');
});

test('journey: the rail is plain HTML with the current step and a value strip, nothing unescaped', () => {
  const html = J.railHtml({ customer: 'lindenau', step: 'decide', stop: 'pipeline' }, [['Money <b>', '1 & 2']], 'a "note"');
  assert.match(html, /aria-current="step"/);
  assert.match(html, /data-jr-stop="pipeline"[^>]*aria-current="true"/);
  assert.doesNotMatch(html, /Money <b>/);
  assert.match(html, /Money &lt;b&gt;/);
  assert.match(html, /1 &amp; 2/);
  assert.match(html, /&quot;note&quot;/);
  const off = J.railHtml({ customer: 'hanse', step: 'understand', stop: 'c360' }, [], '');
  assert.match(off, /data-jr-stop="c360" disabled/);
});
