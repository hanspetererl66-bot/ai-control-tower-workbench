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

test('Develop has four tiles: Agent, Workflow with the n8n symbol, Skills and Connectors', () => {
  const hub = src('src/ui/DevelopHub.tsx');
  const agent = hub.indexOf('title="Create an Agent"'), flow = hub.indexOf('title="Create a Workflow"'), skills = hub.indexOf('label="Skills"'), connectors = hub.indexOf('label="Connectors"');
  assert.ok(agent > 0 && flow > agent && skills > flow && connectors > skills, 'order: agent, workflow, skills, connectors');
  assert.match(hub, /with n8n/);
  assert.match(hub, /aria-label="n8n"/);
  assert.match(hub, /props\.onOpenSkills/);
  assert.match(hub, /develop-card-block/);
  assert.match(hub, /What should be achieved\?/, 'both tiles start from a goal');
  assert.match(hub, /startWorkflow/, 'a workflow goal opens the guided process');
  assert.match(hub, /DevelopWizard/);
  assert.match(hub, /or open n8n directly/);
  assert.match(hub, /props\.onOpenConnectors/);
  const app = src('src/App.tsx');
  assert.match(app, /onAgentIntent=\{\(intent\) =>[\s\S]*newProject[\s\S]*setFocusProject[\s\S]*setView\('studio'\)/);
  assert.match(app, /onOpenN8n=\{\(\) => setView\('n8n'\)\}/);
  assert.match(app, /onOpenSkills=\{\(\) => \{ setManageFocus\('skills'\); setView\('manage'\); \}\}/);
  assert.match(app, /onOpenConnectors=\{\(\) => \{ setManageFocus\('connectors'\); setView\('manage'\); \}\}/);
  assert.match(app, /onBack=\{\(\) => setView\('develop'\)\}/g);
  assert.match(app, /sendRef\.current\(prompt, \[\], \{ plain: true \}\)/, 'working prompts never become Space requests');
});

test('the rail icons grow and get heavier on hover, in light and dark', () => {
  const css = src('src/theme.css');
  assert.match(css, /\.rail-btn:hover:not\(:disabled\) svg \{\s*transform: scale\(1\.2\)/);
  assert.match(css, /\.rail-btn:hover:not\(:disabled\) svg \[stroke\] \{\s*stroke-width: 2\.2/);
  assert.match(css, /:root\[data-theme="dark"\] \.rail-btn:hover:not\(:disabled\)/);
});
