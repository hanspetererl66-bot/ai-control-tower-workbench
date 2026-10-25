import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { buildBriefing, embedBriefing, PAGE, DATA } from '../scripts/sync-customer-briefing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const data = buildBriefing();
const sub4me = JSON.parse(/<script type="application\/json" id="s4m-data">([\s\S]*?)<\/script>/.exec(read('examples/sub4me/index.html'))[1]);

test('the Space is registered and its page is in sync with data and design system', () => {
  assert.equal(EXAMPLE_SPACES['customer-ai-briefing'], 'customer-ai-briefing');
  assert.equal(embedBriefing(read(PAGE), data, read('examples/shared/design-system.css')), read(PAGE));
  assert.equal(JSON.parse(read('examples/customer-ai-briefing/space.json')).title, 'Kundenspezifisches AI-Briefing');
});

test('customer, AI units, offers and renewals are pulled from Sub4Me and Renewals, not copied by hand', () => {
  const by = { muster: sub4me, hanse: sub4me.otherCustomers[0] };
  const hand = JSON.parse(read(DATA));
  for (const c of hand.customers) assert.deepEqual(Object.keys(c).sort(), ['agents', 'contractModels', 'decisions', 'id']);
  for (const c of data.customers) {
    const src = by[c.id];
    assert.equal(c.name, src.customer.name); assert.equal(c.allotment, src.aiUnits.allotment, c.id);
    assert.ok(c.contracts.length && c.renewals.length && Array.isArray(c.offers) && Array.isArray(c.tickets));
    for (const p of c.products) {
      const s = src.products.find((x) => x.name === p.name);
      assert.ok(s, `${c.id} ${p.name}`);
      assert.equal(p.consumed, s.consumed); assert.equal(p.allotment, s.allotment);
    }
  }
});

test('agents are consistent: units never exceed the product use, live agents have runs, others none', () => {
  for (const c of data.customers) {
    const ids = new Set();
    for (const a of c.agents) {
      assert.ok(!ids.has(a.id)); ids.add(a.id);
      assert.ok(['live', 'implementing', 'purchased', 'planned'].includes(a.status));
      assert.ok(['autonomous', 'copilot', 'orchestrator'].includes(a.type));
      assert.ok(c.products.some((p) => p.name === a.product), `${a.id} product`);
      if (a.status === 'live') assert.ok(a.runs > 0 && a.runs <= a.cap && a.units > 0, a.id);
      else assert.ok(a.runs === 0 && a.units === 0, a.id);
      assert.ok(a.golive >= a.since);
    }
    for (const p of c.products) {
      const sum = c.agents.filter((a) => a.product === p.name).reduce((t, a) => t + a.units, 0);
      assert.ok(sum <= p.consumed, `${c.id} ${p.name}: ${sum} > ${p.consumed}`);
    }
    assert.ok(c.agents.some((a) => a.area === 'finance') && c.decisions.length <= 3);
  }
});

test('every customer shows all contract models and at least one valid, with terms', () => {
  for (const c of data.customers) {
    assert.deepEqual(c.contractModels.map((m) => m.id), ['payg', 'agreed', 'fixed', 'rollover', 'pool', 'topup']);
    const valid = c.contractModels.filter((m) => m.valid);
    assert.ok(valid.length >= 1 && valid.every((m) => m.terms.length > 20));
  }
});

test('the page is static: no network, no storage', () => {
  const html = read(PAGE);
  assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|localStorage/);
  assert.match(html, /Fictional customers and mockup data/);
});
