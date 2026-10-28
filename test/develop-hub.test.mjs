import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const src = (f) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');

test('the rail has one Develop button instead of separate Connectors and n8n buttons', () => {
  const rail = src('src/ui/Rail.tsx');
  assert.match(rail, /aria-label="Develop"/);
  assert.match(rail, /onView\('develop'\)/);
  assert.doesNotMatch(rail, /aria-label="n8n Automation"/);
  assert.doesNotMatch(rail, /aria-label="Connectors and Skills"/);
  assert.match(rail, /DEVELOP_VIEWS: View\[\] = \['develop', 'manage', 'n8n'\]/);
});

test('Develop starts a guided process, and the earlier screens stay reachable', () => {
  const hub = src('src/ui/DevelopHub.tsx');
  assert.match(hub, /Create a Workflow/);
  assert.match(hub, /with n8n/);
  assert.match(hub, /Create an Agent/);
  assert.match(hub, /start\('workflow'\)/);
  assert.match(hub, /start\('agent'\)/);
  assert.match(hub, /Open n8n directly/);
  const app = src('src/App.tsx');
  assert.match(app, /onOpenN8n=\{\(\) => setView\('n8n'\)\}/);
  assert.match(app, /onOpenConnectors=\{\(\) => setView\('manage'\)\}/);
  assert.match(app, /onBack=\{\(\) => setView\('develop'\)\}/g);
  assert.match(app, /sendRef\.current\(prompt, \[\], \{ plain: true \}\)/, 'working prompts never become Space requests');
});
