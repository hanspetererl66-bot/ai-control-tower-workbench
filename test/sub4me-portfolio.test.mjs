import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildMigrationSql, embedPortfolio, MIGRATION, PAGE, PORTFOLIO } from '../scripts/sync-sub4me.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const portfolio = JSON.parse(read(PORTFOLIO));

test('line items add up to the annual value of every contract and offer', () => {
  for (const item of [...portfolio.contracts, ...portfolio.offers]) {
    assert.ok(item.lines.length > 0, `${item.id} has line items`);
    assert.equal(item.lines.reduce((sum, l) => sum + l.annualEur, 0), item.annualEur, item.id);
  }
});

test('offers point to existing contracts and prices are consistent', () => {
  const ids = new Set(portfolio.contracts.map((c) => c.id));
  for (const o of portfolio.offers) {
    if (o.contractId) assert.ok(ids.has(o.contractId), `${o.id} renews ${o.contractId}`);
    assert.ok(Math.abs(o.listPriceEur * (1 - o.discountPct / 100) - o.annualEur) / o.annualEur < 0.01, `${o.id} list price and discount match the net price`);
  }
  for (const c of portfolio.contracts) assert.ok(c.usedUnits <= c.licensedUnits, c.id);
});

test('the Space page and the Supabase migration are generated from portfolio.json', () => {
  assert.equal(embedPortfolio(read(PAGE), portfolio), read(PAGE), 'run: npm run sync:sub4me');
  assert.equal(buildMigrationSql(portfolio), read(MIGRATION), 'run: npm run sync:sub4me');
});

test('the migration exposes one function, to the server-side key only, and is re-runnable', () => {
  const sql = read(MIGRATION);
  assert.match(sql, /grant execute on function public\.sub4me_portfolio\(\) to service_role/);
  assert.match(sql, /revoke all on function public\.sub4me_portfolio\(\) from public, anon, authenticated/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/i);
  for (const item of [...portfolio.contracts, ...portfolio.offers]) assert.ok(sql.includes(`'${item.id}'`), item.id);
  assert.match(sql, /on conflict \(id\) do update/);
});
