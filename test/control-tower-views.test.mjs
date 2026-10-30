import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { callTool, TOOL_DEFINITIONS } from '../connectors/_lib/server/tools.mjs';
import { TAB_LABELS, TOOL_TABS, controlTowerViewFor, controlTowerViews } from '../src/control-tower-views.ts';

const ROOT = join(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/control-tower/data.json'), 'utf8'));
const html = readFileSync(join(ROOT, 'examples/control-tower/index.html'), 'utf8');

test('the tool→tab mapping equals the view each connector tool reports', () => {
  assert.deepEqual(Object.keys(TOOL_TABS).sort(), TOOL_DEFINITIONS.map((tool) => tool.name).sort());
  for (const name of Object.keys(TOOL_TABS)) {
    const result = callTool(name, name === 'get_risk' ? { id: 'R1' } : {}, data);
    const { view } = JSON.parse(result.content[0].text);
    assert.deepEqual(view, { space: 'ai-control-tower', tab: TOOL_TABS[name] }, name);
  }
});

test('every mapped tab exists in the dashboard and has a label', () => {
  for (const tab of new Set(Object.values(TOOL_TABS))) {
    assert.ok(html.includes(`id="page-${tab}"`), `page-${tab}`);
    assert.ok(html.includes(`onclick="go('${tab}',this)"`), `button for ${tab}`);
    assert.ok(TAB_LABELS[tab], `label for ${tab}`);
  }
});

test('only completed Control Tower tool calls produce a view', () => {
  const done = { status: 'completed' };
  assert.equal(controlTowerViewFor({ ...done, toolName: 'ai-control-tower__get_risks' })?.tab, 'risk');
  assert.equal(controlTowerViewFor({ ...done, toolName: 'get_budget', extensionName: 'ai-control-tower' })?.tab, 'gov');
  assert.equal(controlTowerViewFor({ ...done, toolName: 'get_budget' })?.tab, 'gov'); // extension unknown
  assert.equal(controlTowerViewFor({ status: 'pending', toolName: 'ai-control-tower__get_risks' }), null);
  assert.equal(controlTowerViewFor({ status: 'failed', toolName: 'ai-control-tower__get_risks' }), null);
  assert.equal(controlTowerViewFor({ ...done, toolName: 'other-server__get_budget' }), null);
  assert.equal(controlTowerViewFor({ ...done, toolName: 'get_budget', extensionName: 'arc1' }), null);
  assert.equal(controlTowerViewFor({ ...done, toolName: 'ai-control-tower__constructor' }), null);
  assert.equal(controlTowerViewFor({ ...done }), null);
});

test('views are de-duplicated and keep first-use order', () => {
  const tools = ['get_risks', 'get_agent_overview', 'list_agents', 'get_risk', 'get_overprivileged_agents', 'get_budget'].map(
    (name) => ({ status: 'completed', toolName: `ai-control-tower__${name}` })
  );
  assert.deepEqual(controlTowerViews(tools).map((view) => view.tab), ['risk', 'repo', 'gov']);
});

test('the dashboard only reacts to messages from its parent, for known tab ids', () => {
  assert.match(html, /e\.source!==window\.parent/);
  assert.match(html, /\/\^\[a-z\]\+\$\/\.test\(d\.tab\)/);
});
