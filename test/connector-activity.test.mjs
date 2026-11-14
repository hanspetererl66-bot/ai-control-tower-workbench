import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { connectorOfTool, isLiveConnector, liveConnectors, normalizeConnector } from '../src/connector-activity.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('a connector is live while one of its tool calls is still running; finished, failed and built-in calls do not count', () => {
  const tools = [
    { extensionName: 'sub4me', toolName: 'sub4me__list_tickets', status: 'pending' },
    { extensionName: 'sub4me', toolName: 'sub4me__create_ticket', status: 'pending' },
    { extensionName: 'ai-control-tower', status: 'completed' },
    { extensionName: 'n8n-automation', status: 'failed' },
    { toolName: 'knowledge-graph__recall', status: 'pending' },
    { toolName: 'developer__shell', status: 'pending' },
    { toolName: 'write_file', status: 'pending' },
    { status: 'pending' },
  ];
  assert.deepEqual(liveConnectors(tools).sort(), ['developer', 'knowledgegraph', 'sub4me']);
  assert.deepEqual(liveConnectors([]), []);
  assert.deepEqual(liveConnectors([{ extensionName: 'sub4me', status: 'completed' }]), [], 'when the call ends the connector stops being live');
});

test('names are compared without case, spaces and dashes, so the runtime name and the configuration key meet', () => {
  assert.equal(normalizeConnector('AI Control Tower'), 'aicontroltower');
  assert.equal(connectorOfTool({ extensionName: 'ai-control-tower' }), 'aicontroltower');
  assert.equal(connectorOfTool({ toolName: 'ai-control-tower__get_risks' }), 'aicontroltower');
  assert.equal(connectorOfTool({ toolName: 'get_risks' }), '', 'a tool name without "__" belongs to no connector');
  const live = liveConnectors([{ extensionName: 'ai-control-tower', status: 'pending' }]);
  assert.equal(isLiveConnector(live, 'AI Control Tower'), true);
  assert.equal(isLiveConnector(live, 'ai_control_tower'), true);
  assert.equal(isLiveConnector(live, 'sub4me'), false);
});

test('the connector list marks a live connector with the blue outline and the words "in use"; the app only shows it while an answer is being made', () => {
  const view = read('src/ui/ManageView.tsx');
  assert.match(view, /className=\{`row\$\{isLiveConnector\(liveConnectors, e\.configKey\) \? ' conn-live' : ''\}`\}/);
  assert.match(view, /<em className="row-live" role="status"> in use<\/em>/, 'not only colour');
  const app = read('src/App.tsx');
  assert.match(app, /liveConnectors=\{busy \? liveExt : \[\]\}/, 'a cancelled answer cannot leave a connector marked');
  assert.match(app, /setLiveExt\(liveConnectors\(tools\.current\)\)/);
  assert.equal((app.match(/setLiveExt\(liveConnectors\(tools\.current\)\)/g) ?? []).length, 2, 'when a call starts and when it is updated');
});

test('the style: a thin blue outline whose opacity glides softly between 40 % and 100 %, a blue token for light and dark, and nothing moves with reduced motion', () => {
  const css = read('src/theme.css');
  assert.match(css, /:root \{ --live: #2f6fe4; \}/);
  assert.match(css, /:root\[data-theme="dark"\] \{ --live: #7aa5ff; \}/);
  const rule = /\.row\.conn-live::after \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /border: 1px solid var\(--live\)/, 'thin');
  assert.match(rule, /inset: -1px/, 'it lies exactly on the row border');
  assert.match(rule, /pointer-events: none/, 'it never catches a click');
  assert.match(rule, /animation: conn-live 2\.8s ease-in-out infinite/, 'slow and easing, no steps');
  const frames = /@keyframes conn-live \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.match(frames, /0%, 100% \{ opacity: 0\.4; \}/, 'the outline never disappears');
  assert.match(frames, /50% \{ opacity: 1; \}/);
  assert.doesNotMatch(frames, /border-color/, 'a border colour would jump instead of glide');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.row\.conn-live::after \{ animation: none; opacity: 0\.8; \}/);
  assert.doesNotMatch(rule, /#[0-9a-fA-F]{3,8}\b|rgb\(/);
});
