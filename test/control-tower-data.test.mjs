import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embeddedData, embedData } from '../scripts/sync-control-tower-data.mjs';

const DIR = join(import.meta.dirname, '..', 'examples/control-tower');
const data = JSON.parse(readFileSync(join(DIR, 'data.json'), 'utf8'));
const html = readFileSync(join(DIR, 'index.html'), 'utf8');

test('index.html embeds exactly the data in data.json', () => {
  assert.deepEqual(embeddedData(html), data);
  assert.equal(embedData(html, data), html, 'run `npm run sync:control-tower`');
});

test('risk records are well-formed', () => {
  const severities = new Set(['high', 'medium', 'low']);
  const tones = new Set(['red', 'amber', 'blue', 'green']);
  const colors = new Set(['red', 'amber', 'blue', 'purple', 'green']);
  const ids = new Set();
  assert.ok(data.risks.length > 0);
  for (const risk of data.risks) {
    assert.ok(!ids.has(risk.id), `duplicate id ${risk.id}`);
    ids.add(risk.id);
    assert.ok(severities.has(risk.severity), `${risk.id} severity`);
    assert.ok(tones.has(risk.etaTone), `${risk.id} etaTone`);
    assert.ok(colors.has(risk.progressColor), `${risk.id} progressColor`);
    assert.ok(Number.isInteger(risk.progressPct) && risk.progressPct >= 0 && risk.progressPct <= 100, `${risk.id} progressPct`);
    for (const key of ['title', 'description', 'owner', 'ownerTeam', 'eta', 'progressNote', 'action', 'tile', 'short']) {
      assert.equal(typeof risk[key], 'string', `${risk.id}.${key}`);
      assert.ok(risk[key].length > 0, `${risk.id}.${key} is empty`);
    }
  }
});

test('the page has the containers the renderer fills, and no hand-written risk rows', () => {
  assert.match(html, /id="risk-summary"/);
  assert.match(html, /<tbody id="risk-register-body"><\/tbody>/);
  assert.doesNotMatch(html, /Instability \(20%\)/);
});

test('net annual return is stated consistently', () => {
  assert.doesNotMatch(html, /&euro;134M/);
});
