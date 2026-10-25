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
  for (const c of hand.customers) assert.deepEqual(Object.keys(c).sort(), ['agents', 'bdc', 'contractModels', 'decisions', 'id', 'packages']);
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

test('the suite has 5 Finance and 8 Supply Chain agents per customer, each with a consumption model', () => {
  for (const c of data.customers) {
    const fin = c.agents.filter((a) => a.area === 'finance'), sc = c.agents.filter((a) => a.area === 'supplychain');
    assert.equal(fin.length, 5); assert.equal(sc.length, 8);
    assert.deepEqual(c.packages.map((p) => [p.id, p.agentsLicensed]), [['finance', 5], ['supplychain', 8]]);
    const ids = new Set();
    for (const a of c.agents) {
      assert.ok(!ids.has(a.id)); ids.add(a.id);
      assert.ok(['live', 'implementing', 'purchased', 'planned'].includes(a.status));
      assert.ok(['autonomous', 'copilot', 'orchestrator'].includes(a.type));
      assert.ok(c.products.some((p) => p.name === a.product), `${a.id} product`);
      assert.ok(a.meter && a.perEvent > 0 && a.events > 0, `${a.id} consumption model`);
      assert.equal(a.unitsMonth, Math.round(a.perEvent * a.events), `${a.id} units a month`);
      if (a.status === 'live') assert.ok(a.cap >= a.events && a.unitsYtd > 0, a.id);
      else assert.ok(a.cap === 0 && a.unitsYtd === 0, a.id);
      assert.ok(a.golive >= a.since);
    }
    for (const p of c.products) {
      const sum = c.agents.filter((a) => a.product === p.name).reduce((t, a) => t + a.unitsYtd, 0);
      assert.ok(sum <= p.consumed, `${c.id} ${p.name}: ${sum} > ${p.consumed}`);
    }
    assert.ok(c.decisions.length <= 3);
  }
});

test('Business AI components: BTP from the Sub4Me products, Joule Work from the Sub4Me offer, Business Data Cloud by hand', () => {
  const muster = data.customers.find((c) => c.id === 'muster'), hanse = data.customers.find((c) => c.id === 'hanse');
  assert.ok(muster.products.some((p) => p.name === 'BTP AI Core') && muster.products.some((p) => p.name === 'Document AI'));
  assert.equal(muster.jouleWork.status, 'In negotiation');
  assert.equal(muster.jouleWork.unitsMonth, muster.jouleWork.users * 8);
  assert.equal(hanse.jouleWork, null);
  assert.ok(muster.bdc.usedCu <= muster.bdc.contractedCu && hanse.bdc.status === 'planned');
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
