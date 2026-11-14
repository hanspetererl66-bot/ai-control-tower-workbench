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
  assert.match(rail, /DEVELOP_VIEWS: View\[\] = \['develop', 'studio', 'manage', 'n8n']/);
});

test('Develop has four tiles: Agent, Workflow with the n8n symbol, Skills and Connectors', () => {
  const hub = src('src/ui/DevelopHub.tsx');
  const agent = hub.indexOf('label="Agent Studio"'), flow = hub.indexOf('title="Create a Workflow"'), skills = hub.indexOf('label="Skills"'), connectors = hub.indexOf('label="Connectors"');
  assert.ok(agent > 0 && flow > agent && skills > flow && connectors > skills, 'order: agent, workflow, skills, connectors');
  assert.match(hub, /with n8n/);
  assert.match(hub, /aria-label="n8n"/);
  assert.match(hub, /props\.onOpenSkills/);
  assert.match(hub, /develop-card-block/);
  assert.match(hub, /className="develop-explain"/, 'a short explanation sits under the tiles');
  assert.match(hub, /What should be achieved\?/, 'the goal tiles start from a goal');
  assert.match(hub, /startWorkflow/, 'a workflow goal opens the guided process');
  assert.match(hub, /DevelopWizard/);
  assert.match(hub, /other="Direct access to n8n"/, 'a small link below the goal opens n8n directly');
  assert.doesNotMatch(hub, /Your workflows|develop-tree|WorkflowCard/, 'the tile shows no project list');
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

test('the rail diamond is a three-dimensional gem that turns, flashes when a facet faces front, and stands still with reduced motion', () => {
  const rail = src('src/ui/Rail.tsx');
  assert.match(rail, /<SpinningDiamond/);
  assert.doesNotMatch(src('src/theme.css'), /rail-diamond-turn/, 'the flat CSS turn is gone');
  const gem = src('src/ui/SpinningDiamond.tsx') + src('src/gem.ts');
  assert.match(gem, /requestAnimationFrame/);
  assert.match(gem, /prefers-reduced-motion: reduce/);
  assert.match(gem, /Math\.pow\(Math\.max\(0, yaw\[2\] \/ around\), 40\)/, 'the flash is strongest when a side looks straight at the viewer');
});

test('both flows show their steps as joined circles from one shared component', () => {
  const stepper = src('src/ui/Stepper.tsx');
  assert.match(stepper, /stepper-dot/);
  assert.match(stepper, /'✓'/, 'a finished step shows a check mark');
  for (const file of ['src/ui/AgentProjectView.tsx', 'src/ui/DevelopWizard.tsx']) assert.match(src(file), /<Stepper/, file);
  assert.match(src('src/theme.css'), /\.stepper-item \+ \.stepper-item::before/, 'a line joins the circles');
  assert.match(stepper, /sub\?: StepItem\[\]/, 'a step can show its parts');
  assert.match(src('src/ui/AgentProjectView.tsx'), /FLOW\.map/, 'the agent project shows the five shared steps');
  assert.match(src('src/ui/AgentProjectView.tsx'), /SPEC_PARTS\.map/, 'the specification documents are parts of the third step');
  assert.match(src('src/ui/DevelopWizard.tsx'), /STAGES\.map/, 'the workflow wizard shows the same steps');
});

test('the Agent tile is the Agent Studio and opens three tiles in the purple family', () => {
  const hub = src('src/ui/DevelopHub.tsx'), css = src('src/theme.css');
  assert.match(hub, /title="Agent Studio"/);
  assert.doesNotMatch(hub, /Create an Agent/);
  assert.match(hub, /onOpen=\{\(\) => setMode\('agent'\)\}/);
  const create = hub.indexOf('title="Create new agent"'), extend = hub.indexOf('title="Extend existing SAP standard agent"'), integrate = hub.indexOf('title="Integrate external agent"');
  assert.ok(create > 0 && extend > create && integrate > extend, 'order: create, extend, integrate');
  assert.match(hub, /Extend the existing SAP standard agent: \$\{g\}/);
  assert.match(hub, /Integrate an external agent: \$\{g\}/);
  assert.match(hub, /props\.onAgentIntent\(`Extend/);
  assert.match(hub, /aria-label="Back to Develop"/);
  for (const k of ['agent-new', 'agent-ext', 'agent-int']) {
    assert.match(css, new RegExp(`\\.develop-logo-${k} \\{ color: #`), `${k} has its own colour`);
    assert.match(css, new RegExp(`data-theme="dark"\\] \\.develop-logo-${k} `), `${k} has a dark variant`);
  }
  const colours = ['agent-new', 'agent-ext', 'agent-int'].map((k) => new RegExp(`\\.develop-logo-${k} \\{ color: (#[0-9a-f]{6})`).exec(css)[1]);
  assert.equal(new Set(colours).size, 3, 'three different colours');
  const marks = ['AgentNewMark', 'AgentExtendMark', 'AgentIntegrateMark'];
  for (const m of marks) assert.match(hub, new RegExp(`function ${m}\\(`), `${m} is its own icon`);
});
