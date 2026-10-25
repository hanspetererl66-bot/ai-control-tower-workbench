import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAction } from '../src/approval.ts';
import { exportFileName, markdownDocument } from '../src/export-answer.ts';
import { followUps } from '../src/follow-ups.ts';
import { privacySummary } from '../src/privacy-bar.ts';
import { DEFAULT_CHAT_TOOLS, sanitizeChatTools } from '../src/preferences.ts';
import { describeSchedule, isDue, nextRun, sanitizeSchedules } from '../src/schedules.ts';
import { estimateUsage } from '../src/usage.ts';

const monFri = { id: 'a1', prompt: 'Renewals news', time: '08:00', repeat: 'weekly', days: [1, 2, 3, 4, 5], enabled: true };

test('schedules: daily and weekly runs, catch-up window and last run', () => {
  const wed = new Date(2026, 9, 21, 8, 30); // Wednesday 08:30 local
  assert.equal(isDue(monFri, wed), true);
  assert.equal(isDue({ ...monFri, lastRun: new Date(2026, 9, 21, 8, 1).toISOString() }, wed), false, 'already ran today');
  assert.equal(isDue(monFri, new Date(2026, 9, 21, 15, 0)), false, 'older than six hours');
  assert.equal(isDue({ ...monFri, enabled: false }, wed), false);
  assert.equal(isDue(monFri, new Date(2026, 9, 24, 8, 30)), false, 'Saturday is not selected');
  const next = nextRun(monFri, new Date(2026, 9, 23, 9, 0)); // Friday after 08:00 -> Monday
  assert.equal(next.getDay(), 1);
  assert.equal(describeSchedule(monFri), 'every Mo, Tu, We, Th, Fr at 08:00');
  assert.equal(describeSchedule({ ...monFri, repeat: 'daily', days: [] }), 'every day at 08:00');
});

test('schedules: invalid entries are dropped', () => {
  const list = sanitizeSchedules([monFri, { ...monFri, id: 'b', time: '25:00' }, { ...monFri, id: 'c', days: [] }, { ...monFri, id: 'a1' }, null, { ...monFri, id: 'd', prompt: '  ' }]);
  assert.deepEqual(list.map((s) => s.id), ['a1']);
});

test('approval card: tells reads from changes and hides secrets', () => {
  const read = describeAction({ toolName: 'control-tower__list_contracts', rawInput: {} });
  assert.equal(read.risk, 'reads');
  const change = describeAction({ toolName: 'control-tower__create_ticket', rawInput: { title: 'x', api_token: 'secret' } });
  assert.equal(change.risk, 'changes');
  assert.deepEqual(change.params.map(([k]) => k), ['title']);
});

test('usage estimate and privacy summary', () => {
  const u = estimateUsage([{ role: 'user', text: 'a'.repeat(400) }, { role: 'agent', text: 'b'.repeat(800) }], 3, 15);
  assert.equal(u.inTokens, 100);
  assert.equal(u.outTokens, 200);
  assert.ok(Math.abs(u.eur - (100 * 3 + 200 * 15) / 1e6) < 1e-9);
  assert.equal(estimateUsage([], 0, 0).eur, null);
  const p = privacySummary({ webSearch: false, connectors: [], model: '', mode: 'smart_approve' });
  assert.equal(p.web, 'Web search off');
  assert.equal(p.connectors, 'No connector');
});

test('export and follow-ups', () => {
  assert.equal(exportFileName('Größe & Zahlen!', 'md', new Date('2026-10-24T10:00:00Z')), 'gro-e-zahlen-2026-10-24.md');
  const md = markdownDocument('Titel', 'Text', ['https://sap.com'], new Date('2026-10-24T10:00:00Z'));
  assert.match(md, /^# Titel/);
  assert.match(md, /## Sources[\s\S]*https:\/\/sap\.com/);
  const q = followUps('Die Verlängerung von Muster GmbH ist offen.', [], 'de');
  assert.ok(Array.isArray(q) && q.length <= 3);
});

test('chat tool preferences: defaults and sanitizing', () => {
  assert.deepEqual(sanitizeChatTools(undefined), DEFAULT_CHAT_TOOLS);
  const c = sanitizeChatTools({ readAloud: true, priceInPerM: -4, hiddenStarters: ['A', 5, 'A'], hiddenBriefing: ['cat:sales', 'certs', 7, 'certs'], askBeforeActions: false });
  assert.equal(c.readAloud, true);
  assert.equal(c.askBeforeActions, false);
  assert.equal(c.priceInPerM, 0);
  assert.deepEqual(c.hiddenStarters, ['A']);
  assert.deepEqual(c.hiddenBriefing, ['cat:sales', 'certs']);
});
