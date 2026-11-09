import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { MIN_VISIBLE_MS, createToastGate } from '../src/toast-timer.ts';
import { missingSpaceNotice } from '../src/space-handoff.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the notice names the Space and the install command', () => {
  const text = missingSpaceNotice('agent-registry');
  assert.match(text, /“agent-registry” is not installed/);
  assert.match(text, /node scripts\/install-example-space\.mjs agent-registry/);
});

test('a message stays visible for the minimum time even when an earlier timer clears it', () => {
  let clock = 0;
  const queue = [];
  const gate = createToastGate(() => clock, (fn, ms) => queue.push({ at: clock + ms, fn }));
  let shown = null;
  const apply = (v) => { shown = v; };
  gate.request('first', apply); // t=0, its own timer (6000) is the caller's business
  clock = 1000; gate.request('second', apply); // a newer message at t=1000
  clock = 1500; gate.request(null, apply); // the timer of the FIRST message fires too early for the second one
  assert.equal(shown, 'second', 'not cleared yet');
  assert.equal(queue.length, 1, 'the clear was postponed, not dropped');
  clock = queue[0].at; queue[0].fn();
  assert.equal(shown, null, 'cleared once the minimum time has passed');
  assert.ok(queue[0].at - 1000 >= MIN_VISIBLE_MS, 'the second message was visible at least the minimum');
});

test('a clear after the minimum time is applied at once', () => {
  let clock = 0;
  const gate = createToastGate(() => clock, () => assert.fail('no postponing needed'));
  let shown = 'x';
  gate.request('a', (v) => { shown = v; });
  clock = MIN_VISIBLE_MS + 1;
  gate.request(null, (v) => { shown = v; });
  assert.equal(shown, null);
});

function withTower(fn) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(read('examples/control-tower/index.html'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
  try { fn(dom.window); } finally { dom.window.close(); }
}
const tell = (w, data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w }));
const missing = (w) => [...w.document.querySelectorAll('.hub-tile.hub-missing')].map((t) => t.getAttribute('data-hub-space'));

test('the Control Tower marks the tiles of Spaces that are not installed', () => {
  withTower((w) => {
    assert.deepEqual(missing(w), [], 'nothing marked before the host has said anything');
    tell(w, { type: 'ct:spaces', slugs: ['ai-control-tower', 'agent-registry'] });
    assert.deepEqual(missing(w).sort(), ['agent-compliance', 'agent-observability']);
    tell(w, { type: 'ct:spaces', slugs: ['agent-registry', 'agent-compliance', 'agent-observability'] });
    assert.deepEqual(missing(w), [], 'all installed: no mark');
    tell(w, { type: 'ct:spaces', slugs: [] });
    assert.deepEqual(missing(w).sort(), ['agent-compliance', 'agent-observability', 'agent-registry'], 'the Agent Studio tile is never marked');
  });
});

test('the Control Tower ignores a malformed list and messages that do not come from the host', () => {
  withTower((w) => {
    tell(w, { type: 'ct:spaces', slugs: 'agent-registry' });
    tell(w, { type: 'ct:spaces' });
    w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'ct:spaces', slugs: [] }, source: null }));
    assert.deepEqual(missing(w), []);
    tell(w, { type: 'ct:spaces', slugs: [42, '<img src=x>', 'agent-registry'] });
    assert.deepEqual(missing(w).sort(), ['agent-compliance', 'agent-observability']);
  });
});

test('the host sends the installed Spaces only to the Control Tower', () => {
  const viewer = read('src/ui/SpaceViewer.tsx');
  assert.match(viewer, /space\.slug !== 'ai-control-tower' \|\| !loaded\.current \|\| !installedSpaces/);
  assert.match(viewer, /type: 'ct:spaces', slugs: installedSpaces\.slice\(0, 200\)/);
  assert.match(read('src/App.tsx'), /installedSpaces=\{space\.slug === 'ai-control-tower' \? spaces\.map\(\(x\) => x\.slug\) : undefined\}/);
  assert.match(read('src/App.tsx'), /setToast\(missingSpaceNotice\(handoff\.to\)\)/);
});
