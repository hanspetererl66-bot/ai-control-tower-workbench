import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rr = fs.readFileSync('examples/revenue-recognition/index.html', 'utf8');
const o2c = fs.readFileSync('examples/order-to-cash-software/index.html', 'utf8');
const data = JSON.parse(fs.readFileSync('examples/revenue-recognition/data.json', 'utf8'));
const core = (h) => h.slice(h.indexOf('// @core-start'), h.indexOf('// @core-end'));
const L = new Function(rr.slice(rr.indexOf('// @logic-start'), rr.indexOf('// @logic-end')) + '; return makeLogic;')()(data);

test('the page embeds its data, collapses the intro, and is registered', () => {
  const m = rr.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  assert.deepEqual(JSON.parse(m[1]), data);
  assert.match(rr, /<details class="intro"><summary>/);
  assert.doesNotMatch(rr, /<details class="intro" open/);
  assert.equal(data.title, 'Revenue Recognition (Software)');
  const space = JSON.parse(fs.readFileSync('examples/revenue-recognition/space.json', 'utf8'));
  assert.equal(space.domain, 'Finance');
  assert.match(fs.readFileSync('scripts/install-example-space.mjs', 'utf8'), /'revenue-recognition'/);
  assert.match(fs.readFileSync('package.json', 'utf8'), /install:revenue-recognition/);
});

test('the shared calculation core is identical to the Order-to-Cash page', () => {
  assert.ok(core(rr).length > 1000);
  assert.equal(core(rr), core(o2c));
});

test('allocation shares the discount by stand-alone price and the residual approach moves it to the licence', () => {
  const A = L.allocate();
  assert.equal(A.price, 388000); assert.equal(A.ssp, 416700); assert.equal(A.discount, 28700);
  assert.equal(Math.round(Object.values(A.byLine).reduce((a, b) => a + b, 0) * 100) / 100, 388000);
  const R = L.residual();
  assert.equal(R.byLine.L10, 35300);
  assert.equal(Math.round(Object.values(R.byLine).reduce((a, b) => a + b, 0) * 100) / 100, 388000);
});

test('position at 2026-12-31 and the entries balance', () => {
  const P = L.position('2026-12-31');
  assert.equal(P.total.billed, 78800); assert.equal(P.total.recognized, 96052.64); assert.equal(P.total.collected, 73400);
  assert.equal(P.contractAsset, 17252.64);
  const J = L.journal('2026-12'), acc = L.accounts(J);
  const dr = acc.reduce((s, a) => s + a.dr, 0), cr = acc.reduce((s, a) => s + a.cr, 0);
  assert.equal(Math.round(dr * 100), Math.round(cr * 100));
});

test('remaining performance obligations add up and leave out usage', () => {
  const R = L.rpo('2026-12');
  assert.equal(R.total, L.position('2026-12-31').remaining);
  assert.equal(Math.round(R.bands.reduce((s, b) => s + b.amount, 0) * 100), Math.round(R.total * 100));
  assert.equal(R.bands[3].amount, 0);
});

test('service credit, rebate and contract costs', () => {
  assert.deepEqual(L.sla(100), { pct: 0, credit: 0, net: 7000 });
  assert.equal(L.sla(99.7).credit, 350);
  assert.equal(L.sla(98.4).credit, 1750);
  const R = L.rebate();
  assert.equal(R.expectedRebate, 490); assert.equal(R.likelyRebate, 620); assert.equal(R.pRebate, 0.75);
  const c = L.costs('2027-02');
  assert.equal(c.total, 23280); assert.equal(c.monthly, 388); assert.equal(c.amortised, 1164); assert.equal(c.balance, 22116);
});

test('contract change: A is a separate contract, B is prospective with licences recognised at once', () => {
  const a = L.modification('A'), b = L.modification('B');
  assert.equal(a.separate, true); assert.equal(a.add, 44800); assert.equal(a.after.monthly, 9547.35);
  assert.equal(b.separate, false);
  const sum = b.after.items.reduce((s, x) => s + x.amount, 0);
  assert.equal(Math.round(sum * 100), Math.round(b.after.pool * 100));
  assert.equal(b.after.atOnce, 14172.8);
});

test('content: 14 treatments, 12 judgements, 5 steps, every treatment fully described', () => {
  assert.equal(data.steps.length, 5); assert.equal(data.treatments.length, 14); assert.equal(data.judgements.length, 12);
  data.treatments.forEach((t) => ['name', 'pattern', 'why', 'watch', 'refs', 'je'].forEach((k) => assert.ok(t[k], t.id + ' ' + k)));
  assert.doesNotMatch(rr, /localStorage|fetch\(|XMLHttpRequest/);
});
