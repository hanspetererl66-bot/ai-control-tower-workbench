import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (rel) => readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');
const panel = read('src/ui/SidePanel.tsx');
const app = read('src/App.tsx');
const css = read('src/theme.css');

test('the side panel offers exactly Memory, Context, Instructions and Schedule, as an accessible tab list', () => {
  const ids = [...panel.matchAll(/\{ id: '(\w+)', title: '(\w+)' \}/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(ids, ['memory:Memory', 'context:Context', 'instructions:Instructions', 'schedule:Schedule']);
  assert.match(panel, /role="tablist"/);
  assert.match(panel, /role="tabpanel"/);
  assert.match(panel, /aria-selected=\{tab === t\.id\}/);
  assert.match(panel, /ArrowRight/);
});

test('the tabs reuse the existing memory, schedule and preference stores instead of new ones', () => {
  assert.match(panel, /<MemoryPanel memory=\{props\.memory\}/);
  assert.match(panel, /<ScheduleEditor schedules=\{props\.schedules\}/);
  assert.match(panel, /assistant: \{ \.\.\.p\.assistant, \.\.\.patch \}/);
  assert.match(panel, /assistantNote\(prefs\)/);
  assert.match(read('src/ui/SchedulePopover.tsx'), /<ScheduleEditor schedules=\{schedules\}/, 'the clock popover keeps working through the same editor');
});

test('the app opens the panel from the top bar at any time and passes live state', () => {
  assert.doesNotMatch(app, /files\.length > 0 \|\| detailsOpen/, 'the button no longer waits for a generated file');
  assert.match(app, /<SidePanel[\s\S]*memory=\{memory\}[\s\S]*onMemoryChange=\{changeMemory\}[\s\S]*prefs=\{prefs\}[\s\S]*schedules=\{schedules\}/);
  assert.match(app, /setSideTab\('context'\)/, 'a generated file shows the Context tab');
  assert.match(app, /id: 'memory'[\s\S]*id: 'instructions'[\s\S]*id: 'web'[\s\S]*id: 'group'[\s\S]*id: 'schedule'/);
});

test('the panel has room for a form and scrolls on its own', () => {
  assert.match(css, /\.app-details\s*{\s*grid-template-columns:[^}]*360px/);
  assert.match(css, /\.side-body\s*{[^}]*overflow-y:\s*auto/);
});
