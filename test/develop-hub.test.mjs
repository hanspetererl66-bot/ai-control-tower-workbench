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
  assert.match(rail, /DEVELOP_VIEWS: View\[\] = \['develop', 'studio', 'manage', 'n8n'\]/);
});

test('Develop offers a workflow card and an agent card that lead to the earlier screens', () => {
  const hub = src('src/ui/DevelopHub.tsx');
  assert.match(hub, /Create a Workflow/);
  assert.match(hub, /with n8n/);
  assert.match(hub, /Create an Agent/);
  assert.match(hub, /Connectors &amp; Skills/);
  const app = src('src/App.tsx');
  assert.match(app, /<DevelopHub onWorkflow=\{\(\) => setView\('n8n'\)\} onAgent=\{\(\) => setView\('studio'\)\} onConnectors=\{\(\) => setView\('manage'\)\} \/>/);
  assert.match(app, /onBack=\{\(\) => setView\('develop'\)\}/g);
});
