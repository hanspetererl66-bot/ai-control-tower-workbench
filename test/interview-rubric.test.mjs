import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeLogic } from '../connectors/_lib/server/recruiting-logic.mjs';
import { handleInterviewMessage, MAX_PROMPT } from '../src/interview-bridge.ts';

const ROOT = join(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/recruiting-workbench/data.json'), 'utf8'));
const L = makeLogic(data);
const pm = L.profileById('product-manager');
const dev = L.profileById('developer');
const DIMS = ['content', 'collab', 'rhetoric', 'creativity'];

const answersFor = (profile, text = 'In my last role I wrote the plan down, checked it with both teams and changed it after the first release.') =>
  Object.fromEntries(profile.questions.map((q) => [q.id, '(' + q.id + ') ' + text]));

/** A well-formed model answer that quotes a real answer for every dimension. */
function goodModel(profile, answers, over = {}) {
  return JSON.stringify({
    dimensions: DIMS.map((key) => {
      const q = profile.questions.find((x) => x.dim === key);
      return { key, level: 3, question: q.id, quote: answers[q.id].slice(0, 60), reason: 'Gives one concrete example and names the own part in it.', ...(over[key] || {}) };
    }),
  });
}

test('both profiles have ten questions in the 3/3/2/2 split, with unique ids', () => {
  for (const p of [pm, dev]) {
    assert.equal(p.questions.length, 10);
    assert.equal(new Set(p.questions.map((q) => q.id)).size, 10);
    const count = Object.fromEntries(DIMS.map((k) => [k, p.questions.filter((q) => q.dim === k).length]));
    assert.deepEqual(count, { content: 3, collab: 3, rhetoric: 2, creativity: 2 });
    for (const q of p.questions) assert.ok(q.text.length > 30 && q.lookFor.length >= 2, q.id);
  }
});

test('the rubric has four dimensions with five anchors each, equal weights and five named levels', () => {
  const r = L.rubric();
  assert.deepEqual(r.dimensions.map((d) => d.key), DIMS);
  assert.deepEqual(r.levels.map((l) => l.level), [1, 2, 3, 4, 5]);
  for (const d of r.dimensions) {
    assert.deepEqual(Object.keys(d.anchors), ['1', '2', '3', '4', '5']);
    assert.equal(d.weight, 1);
  }
  assert.equal(r.dimensions[1].label, 'Collaboration & reflection');
});

test('the prompt carries the rubric and the answers, and fits the bridge limit even with full answers', () => {
  const full = answersFor(pm, 'x'.repeat(1200));
  const prompt = L.assessmentPrompt(pm, full);
  assert.match(prompt, /^You rate one interview against a fixed rubric\./);
  assert.match(prompt, /1 = No concrete case/);
  assert.match(prompt, /Do not infer personality traits/);
  assert.ok(prompt.length < MAX_PROMPT, 'prompt length ' + prompt.length);
});

test('a good answer is read into four rated rows, each with a quote found in an answer', () => {
  const answers = answersFor(pm);
  const r = L.parseAssessment(pm, goodModel(pm, answers), answers);
  assert.equal(r.ok, true, r.problems.join(' '));
  assert.deepEqual(r.rows.map((x) => x.key), DIMS);
  for (const row of r.rows) {
    assert.equal(row.status, 'rated');
    assert.equal(row.level, 3);
    assert.equal(row.levelName, 'Solid');
    assert.ok(answers[row.question].includes(row.quote));
  }
  assert.equal(L.overall(r.rows), 3);
});

test('a level without a real quote is not kept; nothing is invented', () => {
  const answers = answersFor(pm);
  const r = L.parseAssessment(pm, goodModel(pm, answers, { rhetoric: { quote: 'a sentence nobody ever said in this interview' } }), answers);
  assert.equal(r.ok, false);
  const row = r.rows.find((x) => x.key === 'rhetoric');
  assert.equal(row.level, null);
  assert.equal(row.status, 'no-evidence');
  assert.equal(L.overall(r.rows), null);
});

test('a quote from the wrong dimension does not count', () => {
  const answers = answersFor(pm);
  const other = pm.questions.find((q) => q.dim === 'content');
  const r = L.parseAssessment(pm, goodModel(pm, answers, { creativity: { question: other.id, quote: answers[other.id].slice(0, 60) } }), answers);
  assert.equal(r.rows.find((x) => x.key === 'creativity').status, 'no-evidence');
});

test('bad levels, decision language, traits and addresses are refused', () => {
  const answers = answersFor(dev);
  for (const [over, re] of [
    [{ content: { level: 6 } }, /whole number/],
    [{ content: { level: 2.5 } }, /whole number/],
    [{ content: { level: '4' } }, /whole number/],
    [{ collab: { reason: 'We recommend this person and would rank them first.' } }, /uses "/],
    [{ collab: { reason: 'The person seems nervous and speaks with an accent.' } }, /uses "/],
    [{ creativity: { reason: 'Write to anna.k@example.com for the full notes on this.' } }, /e-mail address/],
    [{ rhetoric: { reason: 'Short' } }, /wrong length/],
  ]) {
    const r = L.parseAssessment(dev, goodModel(dev, answers, over), answers);
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.match(r.problems.join(' '), re);
    assert.ok(r.rows.some((x) => x.level === null && x.status !== 'rated'));
  }
  assert.equal(L.parseAssessment(dev, 'not json', answers).ok, false);
  assert.equal(L.parseAssessment(dev, JSON.stringify({ dimensions: [] }), answers).ok, false);
});

test('a dimension with no answer is "no-answer" and stays unrated even if the model returns a level', () => {
  const answers = answersFor(pm);
  for (const q of pm.questions.filter((x) => x.dim === 'creativity')) delete answers[q.id];
  const r = L.parseAssessment(pm, goodModel(pm, answersFor(pm)), answers);
  const row = r.rows.find((x) => x.key === 'creativity');
  assert.equal(row.status, 'no-answer');
  assert.equal(row.level, null);
  assert.equal(L.overall(r.rows), null, 'no guessed average');
});

test('the fallback holds no level at all', () => {
  const rows = L.assessmentFallback(pm, answersFor(pm));
  assert.ok(rows.every((x) => x.level === null && x.status === 'unrated'));
});

test('the hiring manager sets the final level; it wins over the AI and equal weights give the mean', () => {
  const answers = answersFor(pm);
  const ai = L.parseAssessment(pm, goodModel(pm, answers), answers).rows;
  const rev = L.applyReview(ai, { content: { level: 5, note: 'Clear numbers in the first answer.' }, rhetoric: { level: 2 } }, 'hm@example.com');
  assert.equal(rev.ok, true);
  assert.equal(L.finalLevel(rev.rows.find((x) => x.key === 'content')), 5);
  assert.equal(L.finalLevel(rev.rows.find((x) => x.key === 'collab')), 3, 'unedited rows keep the AI level');
  assert.equal(L.overall(rev.rows, true), 3.3, '(5+3+2+3)/4 = 3.25, shown with one decimal');
  assert.equal(L.overall(ai, false), 3, 'the AI-only mean is not changed');
  assert.equal(rev.rows[0].reviewedBy, 'hm@example.com');
  assert.equal(L.applyReview(ai, { content: { level: 7 } }, 'x').ok, false);
  assert.equal(L.applyReview(ai, { content: { level: 0 } }, 'x').ok, false);
});

test('an unrated row needs the hiring manager before the review is complete', () => {
  const rows = L.assessmentFallback(pm, answersFor(pm));
  assert.equal(L.applyReview(rows, {}, 'x').complete, false);
  const edits = Object.fromEntries(DIMS.map((k) => [k, { level: 3 }]));
  assert.equal(L.applyReview(rows, edits, 'x').complete, true);
});

test('the record keeps no address, and the note is cleaned', () => {
  const answers = { ...answersFor(pm), pm1: 'Mail me at anna.k@example.com about the launch we shipped last year.' };
  const rev = L.applyReview(L.assessmentFallback(pm, answers), { content: { level: 4, note: 'See bob@example.com' } }, 'x');
  const rec = L.assessmentRecord(pm, 'REQ-2203', 'IV-ABC234', 'ai', '', answers, rev.rows);
  assert.equal(JSON.stringify(rec).includes('@example.com'), false);
  assert.equal(rec.levels.find((x) => x.key === 'content').human, 4);
  assert.equal(rec.rubric, '1');
});

test('the thank-you line is checked, and the mail carries no level or score', () => {
  const answers = answersFor(pm);
  const ok = L.parseThanks(JSON.stringify({ topic: 'We enjoyed hearing how you decided which onboarding features to stop building.' }));
  assert.equal(ok.ok, true, ok.problems.join(' '));
  for (const bad of ['We think you are a strong candidate and would recommend an offer soon.', 'We liked your answer, you sounded nervous but smart and quick.', 'Write to anna.k@example.com about the feature decisions you described.', 'Nice.']) {
    assert.equal(L.parseThanks(JSON.stringify({ topic: bad })).ok, false, bad);
  }
  assert.match(L.thanksPrompt(pm, answers), /^Write one short sentence for a thank-you e-mail after a job interview\./);
  const mail = L.assembleThanks(ok.text, pm, { firstName: 'Sam', manager: 'Lena Fischer', company: 'Rheinsoft Solutions', replyBy: '20 November' });
  assert.match(mail, /^Hi Sam,/);
  assert.match(mail, /Product Manager role at Rheinsoft Solutions/);
  assert.match(mail, /get back to you by 20 November/);
  assert.match(mail, /no decision is made by the AI alone/);
  assert.equal(/Solid|Strong|Outstanding|Emerging|Not yet visible|level/i.test(mail), false);
  const plain = L.assembleThanks(L.thanksFallback(), dev, {});
  assert.match(plain, /^Hi there,/);
  assert.match(plain, /the hiring manager will review the conversation and get back to you\./);
  assert.equal(/\d{1,2} (November|December)/.test(plain), false, 'no date is promised when none was given');
});

test('the feedback mail needs a final level for every answered dimension, and shows quote only for the unchanged AI level', () => {
  const answers = answersFor(pm);
  const ai = L.parseAssessment(pm, goodModel(pm, answers), answers).rows;
  const unfinished = L.feedbackMail(pm, L.assessmentFallback(pm, answers), {});
  assert.equal(unfinished.ok, false);
  const rev = L.applyReview(ai, { content: { level: 5, note: 'Clear numbers in the first answer.' } }, 'hm@example.com');
  const mail = L.feedbackMail(pm, rev.rows, { firstName: 'Sam', manager: 'Lena Fischer', company: 'Rheinsoft Solutions' });
  assert.equal(mail.ok, true);
  assert.match(mail.text, /Content: Outstanding\. Clear numbers in the first answer\./);
  assert.match(mail.text, /Collaboration & reflection: Solid\. Gives one concrete example/);
  assert.match(mail.text, /You said: "/);
  assert.equal(mail.text.match(/You said: "/g).length, 3, 'the changed row shows no AI quote');
  assert.match(mail.text, /is not the decision on your application/);
  assert.equal(/average|mean|overall|total/i.test(mail.text), false, 'no single number in the mail');
});

test('the bridge lets the two new prompts through and nothing else', async () => {
  const seen = [];
  const deps = { ask: async (prompt, title, session) => { seen.push([title, session]); return '{}'; } };
  const answers = answersFor(pm);
  const base = { type: 'iv:ask-request', requestId: 'r1', session: 'IV-ABC234' };
  const a = await handleInterviewMessage({ ...base, kind: 'assess', prompt: L.assessmentPrompt(pm, answers) }, deps);
  assert.equal(a.type, 'iv:ask-answer');
  const t = await handleInterviewMessage({ ...base, kind: 'thanks', prompt: L.thanksPrompt(pm, answers) }, deps);
  assert.equal(t.type, 'iv:ask-answer');
  assert.deepEqual(seen.map((x) => x[0]), ['Interview: rubric levels', 'Interview: thank-you line']);
  assert.equal((await handleInterviewMessage({ ...base, kind: 'assess', prompt: L.thanksPrompt(pm, answers) }, deps)).type, 'iv:error');
  assert.equal((await handleInterviewMessage({ ...base, kind: 'assess', prompt: 'Tell me a joke.' }, deps)).type, 'iv:error');
  assert.equal((await handleInterviewMessage({ ...base, kind: 'assess', prompt: L.assessmentPrompt(pm, answers) + 'y'.repeat(MAX_PROMPT) }, deps)).type, 'iv:error');
});
