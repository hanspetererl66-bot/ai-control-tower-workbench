import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the Admin console has a tile for Agent observability that opens the Space', () => {
  const view = read('src/ui/AdminView.tsx');
  assert.match(view, /aria-label="Agent observability"/);
  assert.match(view, /Open Agent observability/);
  assert.match(view, /disabled=\{!observabilityInstalled\}/);
  assert.match(view, /npm run install:agent-observability/);
  const app = read('src/App.tsx');
  assert.match(app, /observabilityInstalled=\{spaces\.some\(\(x\) => x\.slug === OBSERVABILITY_SPACE\)\}/);
  assert.match(app, /onOpenObservability=\{\(\) => \{ setSelectedSpace\(OBSERVABILITY_SPACE\); setSpacesHome\(false\); setView\('spaces'\); \}\}/);
  assert.match(read('src/observability-bridge.ts'), /OBSERVABILITY_SPACE = 'agent-observability'/);
  assert.equal(JSON.parse(read('examples/agent-observability/space.json')).title, 'Agent Observability');
});

test('the tile colour is a token with a light and a dark value', () => {
  const css = read('src/theme.css');
  assert.match(css, /\.adm-logo-observe \{ --adm-tone: var\(--adm-amber\); \}/);
  assert.match(css, /:root \{[^}]*--adm-amber:/);
  assert.match(css, /:root\[data-theme="dark"\] \{[^}]*--adm-amber:/);
});
