import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PROBES, ingest, interviewMarkdown, interviewMermaid, logTurns, nextAction, parseModelOut, playbackText, purgeExpired, purgeLog,
  sanitizeInterview, similarity, startInterview,
} from '../src/interview.ts';
import { NOTICE, redact, retentionLabel, isExpired } from '../src/interview-privacy.ts';
import { agendaFor, priorNote, synthesisMarkdown, synthesisSummary, synthesize } from '../src/interview-synthesis.ts';

const NOW = Date.UTC(2026, 10, 4);
const S = (id, text, o = {}) => ({ id, text, actor: '', system: '', input: '', output: '', decision: '', exception: '', evidence: '', confidence: 0.8, ...o });
const out = (o = {}) => ({ updates: [], supersedes: [], signals: [], handoffTo: '', confirmed: null, steps: [], removeSteps: [], ...o });
const M = (o) => ({ id: 0, text: '', actor: '', system: '', input: '', output: '', decision: '', exception: '', evidence: '', confidence: 0.7, position: 0, ...o });
const withSteps = (role, steps, extra = {}) => ({ ...startInterview(role, 'en', 10, NOW), steps, nextStepId: steps.length + 1, ...extra });

test('similarity: identical 1, unrelated 0, partial in between', () => {
  assert.equal(similarity('check the invoice', 'check the invoice'), 1);
  assert.equal(similarity('check invoice', 'ship parcel'), 0);
  const s = similarity('check the invoice against the order', 'check invoice against payment');
  assert.ok(s > 0.5 && s < 1);
});

test('ingest: steps are added, a similar step is merged instead of duplicated, remove_steps removes', () => {
  let iv = startInterview('AP clerk', 'en', 10, NOW);
  iv = ingest(iv, out({ steps: [M({ text: 'Check the invoice against the order', system: 'SAP' })] }), 'I check it in SAP');
  assert.equal(iv.steps.length, 1);
  iv = ingest(iv, out({ steps: [M({ text: 'Check the invoice against the order', actor: 'AP clerk', confidence: 0.9 })] }), 'me');
  assert.equal(iv.steps.length, 1);
  assert.equal(iv.steps[0].system, 'SAP');
  assert.equal(iv.steps[0].actor, 'AP clerk');
  iv = ingest(iv, out({ removeSteps: [iv.steps[0].id] }), 'no');
  assert.equal(iv.steps.length, 0);
});

test('probes: at most MAX_PROBES, one per field, none before required slots are done', () => {
  let iv = withSteps('AP clerk', [S(1, 'Check invoice'), S(2, 'Post invoice'), S(3, 'Mail supplier')]);
  assert.notEqual(nextAction(iv).action.kind, 'probe');
  assert.ok(MAX_PROBES >= 1);
});

test('playback text lists steps in order, in both languages', () => {
  const iv = withSteps('AP clerk', [S(1, 'Save the PDF'), S(2, 'Create the document'), S(3, 'Release the posting')]);
  const en = playbackText(iv);
  assert.ok(en.indexOf('Save the PDF') < en.indexOf('Create the document'));
  assert.ok(en.indexOf('Create the document') < en.indexOf('Release the posting'));
  assert.match(playbackText({ ...iv, lang: 'de' }), /Save the PDF/);
});

test('mermaid: flowchart with every step, special characters do not break it', () => {
  const iv = withSteps('AP clerk', [S(1, 'Check "invoice" [draft]', { system: 'SAP' }), S(2, 'Post it')]);
  const m = interviewMermaid(iv);
  assert.match(m, /^flowchart/);
  assert.ok(!m.includes('"invoice"'));
  assert.match(m, /Post it/);
});

test('parseModelOut reads steps and remove_steps, ignores junk', () => {
  const p = parseModelOut('{"updates":[],"steps":[{"text":"Check","system":"SAP","confidence":0.8},{"nope":1}],"remove_steps":[2,"x"]}');
  assert.ok(p);
  assert.equal(p.steps.length, 1);
  assert.deepEqual(p.removeSteps, [2]);
});

test('redact: mail, IBAN, phone, titled names, self-introduction; ordinary text stays', () => {
  const r = redact('Mail anna.meier@firma.de, IBAN DE89 3704 0044 0532 0130 00, call +49 170 1234567, Frau Schneider said hi. Ich heiße Peter Müller.');
  assert.ok(!/anna\.meier|DE89|1234567|Schneider|Peter Müller/.test(r), r);
  assert.equal(redact('We post 40 invoices a day in SAP.'), 'We post 40 invoices a day in SAP.');
  assert.equal(redact('Order 4500001234 over 12 items'), 'Order 4500001234 over 12 items');
});

test('redaction on: log and steps are redacted when ingested; off: kept', () => {
  let on = startInterview('AP clerk', 'en', 10, NOW, { redact: true });
  on = logTurns(on, [{ who: 'person', text: 'Write to anna@firma.de', via: 'text' }], NOW);
  assert.ok(!on.transcript.some((t) => t.text.includes('anna@firma.de')));
  let off = startInterview('AP clerk', 'en', 10, NOW, { redact: false });
  off = logTurns(off, [{ who: 'person', text: 'Write to anna@firma.de', via: 'text' }], NOW);
  assert.ok(off.transcript.some((t) => t.text.includes('anna@firma.de')));
});

test('retention: expired logs are deleted on load, notes stay; 0 means keep', () => {
  assert.equal(isExpired(NOW - 91 * 864e5, 90, NOW), true);
  assert.equal(isExpired(NOW - 10 * 864e5, 90, NOW), false);
  assert.equal(isExpired(1, 0, NOW), false);
  let iv = startInterview('AP clerk', 'en', 10, NOW - 100 * 864e5, { retainDays: 90 });
  iv = logTurns(iv, [{ who: 'person', text: 'hello', via: 'text' }], NOW - 100 * 864e5);
  iv = ingest(iv, out({ updates: [{ slot: 'trigger', text: 'Mail arrives', confidence: 0.9 }] }), 'x');
  const kept = sanitizeInterview(JSON.parse(JSON.stringify(iv)), NOW);
  assert.equal(kept.transcript.length, 0);
  assert.ok(kept.purgedAt);
  assert.equal(kept.entries.length, 1);
  assert.match(interviewMarkdown(kept, NOW), /deleted|Mail arrives/);
});

test('purgeLog: removes the log on request and marks the time', () => {
  let iv = startInterview('AP clerk', 'en', 10, NOW);
  iv = logTurns(iv, [{ who: 'person', text: 'hello', via: 'text' }], NOW);
  const p = purgeLog(iv, NOW);
  assert.equal(p.transcript.length, 0);
  assert.equal(p.purgedAt, NOW);
  assert.equal(purgeExpired(startInterview('x', 'en', 10, NOW), NOW).purgedAt, 0);
});

test('markdown carries log line references and the data handling section', () => {
  let iv = startInterview('AP clerk', 'en', 10, NOW);
  iv = logTurns(iv, [{ who: 'interviewer', text: 'What starts it?' }, { who: 'person', text: 'A mail', via: 'voice' }], NOW);
  iv = ingest(iv, out({ updates: [{ slot: 'trigger', text: 'A mail arrives', confidence: 0.9 }], steps: [M({ text: 'Open the mail' }), M({ text: 'Save the PDF' })] }), 'A mail');
  const md = interviewMarkdown(iv, NOW);
  assert.match(md, /\[\d+\]/);
  assert.match(md, /\*\*\[\d+\] Answer \(spoken\):\*\*/);
  assert.match(md, /```mermaid/);
});

test('notice and retention labels exist in both languages', () => {
  assert.ok(NOTICE.en.length > 40 && NOTICE.de.length > 40);
  assert.ok(retentionLabel(30, 'de') && retentionLabel(0, 'en'));
});

/* ---------------- synthesis ---------------- */

const clerk = withSteps('AP clerk', [
  S(1, 'Check the invoice against the order', { system: 'SAP', actor: 'AP clerk', decision: 'Deviation over 5 % goes to purchasing' }),
  S(2, 'Post the invoice', { system: 'SAP' }),
], { handoffs: ['Purchasing', 'Accounting'] });
const buyer = withSteps('Purchasing', [
  S(1, 'Check the invoice against the order', { system: 'Excel list', actor: 'Buyer', decision: 'Always call the supplier first' }),
  S(2, 'Negotiate the price with the supplier'),
]);

test('synthesize: matches similar steps, finds system, rule and actor conflicts, single steps and open roles', () => {
  const syn = synthesize([clerk, buyer]);
  assert.equal(syn.roles.length, 2);
  const matched = syn.steps.find((m) => m.sources.length === 2);
  assert.ok(matched);
  assert.deepEqual(syn.conflicts.map((c) => c.kind).sort(), ['actor', 'rule', 'system']);
  assert.ok(syn.single.includes('Post the invoice'));
  assert.deepEqual(syn.open, ['Accounting']);
});

test('synthesize: one interview has no conflicts and no single steps', () => {
  const syn = synthesize([clerk]);
  assert.equal(syn.conflicts.length, 0);
  assert.equal(syn.single.length, 0);
});

test('agendaFor puts conflicts first, respects the limit; priorNote is short', () => {
  const syn = synthesize([clerk, buyer]);
  const a = agendaFor(syn, 2);
  assert.equal(a.length, 2);
  assert.match(a[0], /different|which|Welches|Nach welcher/i);
  assert.ok(priorNote(syn).length <= 1500);
});

test('synthesis outputs: markdown with table and caveat, summary names disagreements and open roles', () => {
  const syn = synthesize([clerk, buyer]);
  const md = synthesisMarkdown(syn);
  assert.match(md, /^# Process synthesis/);
  assert.match(md, /\| # \| Step/);
  assert.match(md, /similar wording/);
  const sum = synthesisSummary(syn);
  assert.match(sum, /Disagreements/);
  assert.match(sum, /Accounting/);
  assert.match(synthesisMarkdown({ ...syn, lang: 'de' }), /^# Prozess-Synthese/);
});

/* ---------------- project integration ---------------- */
import { allInterviews, archiveInterview, interviewFiles, newProject, nextInterviewSeed, projectSynthesis, sanitizeProject, setInterview, applyInterview, emptyIntent } from '../src/develop.ts';

test('project: archive moves the current interview, seed suggests an open role and agenda, files and synthesis follow', () => {
  let p = newProject('workflow', 'AP', NOW);
  p = setInterview(p, clerk, NOW);
  assert.equal(projectSynthesis(p), null);
  assert.equal(interviewFiles(p)[0].name, 'process-interview.md');
  p = archiveInterview(p, NOW);
  assert.equal(p.interview, undefined);
  assert.equal(p.interviews.length, 1);
  const seed = nextInterviewSeed(p);
  assert.equal(seed.role, 'Purchasing');
  p = setInterview(p, buyer, NOW);
  assert.equal(allInterviews(p).length, 2);
  const names = interviewFiles(p).map((f) => f.name);
  assert.deepEqual(names, ['process-interview-1-ap-clerk.md', 'process-interview-2-purchasing.md', 'process-synthesis.md']);
  const back = sanitizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(allInterviews(back).length, 2);
  const applied = applyInterview(p, buyer, {}, NOW);
  assert.match(applied.intent.process, /2 interviews/);
});
