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

test('Develop has the Agent tile first, then the Workflow tile with the n8n symbol, then Skills and Connectors', () => {
  const hub = src('src/ui/DevelopHub.tsx');
  const agent = hub.indexOf('title="Create an Agent"'), flow = hub.indexOf('title="Create a Workflow"'), skills = hub.indexOf('aria-label="Skills and Connectors"');
  assert.ok(agent > 0 && flow > agent && skills > flow, 'order: agent, workflow, skills');
  assert.match(hub, /with n8n/);
  assert.match(hub, /aria-label="n8n"/);
  assert.match(hub, /Skills &amp; Connectors/);
  assert.match(hub, /What should be achieved\?/, 'both tiles start from a goal');
  const app = src('src/App.tsx');
  assert.match(app, /onAgentIntent=\{\(intent\) =>[\s\S]*newProject[\s\S]*setFocusProject[\s\S]*setView\('studio'\)/);
  assert.match(app, /onWorkflowIntent=\{\(intent\) =>[\s\S]*workflowPlanPrompt\(intent\)/);
  assert.match(app, /onBack=\{\(\) => setView\('develop'\)\}/g);
});
