import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { backLabel, keepReturn } from '../src/space-return.ts';

const ROOT = join(import.meta.dirname, '..');
const spaces = [{ slug: 'it-infrastructure', title: 'Infra VM landscape' }, { slug: 'sales', title: 'Sales' }];

test('back button: label names the Space, nothing when the Space is gone or unknown', () => {
  assert.equal(backLabel(spaces, 'it-infrastructure'), 'Back to Infra VM landscape');
  assert.equal(backLabel(spaces, 'removed-space'), null);
  assert.equal(backLabel(spaces, null), null);
  assert.equal(backLabel([], 'sales'), null);
});

test('back button: the remembered Space is only kept while the chat is open', () => {
  assert.equal(keepReturn('chat'), true);
  for (const v of ['spaces', 'manage', 'skills', 'admin', 'develop']) assert.equal(keepReturn(v), false, v);
});

test('back button: App remembers the Space on "Ask Joule", shows the button in the chat header and returns to that Space', () => {
  const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
  assert.match(app, /if \(spaceSlug\) \{ setContextSpace\(spaceSlug\); setReturnSpace\(spaceSlug\); \}/);
  assert.match(app, /useEffect\(\(\) => \{ if \(!keepReturn\(view\)\) setReturnSpace\(null\); \}, \[view\]\)/);
  assert.match(app, /className="topbar-back"/);
  assert.match(app, /setSelectedSpace\(returnSpace\); setSpacesHome\(false\); setView\('spaces'\)/);
  const css = readFileSync(join(ROOT, 'src/theme.css'), 'utf8');
  assert.match(css, /\.topbar-back \{[^}]*-webkit-app-region: no-drag/, 'the button works inside the draggable title bar');
});

test('Infra VM landscape: keeps its working state across the trip to the chat', async () => {
  const html = readFileSync(join(ROOT, 'examples/it-infrastructure/index.html'), 'utf8');
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; } });
  const w = dom.window, sent = [];
  Object.defineProperty(w, 'parent', { value: { postMessage: (m) => sent.push(m) } });
  await new Promise((r) => setTimeout(r, 120));
  const vm = w.__vms().find((v) => v.status === 'red');
  w.__state.sel = vm.id; w.__state.filter = 'red';
  w.document.querySelector('#filters button[data-f="red"]').click();
  const saved = sent.filter((m) => m.type === 'wb:state').at(-1);
  assert.ok(saved, 'the page reports its state');
  assert.equal(saved.state.filter, 'red');
  // a fresh page (after the trip) gets the state back
  const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(x) { x.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; } });
  const w2 = dom2.window;
  Object.defineProperty(w2, 'parent', { value: { postMessage: () => {} } });
  await new Promise((r) => setTimeout(r, 120));
  const state = { ...saved.state, sel: vm.id, filter: 'red' };
  w2.dispatchEvent(new w2.MessageEvent('message', { data: { type: 'wb:restore', state, handoffs: [] }, source: w2.parent }));
  assert.equal(w2.__state.sel, vm.id);
  assert.equal(w2.__state.filter, 'red');
  assert.match(w2.document.querySelector('#detail h2').textContent, new RegExp(vm.name));
  // hostile state is cut down
  w2.dispatchEvent(new w2.MessageEvent('message', { data: { type: 'wb:restore', state: { filter: '<x>', sel: 'nope', q: 'x'.repeat(500), done: { '__proto__|x': true, 'a b|c': true } }, handoffs: [] }, source: w2.parent }));
  assert.equal(w2.__state.filter, 'red', 'an unknown filter is ignored');
  assert.equal(w2.__state.q.length, 80);
  assert.deepEqual(Object.keys(w2.__state.done), []);
  assert.deepEqual(errors, []);
  w.close(); w2.close();
});

test('Space name and region: it is called Infra VM landscape, the region is APAC', () => {
  const meta = JSON.parse(readFileSync(join(ROOT, 'examples/it-infrastructure/space.json'), 'utf8'));
  assert.equal(meta.title, 'Infra VM landscape');
  for (const f of ['examples/it-fleet/index.html', 'examples/it-fleet/fleet.json', 'examples/knowledge-graph/links.json', 'scripts/generate-fleet-data.mjs']) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /\bAPEC\b/, `${f}: APAC, not APEC`);
  }
});
