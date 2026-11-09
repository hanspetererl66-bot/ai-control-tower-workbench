import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { salesDocuments } from '../connectors/_lib/server/cognee-sales-corpus.mjs';
import { buildSalesCorpus } from '../scripts/cognee-corpus.mjs';

const data = JSON.parse(readFileSync(new URL('../examples/sales/pipeline.json', import.meta.url), 'utf8'));

test('one document per deal, every line a sentence', () => {
  const docs = buildSalesCorpus();
  for (const d of data.deals) assert.ok(docs.some((x) => x.id === `deal:${d.id}`), d.id);
  for (const d of docs) assert.ok(d.text.split('\n').every((l) => /\.$/.test(l)), `${d.id}: every line is a sentence`);
  assert.equal(new Set(docs.map((d) => d.id)).size, docs.length);
});

test('the links of the Knowledge tab appear on both sides with identifiers in brackets', () => {
  const by = Object.fromEntries(salesDocuments(data).map((d) => [d.id, d.text]));
  const deal = by['deal:OFF-2026-0324'];
  assert.match(deal, /Muster Industrie AG \(account:muster-industrie-ag\)/);
  assert.match(deal, /call transcript CALL-0415 \(call:CALL-0415\)/);
  assert.match(deal, /e-mail thread T-104 \(thread:T-104\)/);
  assert.match(deal, /competes with Microsoft Copilot \(competitor:microsoft-copilot\)/);
  assert.match(deal, /skill pricing-guard \(skill:pricing-guard\)/);
  assert.match(by['account:muster-industrie-ag'], /deal:OFF-2026-0324/);
  assert.match(by['competitor:microsoft-copilot'], /deal:OFF-2026-0324/);
  assert.match(by['skill:pricing-guard'], /deal:OFF-2026-0324/);
});
