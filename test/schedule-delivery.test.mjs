import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isDue, nextRun, sanitizeSchedules, sanitizeDelivery, scheduleTitle, isEmail } from '../src/schedules.ts';
import { briefingFileName, briefingSubject, deliverBriefing, deliveryLabel, emailDraftArgs, gmailExtension, isFailedAnswer } from '../src/schedule-delivery.ts';

const read = (rel) => readFileSync(path.resolve(import.meta.dirname, '..', rel), 'utf8');
const base = { id: 'a1', prompt: 'Which renewals are at risk?', time: '08:00', repeat: 'daily', days: [], enabled: true };
const NOW = new Date('2026-11-02T08:05:00');

test('old briefings without the new fields still load and behave as before', () => {
  const [s] = sanitizeSchedules([base]);
  assert.deepEqual(s, { ...base, lastRun: undefined });
  assert.equal(isDue(s, NOW), true);
  assert.ok(nextRun(s, NOW));
  assert.equal(scheduleTitle(s), 'Which renewals are at risk?');
});

test('name, delivery and last result are cleaned on the way in', () => {
  const [s] = sanitizeSchedules([{ ...base, name: '  Renewals\ncheck ', delivery: { pdf: false, email: true, to: ' me@example.com ' }, lastStatus: 'ok', lastNote: 'PDF saved' }]);
  assert.equal(s.name, 'Renewals check');
  assert.deepEqual(s.delivery, { pdf: true, email: true, to: 'me@example.com' }, 'email implies the PDF');
  assert.equal(s.lastStatus, 'ok');
  assert.equal(scheduleTitle(s), 'Renewals check');
});

test('email without a valid single address is switched off, and no delivery leaves no field', () => {
  assert.deepEqual(sanitizeDelivery({ pdf: true, email: true, to: 'nope' }), { pdf: true, email: false, to: '' });
  for (const to of ['a@b.de, c@d.de', 'a@b.de\nBcc: x@y.de', 'a b@c.de', '<a@b.de>', '']) assert.equal(isEmail(to), false, to);
  const [s] = sanitizeSchedules([{ ...base, delivery: { pdf: false, email: false } }, { ...base, id: 'a2', lastStatus: 'weird' }]);
  assert.equal('delivery' in s, false);
});

test('file name, subject and draft arguments', () => {
  const s = { ...base, name: 'Übersicht Q4 / Risiken', delivery: { pdf: true, email: true, to: 'me@example.com' } };
  assert.equal(briefingFileName(s, NOW), 'ubersicht-q4-risiken-2026-11-02.pdf');
  assert.match(briefingFileName({ ...base, prompt: '???' }, NOW), /^briefing-2026-11-02\.pdf$/);
  assert.equal(briefingSubject(s, NOW), 'Briefing: Übersicht Q4 / Risiken (2026-11-02)');
  const args = emailDraftArgs(s, 'x.pdf', 'JVBERg==', '## Risks\n\nThree renewals.\n\nMore.', NOW);
  assert.equal(args.to, 'me@example.com');
  assert.deepEqual(args.attachments, [{ filename: 'x.pdf', content_base64: 'JVBERg==', mime_type: 'application/pdf' }]);
  assert.match(args.body, /Risks/);
  assert.match(args.body, /draft: check it and send it from Gmail/);
  assert.equal(deliveryLabel(s), 'PDF + email draft to me@example.com');
  assert.equal(deliveryLabel(base), '');
  assert.equal(gmailExtension(['ai-control-tower', 'gmail-drafts']), 'gmail-drafts');
  assert.equal(gmailExtension(['jira']), '');
});

const deps = (over = {}) => {
  const calls = { render: [], tool: [] };
  return {
    calls,
    deps: {
      buildHtml: (t, x) => `<h1>${t}</h1>${x}`,
      renderPdf: async (r) => { calls.render.push(r); return { ok: true, path: '/w/briefings/' + r.fileName, base64: 'JVBERg==' }; },
      callTool: async (n, a) => { calls.tool.push([n, a]); return { content: [{ text: '{}' }] }; },
      gmail: 'gmail-drafts', ...over,
    },
  };
};

test('without delivery nothing is rendered; failed answers are never delivered', async () => {
  const { calls, deps: d } = deps();
  assert.equal((await deliverBriefing(base, 'Answer', d, NOW)).status, 'ok');
  assert.equal(calls.render.length, 0);
  const s = { ...base, delivery: { pdf: true, email: true, to: 'me@example.com' } };
  for (const bad of ['', '  ', '⚠️ agent stopped']) assert.equal((await deliverBriefing(s, bad, d, NOW)).status, 'error');
  assert.equal(isFailedAnswer('Fine'), false);
  assert.equal(calls.render.length, 0);
  assert.equal(calls.tool.length, 0);
});

test('PDF only: rendered once, no email tool is called', async () => {
  const { calls, deps: d } = deps();
  const r = await deliverBriefing({ ...base, delivery: { pdf: true, email: false, to: '' } }, 'Answer', d, NOW);
  assert.equal(r.status, 'ok');
  assert.match(r.note, /PDF saved: briefings\/which-renewals-are-at-risk-2026-11-02\.pdf/);
  assert.equal(calls.render.length, 1);
  assert.equal(calls.tool.length, 0);
});

test('PDF and email: a draft is created through the Gmail create_draft tool and the note says it is not sent', async () => {
  const { calls, deps: d } = deps();
  const r = await deliverBriefing({ ...base, delivery: { pdf: true, email: true, to: 'me@example.com' } }, 'Answer', d, NOW);
  assert.equal(r.status, 'ok');
  assert.equal(calls.tool[0][0], 'gmail-drafts__create_draft');
  assert.match(r.note, /not sent/);
  assert.ok(!calls.tool.some(([n]) => /send/.test(n)));
});

test('failures are reported in one line and keep what already worked', async () => {
  const s = { ...base, delivery: { pdf: true, email: true, to: 'me@example.com' } };
  let r = await deliverBriefing(s, 'A', deps({ renderPdf: async () => ({ ok: false, detail: 'no window' }) }).deps, NOW);
  assert.deepEqual([r.status, r.note], ['error', 'PDF failed: no window']);
  r = await deliverBriefing(s, 'A', deps({ renderPdf: async () => { throw new Error('boom'); } }).deps, NOW);
  assert.match(r.note, /PDF failed: boom/);
  r = await deliverBriefing(s, 'A', deps({ gmail: '' }).deps, NOW);
  assert.equal(r.status, 'error');
  assert.match(r.note, /PDF saved.*Gmail connector is not connected/);
  assert.ok(r.pdfPath);
  r = await deliverBriefing(s, 'A', deps({ callTool: async () => ({ isError: true, content: [{ text: 'quota' }] }) }).deps, NOW);
  assert.match(r.note, /PDF saved, draft failed: quota/);
  r = await deliverBriefing(s, 'A', deps({ callTool: async () => { throw new Error('offline'); } }).deps, NOW);
  assert.match(r.note, /draft failed: offline/);
});

test('the app runs a briefing through one function (due and by hand), and the list offers edit and run now', () => {
  const app = read('src/App.tsx');
  assert.match(app, /async function runSchedule\(due: Schedule, byHand = false\)/);
  assert.match(app, /if \(due\) void runSchedule\(due\)/);
  assert.match(app, /deliverBriefing\(due, draft\.current/);
  assert.match(app, /onRun: \(s\) => void runSchedule\(s, true\)/);
  const ui = read('src/ui/SchedulePopover.tsx');
  assert.match(ui, /aria-label="Email address for the draft"/);
  assert.match(ui, /Update briefing/);
  assert.match(ui, /title="Run now"/);
  assert.match(ui, /not sent|send it yourself/);
  const main = read('electron/main.mjs');
  assert.match(main, /ipcMain\.handle\('render-briefing-pdf'/);
  assert.match(main, /javascript: false/);
  assert.match(main, /join\(WORKSPACE, 'briefings'\)/);
  assert.match(read('electron/preload.cjs'), /renderBriefingPdf/);
});
