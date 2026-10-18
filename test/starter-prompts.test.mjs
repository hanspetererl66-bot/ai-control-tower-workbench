import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROL_TOWER_CONNECTOR, STARTER_PROMPTS, hasControlTowerConnector } from '../src/starter-prompts.ts';

test('connector detection ignores case and separators', () => {
  assert.equal(hasControlTowerConnector(['ai-control-tower']), true);
  assert.equal(hasControlTowerConnector(['AI_Control Tower']), true);
  assert.equal(hasControlTowerConnector(['arc1', 'sapnotes']), false);
  assert.equal(hasControlTowerConnector([]), false);
});

test('starter prompts are unique, non-empty and do not carry routing text', () => {
  assert.ok(STARTER_PROMPTS.length >= 3);
  assert.equal(new Set(STARTER_PROMPTS.map((s) => s.label)).size, STARTER_PROMPTS.length);
  for (const s of STARTER_PROMPTS) {
    assert.ok(s.label.trim() && s.prompt.trim());
    assert.ok(!/use only/i.test(s.prompt), s.label);
  }
});

test('connector name matches the bundle manifest', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('../connectors/control-tower/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, CONTROL_TOWER_CONNECTOR);
});
