import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/sales/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/sales/pipeline.json'), 'utf8'));

test('sales page: guided demo with six steps that point to existing tabs, a deal and a meeting', () => {
  const demo = /const DEMO = \[([\s\S]*?)\n\];/.exec(page)[1];
  assert.equal((demo.match(/\{ t: '/g) || []).length, 6);
  for (const tab of [...demo.matchAll(/showTab\('([a-z]+)'\)/g)].map((m) => m[1])) assert.match(page, new RegExp(`data-tab="${tab}"`), tab);
  for (const id of [...demo.matchAll(/openDeal\('([A-Z0-9-]+)'\)/g)].map((m) => m[1])) assert.ok(data.deals.some((d) => d.id === id), id);
  for (const id of [...demo.matchAll(/mstate\.sel = '([A-Z0-9-]+)'/g)].map((m) => m[1])) assert.ok(data.meetings.some((m) => m.id === id), id);
  assert.match(page, /id="guide"/);
  assert.match(page, /id="g-start"/);
});

test('the deal used in the demo really has the discount problem the step text names', () => {
  const d = data.deals.find((x) => x.id === 'OFF-2026-0324');
  assert.ok(d.discountPct > data.discountThresholdPct);
  assert.equal(d.discountPct, 15.7);
  assert.equal(data.discountThresholdPct, 15);
});
