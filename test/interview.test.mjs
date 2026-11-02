import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DONE_THRESHOLD, SLOTS, coverage, detectSignals, fill, ingest, intentPrompt, mergeProposal, nextAction, openSlots,
  parseIntentProposal, parseModelOut, processSummary, requiredDone, sanitizeInterview, skip, startInterview, turnPrompt,
} from '../src/interview.ts';
import {
  GUARDRAILS, SYSTEMS, TRIGGERS, applyInterview, approve, emptyIntent, intentBlock, intentProblems, loadProjects, newProject,
  projectFiles, saveProjects, setInterview, upsertProject,
} from '../src/develop.ts';

const lists = { triggers: TRIGGERS, systems: SYSTEMS, guardrails: GUARDRAILS };
const U = (slot, text, confidence) => ({ slot, text, confidence });
const out = (o = {}) => ({ updates: [], supersedes: [], signals: [], handoffTo: '', confirmed: null, ...o });
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)) }; };

/* A simulated person: answers by (kind, slot). What the agent would extract is given with each answer. */
const SCRIPT = {
  'question:trigger': [['Yesterday an invoice came in by mail to the shared address.', out({ updates: [U('trigger', 'Invoice arrives by mail at the shared address', 0.9)] })]],
  'question:steps': [
    ['I save the PDF and create the document in SAP. Then I quickly check it against the order.', out({ updates: [U('steps', 'Save the PDF, create the document in SAP', 0.8), U('steps', 'Check the invoice against the order', 0.6)] })],
    ['Then I release the posting and hand it to accounting.', out({ updates: [U('steps', 'Release the posting', 0.8), U('steps', 'Hand over to accounting', 0.8)] })]],
  'followup:steps': [['I compare quantity and price with the order.', out({ updates: [U('decisions', 'Compare quantity and price with the order', 0.7)] })]],
  'question:decisions': [['Usually it fits. If it deviates by more than five percent I go to purchasing.', out({ updates: [U('handoffs', 'Deviations go to purchasing', 0.7), U('decisions', 'Deviation over 5 % goes to purchasing', 0.8)], handoffTo: 'Purchasing' })]],
  'followup:decisions': [['Then the goods receipt is missing, or the invoice is a duplicate.', out({ updates: [U('exceptions', 'Goods receipt missing, or duplicate invoice', 0.7)] })]],
  'question:exceptions': [
    ['A credit note without an order reference went differently.', out({ updates: [U('exceptions', 'Credit note without order reference', 0.8)] })],
    ['For foreign suppliers I need a second check.', out({ updates: [U('decisions', 'Foreign supplier needs a second check', 0.7)] })]],
  'question:result': [['When the status in SAP is posted, it is done.', out({ updates: [U('result', 'Done when the status in SAP is posted', 0.9)] })]],
  'question:inputs': [['The mail with the PDF, the order in SAP and the supplier master data.', out({ updates: [U('inputs', 'Mail PDF, order, supplier master data', 0.8)] })]],
  'question:handoffs': [['Accounting gets it through the SAP workflow.', out({ updates: [U('handoffs', 'Accounting via SAP workflow', 0.8)] })]],
  'question:volume': [['About 40 a day, ten minutes each.', out({ updates: [U('volume', 'About 40 a day, 10 minutes each', 0.9)] })]],
  'question:pain': [['Typing it in, and the duplicates.', out({ updates: [U('pain', 'Typing it in, duplicate invoices', 0.8)] })]],
  'question:automation': [['The check up to five percent could run without me.', out({ updates: [U('automation', 'Check up to 5 % could run without the person', 0.8)] })]],
  'closing:': [['I have to watch the discount deadlines.', out({ updates: [U('decisions', 'Watch the discount deadlines', 0.6)] })]],
};

function run(lang = 'en') {
  const queues = Object.fromEntries(Object.entries(SCRIPT).map(([k, v]) => [k, [...v]]));
  let iv = startInterview('Accounts payable', lang, 10, 1);
  const log = [];
  for (let n = 0; n < 60; n++) {
    const r = nextAction(iv);
    iv = r.iv;
    log.push(r.action);
    if (r.action.kind === 'done') break;
    if (r.action.kind === 'mirror') { iv = ingest(iv, out({ confirmed: true }), 'Yes, that is right.'); continue; }
    const key = `${r.action.kind}:${r.action.kind === 'closing' ? '' : r.action.slot}`;
    const [answer, model] = queues[key]?.shift() ?? ['Nothing more comes to mind.', out()];
    iv = ingest(iv, model, answer);
  }
  return { iv, log };
}

test('the interview starts with the last real case', () => {
  const { log } = run();
  assert.equal(log[0].kind, 'question');
  assert.equal(log[0].slot, 'trigger');
  assert.match(log[0].text, /last case/);
});

test('signal words call for one follow-up in the same slot', () => {
  const { log } = run();
  const texts = log.filter((a) => a.kind === 'followup').map((a) => a.text);
  assert.ok(texts.includes('What exactly do you look at, and how do you see that it is fine?'));
  assert.ok(texts.includes('When is it not like that?'));
  assert.deepEqual(detectSignals('It depends on the supplier, usually 5 %').slice(0, 3), ['depends', 'usually', 'threshold']);
  assert.deepEqual(detectSignals('Ich prüfe es meistens, kommt drauf an'), ['depends', 'usually']);
  assert.deepEqual(detectSignals('Plain answer without hedging'), []);
});

test('one answer queues at most one follow-up, and a slot is not probed more than twice', () => {
  let iv = nextAction(startInterview('A', 'en')).iv;
  iv = ingest(iv, out({ updates: [U('trigger', 'x', 0.9)] }), 'usually, sometimes, it depends, over 5 %');
  assert.equal(iv.followups.length, 1);
  for (let i = 0; i < 4; i++) { iv = { ...iv, pending: { kind: 'question', text: 'q', slot: 'trigger' } }; iv = ingest(iv, out({ updates: [U('trigger', 'y', 0.9)] }), 'it depends'); }
  assert.ok(iv.followups.length <= 2);
});

test('a summary comes after three answers; an open follow-up goes first', () => {
  const { log } = run();
  let answers = 0;
  let mirrors = 0;
  let prev = null;
  for (const a of log) {
    if (a.kind === 'mirror') {
      mirrors++;
      assert.ok(answers === 3 || (answers === 4 && prev === 'followup'), `mirror after ${answers} answers`);
      answers = 0;
    } else if (a.kind !== 'done') answers++;
    prev = a.kind;
  }
  assert.ok(mirrors >= 2);
});

test('the closing question is asked once and the interview ends after it', () => {
  const { iv, log } = run();
  const closings = log.filter((a) => a.kind === 'closing');
  assert.equal(closings.length, 1);
  assert.match(closings[0].text, /not asked/);
  assert.equal(log.at(-1).kind, 'done');
  assert.equal(iv.finished, true);
  const after = log.slice(log.indexOf(closings[0]) + 1);
  assert.ok(after.every((a) => a.kind === 'mirror' || a.kind === 'done'));
});

test('all required slots are covered at the end, no question is asked twice', () => {
  const { iv, log } = run();
  assert.equal(requiredDone(iv), true);
  for (const s of SLOTS.filter((d) => d.required)) assert.ok(fill(iv, s.key) >= DONE_THRESHOLD, s.key);
  const texts = log.filter((a) => ['question', 'followup', 'closing'].includes(a.kind)).map((a) => a.text);
  assert.equal(texts.length, new Set(texts).size);
});

test('the next main question goes where the weighted gap is biggest', () => {
  let iv = startInterview('A', 'en');
  iv = nextAction(iv).iv; // trigger question
  iv = ingest(iv, out({ updates: [U('trigger', 't', 0.9)] }), 'a mail');
  const r = nextAction(iv);
  assert.equal(r.action.slot, 'steps'); // weight 1.0, nothing yet; ties go to required slots
});

test('a confirmed summary makes entries more certain; a correction replaces and counts as certain', () => {
  let iv = startInterview('A', 'en');
  iv = nextAction(iv).iv;
  iv = ingest(iv, out({ updates: [U('steps', 'one', 0.6), U('steps', 'two', 0.6), U('steps', 'three', 0.6)] }), 'a b c');
  iv = { ...iv, pending: { kind: 'mirror', text: 'summary', slot: null } };
  const confirmed = ingest(iv, out({ confirmed: true }), 'yes');
  assert.deepEqual(confirmed.entries.map((e) => e.confidence), [0.8, 0.8, 0.8]);
  const corrected = ingest(iv, out({ supersedes: [2], updates: [U('steps', 'two, but only on Mondays', 0.6)] }), 'no, only on Mondays');
  assert.deepEqual(corrected.entries.map((e) => e.text), ['one', 'three', 'two, but only on Mondays']);
  assert.equal(corrected.entries.at(-1).confidence, 1);
});

test('a handover names the next person to interview, once', () => {
  const { iv } = run();
  assert.deepEqual(iv.handoffs, ['Purchasing']);
  const again = ingest({ ...iv, pending: null }, out({ handoffTo: 'purchasing' }), 'x');
  assert.deepEqual(again.handoffs, ['Purchasing']);
});

test('German questions come out in German', () => {
  const { log } = run('de');
  assert.match(log[0].text, /letzten Fall/);
  assert.ok(log.some((a) => a.kind === 'mirror' && /Stimmt das so\?/.test(a.text)));
  assert.match(log.at(-1).text, /^Danke/);
});

test('skipping a question adds nothing', () => {
  let iv = nextAction(startInterview('A', 'en')).iv;
  const before = iv.entries.length;
  iv = skip(iv);
  assert.equal(iv.entries.length, before);
  assert.equal(iv.pending, null);
  assert.equal(iv.sinceMirror, 0);
});

test('the pending question survives a reload and is not asked twice', () => {
  const r = nextAction(startInterview('A', 'en'));
  const restored = sanitizeInterview(JSON.parse(JSON.stringify(r.iv)));
  assert.deepEqual(restored.pending, r.action);
  assert.equal(restored.mainQuestions, 1);
});

/* ---- reading the agent's answers ---- */

test('the agent answer is read from a fence or from bare JSON, and bad values are dropped', () => {
  const body = { updates: [{ slot: 'steps', text: ' Check the order ', confidence: 5 }, { slot: 'nonsense', text: 'x' }, { slot: 'steps', text: '' }], supersedes: [2, 'a', 1.5], signals: ['depends', 'bogus'], handoff_to: 'Purchasing', confirmed: true };
  for (const text of ['```json\n' + JSON.stringify(body) + '\n```', 'Here you go: ' + JSON.stringify(body) + ' Done.']) {
    const m = parseModelOut(text);
    assert.deepEqual(m.updates, [{ slot: 'steps', text: 'Check the order', confidence: 1 }]);
    assert.deepEqual(m.supersedes, [2]);
    assert.deepEqual(m.signals, ['depends']);
    assert.equal(m.handoffTo, 'Purchasing');
    assert.equal(m.confirmed, true);
  }
  assert.equal(parseModelOut('I could not do that.'), null);
  assert.equal(parseModelOut('```json\n[1,2]\n```'), null);
  assert.equal(parseModelOut('{"updates": "no"}').updates.length, 0);
});

test('the turn prompt carries the model, the question and the answer, and forbids names and invention', () => {
  const { iv } = run();
  const p = turnPrompt({ ...iv, pending: { kind: 'question', text: 'What do you do next?', slot: 'steps' } }, 'I open SAP.');
  assert.match(p, /\[1\] trigger: Invoice arrives by mail/);
  assert.match(p, /Question: What do you do next\?/);
  assert.match(p, /Answer of the person: I open SAP\./);
  assert.match(p, /never invent/);
  assert.match(p, /Replace persons by roles/);
  assert.match(p, /Role of the person\nAccounts payable/);
});

/* ---- from the interview to the form ---- */

test('the proposal is checked against the lists of the form', () => {
  const text = '```json\n' + JSON.stringify({ name: 'Invoice check', goal: 'Check invoices against orders.', trigger: 'on a schedule', systems: ['sap s/4hana', 'Our DMS', 'E-mail'], otherSystems: 'Scanner', data: 'Invoice in, posting out', guardrail: 'Do whatever', success: '', stakeholders: 'Accounts payable', outOfScope: '', extra: 'Mail the owner' }) + '\n```';
  const p = parseIntentProposal(text, lists);
  assert.equal(p.trigger, 'On a schedule');
  assert.deepEqual(p.systems, ['SAP S/4HANA', 'E-mail']);
  assert.equal(p.otherSystems, 'Scanner, Our DMS');
  assert.equal(p.guardrail, undefined);
  assert.equal(parseIntentProposal('no json', lists), null);
});

test('the form keeps what the person typed and takes the rest from the interview', () => {
  const current = { ...emptyIntent(), goal: 'My own goal sentence for this.', systems: ['E-mail'] };
  const patch = mergeProposal(current, { name: 'Invoice check', goal: 'Another goal', systems: ['SAP S/4HANA'], trigger: 'On a schedule', guardrail: GUARDRAILS[0], data: 'In and out' });
  assert.equal(patch.goal, 'My own goal sentence for this.');
  assert.equal(patch.name, 'Invoice check');
  assert.deepEqual(patch.systems, ['E-mail', 'SAP S/4HANA']);
  assert.equal(patch.trigger, 'On a schedule');
  assert.equal(patch.guardrail, GUARDRAILS[0]);
});

test('the intent prompt gives the allowed values and says not to invent', () => {
  const { iv } = run();
  const p = intentPrompt(iv, 'workflow', 'Check invoices', lists);
  assert.match(p, /Check invoices/);
  assert.match(p, /"On a schedule"/);
  assert.match(p, /"SAP S\/4HANA"/);
  assert.match(p, /Do not invent/);
  assert.match(p, /Watch the discount deadlines/);
});

test('the process summary lists the entries, what is not covered and who to interview next', () => {
  const { iv } = run();
  const s = processSummary(iv);
  assert.match(s, /Steps:\n- Save the PDF/);
  assert.match(s, /Decisions and rules:/);
  assert.match(s, /Hands over to \(not yet interviewed\): Purchasing/);
  assert.match(s, /Source: one interview with the role "Accounts payable"/);
  // The interview ends once the required slots are covered: the optional ones stay open and are reported as such.
  assert.deepEqual(openSlots(iv), ['volume']);
  assert.match(s, /Not covered in the interview: Volume and rhythm\./);
  assert.ok(coverage(iv).every((c) => c.fill >= 0 && c.fill <= 1));
  assert.match(processSummary(nextAction(startInterview('X', 'en')).iv), /Not covered in the interview: .*Steps \(needed\).*Automation potential \(needed\)/);
});

/* ---- in the project ---- */

test('a finished interview fills the form, carries the process into every prompt and takes approvals back', () => {
  const { iv } = run();
  let p = newProject('workflow', 5);
  p.intent = { ...emptyIntent(), goal: 'Check invoices against orders.' };
  p = approve(p, 'intent');
  const next = applyInterview(p, iv, { name: 'Invoice check', systems: ['SAP S/4HANA'], data: 'Invoice in, posting out', success: 'No duplicate is posted' }, 9);
  assert.deepEqual(next.approved, []);
  assert.deepEqual(intentProblems(next.intent), []);
  assert.match(next.intent.process, /Steps:/);
  assert.match(intentBlock('workflow', next.intent), /Process as described by the person in an interview[^\n]*\nTrigger:\n- Invoice arrives by mail[\s\S]*Steps:\n- Save the PDF/);
  assert.equal(intentBlock('workflow', emptyIntent()).includes('interview'), false);
  assert.match(projectFiles(next).find((f) => f.path.endsWith('intent.md')).text, /Watch the discount deadlines/);
});

test('saving the state of a running interview does not touch the approvals', () => {
  const { iv } = run();
  let p = approve(newProject('workflow', 5), 'intent');
  p = setInterview(p, iv, 7);
  assert.deepEqual(p.approved, ['intent']);
  assert.equal(p.interview.entries.length, iv.entries.length);
});

test('the interview survives storing and loading, as entries only: no transcript, no name', () => {
  const { iv } = run();
  const store = mem();
  let p = setInterview(newProject('workflow', 5), iv, 7);
  p.intent.process = processSummary(iv);
  assert.equal(saveProjects(store, upsertProject([], p)), true);
  const raw = store.getItem('werkbank.develop.projects');
  assert.doesNotMatch(raw, /Yesterday an invoice came in|Yes, that is right|quote|transcript|messages/);
  const [back] = loadProjects(store);
  assert.deepEqual(back.interview.entries, iv.entries);
  assert.equal(back.interview.role, 'Accounts payable');
  assert.equal(back.intent.process, p.intent.process);
  assert.deepEqual(back.interview.handoffs, ['Purchasing']);
});

test('a broken stored interview is dropped instead of breaking the project', () => {
  const store = mem();
  const p = JSON.parse(JSON.stringify(newProject('workflow', 5)));
  p.interview = { role: 5, entries: [{ slot: 'nope', text: 'x' }, 'junk'], pending: { kind: 'bogus', text: 'x' }, asked: { steps: -3, trigger: 'a' } };
  store.setItem('werkbank.develop.projects', JSON.stringify([p]));
  const [back] = loadProjects(store);
  assert.equal(back.interview.entries.length, 0);
  assert.equal(back.interview.pending, null);
  assert.deepEqual(back.interview.asked, {});
  store.setItem('werkbank.develop.projects', JSON.stringify([{ ...p, interview: 'x' }]));
  assert.equal(loadProjects(store)[0].interview, undefined);
});
