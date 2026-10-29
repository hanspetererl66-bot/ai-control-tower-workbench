import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/personalization.ts';
import { defaultGov, requestPromotion, decide } from '../src/skill-governance.ts';
import { allCommands, expandCommand } from '../src/chat-context.ts';

const fakeStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, removeItem: (k) => m.delete(k), has: (k) => m.has(k), size: () => m.size }; };

test('export contains only personalisation keys and parses JSON', () => {
  const s = fakeStore({ 'werkbank.memory': '{"enabled":true,"entries":[]}', 'werkbank.conversations': '[1]', 'werkbank.groupMode': 'local' });
  const b = p.exportPersonal(s, new Date('2026-10-27T10:00:00Z'));
  assert.deepEqual(Object.keys(b.data).sort(), ['werkbank.groupMode', 'werkbank.memory']);
  assert.equal(b.data['werkbank.memory'].enabled, true);
  assert.equal(b.data['werkbank.groupMode'], 'local');
  assert.equal(b.exportedAt, '2026-10-27T10:00:00.000Z');
});

test('clear removes personalisation keys and leaves everything else', () => {
  const s = fakeStore({ 'werkbank.memory': '{}', 'werkbank.personas': '{}', 'werkbank.conversations': '[1]' });
  assert.equal(p.clearPersonal(s), 2);
  assert.ok(!s.has('werkbank.memory')); assert.ok(s.has('werkbank.conversations'));
  assert.equal(p.clearPersonal(s), 0);
});

test('preview marks empty sections inactive', () => {
  const v = p.contextPreview({ style: 'Be short.', persona: '', memory: '- I lead Sales', group: '  ' });
  assert.deepEqual(v.map((x) => x.active), [true, false, true, false]);
});

test('audit lists request and decision, newest first, with level names; CSV escapes quotes', () => {
  let g = requestPromotion(defaultGov(), 'my "skill"', 'please', 1000);
  g = decide(g, 1, true, 'looks fine', 2000);
  const ev = p.buildAudit([{ kind: 'Skill', gov: g, nameOf: (id) => id }]);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].action, 'approved'); assert.equal(ev[1].action, 'requested');
  assert.equal(ev[0].from, g.levels[0]); assert.equal(ev[0].to, g.levels[1]);
  const csv = p.auditCsv(ev);
  assert.match(csv, /"my ""skill"""/);
  assert.equal(csv.split('\n').length, 3);
});

test('/make-skill is a built-in command that forbids saving files', () => {
  const out = expandCommand('/make-skill for renewals', allCommands([]), { memory: '', approvals: 0 });
  assert.match(out, /Do not create or save any file/);
  assert.match(out, /for renewals/);
});
