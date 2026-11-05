import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BATCH, MAX_LOG, appendEntry, entryOf, filterLog, fromDatabase, loadLog, markSent, mergeSources, pending, sanitizeLog, saveLog, summarize, toCsv, toRecord } from '../src/job-log.ts';

const src = (f) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');
const job = { id: 'job-1', name: 'Pre-close check', target: { type: 'agent', id: 'a-1', label: 'Pre-close agent' } };
const run = (id, at, extra = {}) => ({ id, at, ms: 2500, status: 'ok', trigger: 'schedule', note: 'Answer shown in the chat.', ...extra });
const NOW = Date.parse('2026-11-05T12:00:00Z');

test('an entry carries job name and target, so it stays readable after the job is deleted', () => {
  const e = entryOf(job, run('r1', '2026-11-05T08:00:00Z'));
  assert.deepEqual([e.jobId, e.jobName, e.targetType, e.targetLabel, e.status, e.trigger], ['job-1', 'Pre-close check', 'agent', 'Pre-close agent', 'ok', 'schedule']);
});

test('append keeps newest first, ignores a known id and is capped', () => {
  let log = [];
  log = appendEntry(log, entryOf(job, run('r1', '2026-11-05T08:00:00Z')));
  log = appendEntry(log, entryOf(job, run('r2', '2026-11-05T09:00:00Z')));
  assert.deepEqual(log.map((e) => e.id), ['r2', 'r1']);
  assert.equal(appendEntry(log, entryOf(job, run('r1', '2026-11-05T10:00:00Z'))), log, 'same id: unchanged');
  let big = [];
  for (let i = 0; i < MAX_LOG + 5; i++) big = appendEntry(big, entryOf(job, run(`x${i}`, new Date(NOW + i * 1000).toISOString())));
  assert.equal(big.length, MAX_LOG);
  assert.equal(big[0].id, `x${MAX_LOG + 4}`);
});

test('what localStorage returns is checked: malformed entries and duplicates are dropped', () => {
  const good = entryOf(job, run('r1', '2026-11-05T08:00:00Z'));
  const out = sanitizeLog([good, good, { ...good, id: 'r2', status: 'weird' }, { ...good, id: 'r3', at: 'nope' }, { ...good, id: 'r4', targetType: 'x' }, null, 'x', { ...good, id: 'r5', jobName: '  a\u0000b  ', ms: -4 }]);
  assert.deepEqual(out.map((e) => e.id).sort(), ['r1', 'r5']);
  assert.equal(out.find((e) => e.id === 'r5').jobName, 'a b');
  assert.equal(out.find((e) => e.id === 'r5').ms, 0);
  assert.deepEqual(sanitizeLog('nonsense'), []);
  const mem = {}; const store = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  saveLog([good], store);
  assert.deepEqual(loadLog(store).map((e) => e.id), ['r1']);
  assert.deepEqual(loadLog({ getItem: () => '{broken' }), []);
});

test('sending: oldest unsent first, at most one batch, marked after success, and without who or sent', () => {
  let log = [];
  for (let i = 0; i < BATCH + 10; i++) log = appendEntry(log, entryOf(job, run(`r${i}`, new Date(NOW - i * 60_000).toISOString())));
  const first = pending(log);
  assert.equal(first.length, BATCH);
  assert.equal(first[0].id, `r${BATCH + 9}`, 'the oldest goes first');
  log = markSent(log, first.map((e) => e.id));
  assert.equal(pending(log).length, 10);
  assert.deepEqual(Object.keys(toRecord({ ...first[0], who: 'a@b.co', sent: true })).sort(), ['at', 'id', 'jobId', 'jobName', 'ms', 'note', 'status', 'targetLabel', 'targetType', 'trigger']);
});

test('merging: the database wins for what it knows, unsent local entries are added with my e-mail', () => {
  const l1 = entryOf(job, run('r1', '2026-11-05T08:00:00Z')), l2 = entryOf(job, run('r2', '2026-11-05T09:00:00Z'));
  const remote = fromDatabase([{ ...l1, who: 'anna@x.com' }, { ...l1, id: 'r9', who: 'ben@x.com', at: '2026-11-05T10:00:00Z', status: 'error' }]);
  const merged = mergeSources([l1, l2], remote, 'anna@x.com');
  assert.deepEqual(merged.map((e) => `${e.who}:${e.id}`), ['ben@x.com:r9', 'anna@x.com:r2', 'anna@x.com:r1']);
  assert.equal(merged.filter((e) => e.id === 'r1').length, 1, 'no double entry');
  assert.deepEqual(mergeSources([l1], [], '').map((e) => e.who), [undefined]);
});

test('filters combine: text, result, type, trigger, period and person', () => {
  const mk = (id, h, extra, j = job) => entryOf(j, run(id, new Date(NOW - h * 3600_000).toISOString(), extra));
  const wf = { id: 'job-2', name: 'Invoice reminder', target: { type: 'workflow', id: 'p', label: 'Reminder flow' } };
  const log = [mk('a', 1, {}), mk('b', 30, { status: 'error', note: 'No answer' }), mk('c', 200, { trigger: 'manual' }, wf), mk('d', 2, { status: 'error' }, wf)].map((e, i) => ({ ...e, who: i < 2 ? 'anna@x.com' : 'ben@x.com' }));
  assert.deepEqual(filterLog(log, { status: 'error' }, NOW).map((e) => e.id), ['b', 'd']);
  assert.deepEqual(filterLog(log, { status: 'error', days: 7 }, NOW).map((e) => e.id), ['b', 'd']);
  assert.deepEqual(filterLog(log, { days: 1 }, NOW).map((e) => e.id), ['a', 'd']);
  assert.deepEqual(filterLog(log, { text: 'REMINDER' }, NOW).map((e) => e.id), ['c', 'd']);
  assert.deepEqual(filterLog(log, { text: 'no answer' }, NOW).map((e) => e.id), ['b']);
  assert.deepEqual(filterLog(log, { type: 'workflow', trigger: 'manual' }, NOW).map((e) => e.id), ['c']);
  assert.deepEqual(filterLog(log, { who: 'BEN@x.com' }, NOW).map((e) => e.id), ['c', 'd']);
  assert.equal(filterLog(log, {}, NOW).length, 4);
});

test('summary: success rate ignores skipped runs; no runs means no rate', () => {
  const mk = (id, status, ms) => entryOf(job, run(id, `2026-11-05T0${id}:00:00Z`, { status, ms }));
  const s = summarize([mk('1', 'ok', 1000), mk('2', 'ok', 3000), mk('3', 'error', 2000), mk('4', 'skipped', 0)]);
  assert.deepEqual([s.runs, s.ok, s.error, s.skipped, s.jobs], [4, 2, 1, 1, 1]);
  assert.equal(Math.round(s.successRate * 100), 67);
  assert.equal(s.avgMs, 2000);
  assert.equal(s.lastFailure.id, '3');
  assert.equal(summarize([]).successRate, null);
  assert.equal(summarize([mk('4', 'skipped', 0)]).successRate, null);
});

test('CSV: header, escaping, and formulas are neutralised', () => {
  const e = entryOf({ ...job, name: '=HYPERLINK("x")' }, run('r1', '2026-11-05T08:00:00Z', { note: 'He said "no", then\nleft', ms: 1250 }));
  const csv = toCsv([{ ...e, who: 'anna@x.com' }]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Started,Job,Type,Target,Result,Trigger,Duration (s),Who,Note');
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"He said ""no"", then left"/, 'quotes doubled, line break already collapsed by entryOf');
  assert.match(toCsv([{ ...e, note: 'a\nb' }]), /"a\nb"/, 'a line break in a cell stays inside quotes');
  assert.match(csv, /,1\.3,anna@x\.com,/);
  assert.equal(toCsv([]), 'Started,Job,Type,Target,Result,Trigger,Duration (s),Who,Note\r\n');
});

test('wiring: real runs are logged, sample runs are not, and the log is sent from the main process only', () => {
  const app = src('src/App.tsx');
  assert.match(app, /logRun\(job, run\)/);
  assert.match(app, /if \(job\.example\) return;/, 'sample jobs are never logged');
  const exampleBranch = app.slice(app.indexOf('if (job.example) {'), app.indexOf('if (!agent || busy || runningSchedule || runningJob) return;'));
  assert.doesNotMatch(exampleBranch, /logRun/);
  const preload = src('electron/preload.cjs');
  assert.match(preload, /jobRunsRecord/); assert.match(preload, /jobRunsList/);
  assert.doesNotMatch(src('electron/work-store.mjs').slice(0, src('electron/work-store.mjs').indexOf('export function createWorkStore')), /ALLOWED_TOOLS = new Set\([^)]*JOB_RUN/, 'the generic work call does not reach the run log');
});
