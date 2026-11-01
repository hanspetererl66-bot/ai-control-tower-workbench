import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CONTROL_TOWER_CONNECTOR, hasControlTowerConnector } from '../src/starter-prompts.ts';

test('connector detection ignores case and separators', () => {
  assert.equal(hasControlTowerConnector(['ai-control-tower']), true);
  assert.equal(hasControlTowerConnector(['AI_Control Tower']), true);
  assert.equal(hasControlTowerConnector(['arc1', 'sapnotes']), false);
  assert.equal(hasControlTowerConnector([]), false);
});

test('the empty chat shows no built-in AI Control Tower shortcuts, only the person\'s own prompts and favourite skills', () => {
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const starters = read('src/ui/StarterPrompts.tsx');
  assert.doesNotMatch(starters, /AI Control Tower|STARTER_PROMPTS|fehlt oder ist nicht verbunden|Jetzt installieren/);
  assert.match(starters, /My prompts/);
  assert.match(starters, /Favourite skills/);
  assert.equal(starters.includes('return null'), true, 'nothing at all when the person has no own prompts or favourites');
  assert.doesNotMatch(read('src/starter-prompts.ts'), /STARTER_PROMPTS/);
  assert.doesNotMatch(read('src/ui/PreferencesPanels.tsx'), /Suggestions on the empty chat/);
  assert.doesNotMatch(read('src/ui/Composer.tsx'), /onInstallConnector|pickStarter/);
});

test('connector name matches the bundle manifest', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('../connectors/ai-control-tower/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, CONTROL_TOWER_CONNECTOR);
});
