import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeLogic } from '../connectors/_lib/server/recruiting-logic.mjs';
import { INTERVIEW_TOOL_DEFINITIONS, createInterviewHandlers, saveInterviewRecord } from '../connectors/_lib/server/interviews.mjs';
import { handleInterviewMessage, wrapPrompt } from '../src/interview-bridge.ts';

const ROOT = join(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/recruiting-workbench/data.json'), 'utf8'));
const L = makeLogic(data);
const JOB = 'REQ-2203';
const g = L.interviewGuide(JOB);
const job = L.job(JOB);
const rows = L.checkTask(g.task, g.task.sample);
const answers = Object.fromEntries(g.questions.map((q) => [q.id, 'I worked on this in my last role and wrote it down.']));

test('the summary is read strictly: plain JSON text, no decision language', () => {
  const ok = L.parseSummary(JSON.stringify({ summary: 'The person described a recent project, explained how they check data quality and then solved the task with a query that covered the main criteria.' }));
  assert.equal(ok.ok, true);
  for (const bad of ['The candidate is suitable and we recommend an offer for the role at hand.', 'Strong candidate, rank first overall, score high on the task and would be hired.']) {
    const r = L.parseSummary(JSON.stringify({ summary: bad }));
    assert.equal(r.ok, false, bad);
    assert.match(r.problems.join(' '), /decision language/);
  }
  assert.equal(L.parseSummary('no json').ok, false);
  assert.equal(L.parseSummary(JSON.stringify({ summary: 'short' })).ok, false);
});

test('the fallback summary only counts', () => {
  const t = L.summaryFallback(g, answers, rows);
  assert.match(t, /answered \d+ of \d+ questions/);
  assert.equal(/suitable|recommend|score|rank/i.test(t.replace('This text only counts', '')), false);
});

test('the letter parts are accepted only without results, decisions or addresses', () => {
  const good = { subject: 'Thank you for your time', opening: 'Thank you for talking with us today and for the care you put into the questions and the task. We enjoyed reading how you think.', closing: 'The hiring manager, a person, reads everything and decides. You can ask for a human conversation any time.' };
  assert.equal(L.parseLetter(JSON.stringify(good)).ok, true);
  assert.equal(L.parseLetter(JSON.stringify({ ...good, closing: 'Unfortunately we cannot offer you the job. The hiring manager decides in the end.' })).ok, false);
  assert.equal(L.parseLetter(JSON.stringify({ ...good, opening: good.opening + ' Write to anna.k@example.com.' })).ok, false);
  const fb = L.letterFallback(g, job, 'Acme');
  assert.equal(L.parseLetter(JSON.stringify(fb)).ok, true, 'the fixed text passes its own rules');
});

test('the letter shows the result from code, so a model cannot change a verdict', () => {
  const parts = L.letterFallback(g, job, 'Acme');
  const body = L.assembleLetter(parts, 'A short summary.', rows, 'Acme');
  for (const r of rows) assert.ok(body.includes('- ' + r.text + ': Correct'), r.text);
  assert.match(body, /not a score, nobody is ranked/);
  assert.match(body, /the hiring team at Acme/);
  const wrong = rows.map((r, i) => (i === 0 ? { ...r, verdict: 'wrong' } : r));
  assert.ok(L.assembleLetter(parts, 's', wrong, 'Acme').includes('- ' + wrong[0].text + ': Wrong'));
});

test('the prompts keep the work as data, ask for no score and start with the words the bridge expects', () => {
  assert.match(L.taskPrompt(g.task, 'x'), /^You check one task result against fixed criteria\./);
  assert.match(L.summaryPrompt(g, answers, rows), /^Write a short, neutral summary of an online interview/);
  assert.match(L.summaryPrompt(g, answers, rows), /<<<ANSWERS/);
  assert.match(L.letterPrompt(g, job, 'Acme'), /^Write two short paragraphs of a warm, personal thank-you letter/);
  assert.match(L.letterPrompt(g, job, 'Acme'), /Do NOT mention any result/);
});

test('the record holds no e-mail address, no letter and no name', () => {
  const dirty = { ...answers, [g.questions[0].id]: 'You can reach me at jane.doe@example.org any time.' };
  const rec = L.interviewRecord(g, JOB, 'IV-ABC234', 'ai', '', dirty, 'select 1 -- mail me: j@x.io', rows, 'Summary text.');
  const text = JSON.stringify(rec);
  assert.equal(/@/.test(text), false);
  assert.match(text, /address removed/);
  assert.equal(rec.session, 'IV-ABC234');
  assert.equal('letter' in rec, false);
  assert.equal(rec.counts.correct, rows.length);
});

test('the bridge lets only the three fixed requests through and refuses other prompts', async () => {
  const seen = [];
  const deps = {
    ask: async (prompt, title, session) => { seen.push({ prompt, title, session }); return '{"ok":1}'; },
    save: async (req, rec) => { seen.push({ req, rec }); return { saved: true, note: '' }; },
    draft: async (tool, args) => { seen.push({ tool, args }); return {}; },
  };
  const ask = (over) => handleInterviewMessage({ type: 'iv:ask-request', requestId: 'r1', kind: 'check', session: 'IV-ABC234', prompt: L.taskPrompt(g.task, 'x'), ...over }, deps);
  const a = await ask({});
  assert.equal(a.type, 'iv:ask-answer');
  assert.equal(seen[0].session, 'iv-IV-ABC234');
  assert.ok(seen[0].prompt.startsWith('Use no tools'));
  assert.equal(seen[0].prompt, wrapPrompt(L.taskPrompt(g.task, 'x')));
  assert.equal((await ask({ prompt: 'Tell me a joke' })).type, 'iv:error');
  assert.equal((await ask({ kind: 'summary' })).type, 'iv:error', 'a check prompt is not a summary prompt');
  assert.equal((await ask({ kind: 'chat' })).type, 'iv:error');
  assert.equal((await ask({ session: 'bad session' })).type, 'iv:error');
  assert.equal((await ask({ prompt: L.taskPrompt(g.task, 'x'.repeat(20000)) + 'y'.repeat(20000) })).type, 'iv:error');
  assert.equal(await handleInterviewMessage({ type: 'iv:ask-request', requestId: 'bad id!', kind: 'check' }, deps), null);
  assert.equal(await handleInterviewMessage({ type: 'sub4me:x', requestId: 'r' }, deps), null);

  const saved = await handleInterviewMessage({ type: 'iv:save-request', requestId: 'r2', requisition: JOB, record: { session: 'IV-ABC234' } }, deps);
  assert.equal(saved.type, 'iv:saved');
  assert.equal((await handleInterviewMessage({ type: 'iv:save-request', requestId: 'r2', requisition: 'drop table', record: {} }, deps)).type, 'iv:error');

  const letter = 'Dear candidate,\n\nThank you for your time with us today and for the task.\n';
  const d = await handleInterviewMessage({ type: 'iv:draft-request', requestId: 'r3', to: 'a@b.de', subject: 'Thanks', body: letter }, deps);
  assert.equal(d.type, 'iv:drafted');
  const call = seen.find((x) => x.tool);
  assert.equal(call.tool, 'create_draft', 'a draft only, never a send');
  assert.deepEqual(Object.keys(call.args).sort(), ['body', 'subject', 'to']);
  assert.equal((await handleInterviewMessage({ type: 'iv:draft-request', requestId: 'r4', to: 'not-an-address', subject: 'T', body: letter }, deps)).type, 'iv:error');
  assert.equal((await handleInterviewMessage({ type: 'iv:draft-request', requestId: 'r5', to: 'a@b.de', subject: 'T', body: letter }, {})).type, 'iv:error', 'without Gmail there is no draft');
  assert.equal((await handleInterviewMessage({ type: 'iv:ask-request', requestId: 'r6', kind: 'check', session: 'IV-ABC234', prompt: L.taskPrompt(g.task, 'x') }, {})).type, 'iv:error', 'without an agent there is no answer');
});

test('a stopped or failing model gives an error, never an empty answer', async () => {
  const mk = (ask) => handleInterviewMessage({ type: 'iv:ask-request', requestId: 'r1', kind: 'check', session: 'IV-ABC234', prompt: L.taskPrompt(g.task, 'x') }, { ask });
  assert.equal((await mk(async () => '')).type, 'iv:error');
  const r = await mk(async () => { throw new Error('The agent is still busy'); });
  assert.equal(r.type, 'iv:error');
  assert.match(r.message, /busy/);
});

test('the tool only reads; saving is a main-process function the agent cannot call', async () => {
  assert.deepEqual(INTERVIEW_TOOL_DEFINITIONS.map((t) => t.name), ['recruiting_interview_records']);
  const calls = [];
  const rpc = async (fn, body) => { calls.push({ fn, body }); return fn === 'recruiting_interview_records' ? [{ id: 1, requisition: JOB }] : { saved: true }; };
  const h = createInterviewHandlers(rpc);
  assert.deepEqual(Object.keys(h), ['recruiting_interview_records']);
  const out = await h.recruiting_interview_records({ actor: 'm@x.de', requisition: JOB });
  assert.equal(out.records.length, 1);
  assert.equal(calls[0].body.p_actor, 'm@x.de');

  const rec = L.interviewRecord(g, JOB, 'IV-ABC234', 'mock', 'no AI', answers, 'work', rows, 'S');
  await saveInterviewRecord(rpc, 'm@x.de', JOB, rec);
  assert.equal(calls.at(-1).fn, 'recruiting_interview_save');
  await assert.rejects(() => saveInterviewRecord(rpc, 'm@x.de', JOB, { ...rec, session: 'bad' }), /session code/);
  await assert.rejects(() => saveInterviewRecord(rpc, 'm@x.de', JOB, { ...rec, mode: 'human' }), /ai or mock/);
  await assert.rejects(() => saveInterviewRecord(rpc, 'm@x.de', JOB, { ...rec, summary: 'mail a@b.de' }), /e-mail address/);
});

test('the Space page uses the bridge with the three fixed requests and shows which check ran', () => {
  const html = readFileSync(join(ROOT, 'examples/recruiting-workbench/index.html'), 'utf8');
  for (const t of ['iv:ask-request', 'iv:save-request', 'iv:draft-request']) assert.ok(html.includes(t), t);
  assert.match(html, /Stand-in: text search, not an AI/);
  assert.match(html, /Checked by an AI/);
  assert.equal(/localStorage|fetch\(|XMLHttpRequest|WebSocket/.test(html), false, 'a Space has no network and no storage');
  const notice = data.interview.notice.points.join(' ');
  assert.match(notice, /OpenRouter/);
  assert.match(notice, /record/);
  assert.match(notice, /not stored/);
});
