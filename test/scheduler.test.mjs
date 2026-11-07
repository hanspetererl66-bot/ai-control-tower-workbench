import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BUILTIN_DIMS, UNASSIGNED, addRun, exampleJobs, groupJobs, groupStats, groupValue, groupValues, loadDims, mergeExamples, newDim, saveDims, withGroup, withoutDim, cadenceProblems, describeCadence, isDue, jobPrompt, jobState, newJob, nextRun, parseCron, sanitizeJobs, toCron, upcoming } from '../src/jobs.ts';

const src = (f) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');
const agent = { type: 'agent', id: 'a-1', label: 'Pre-close check' };
const wf = { type: 'workflow', id: 'p1', label: 'Invoice reminder' };
const at = (s) => new Date(s); // local time
const make = (cadence, target = agent, created = '2026-11-02T08:00:00') => newJob({ name: 'J', target, cadence }, at(created));

test('cron: lists, ranges, steps, and bad input', () => {
  assert.ok(parseCron('*/15 8-18 * * 1-5'));
  assert.ok(parseCron('0 9 1,15 * *'));
  assert.equal(parseCron('61 * * * *'), null);
  assert.equal(parseCron('* * * *'), null);
  assert.equal(parseCron('*/0 * * * *'), null);
  assert.equal(parseCron('0 9 * * 7')?.dow.has(0), true, '7 means Sunday');
});

test('daily, weekly and monthly are cron underneath', () => {
  assert.equal(toCron({ kind: 'daily', time: '07:45' }), '45 7 * * *');
  assert.equal(toCron({ kind: 'weekly', time: '07:45', days: [3, 1] }), '45 7 * * 1,3');
  assert.equal(toCron({ kind: 'monthly', time: '06:05', day: 15 }), '5 6 15 * *');
  assert.equal(toCron({ kind: 'once', at: '2026-11-03T09:00' }), null);
});

test('next run: daily, weekly (skips other weekdays), monthly, cron', () => {
  const now = at('2026-11-02T08:00:00'); // Monday
  assert.equal(nextRun(make({ kind: 'daily', time: '09:00' }), now).getHours(), 9);
  assert.equal(nextRun(make({ kind: 'daily', time: '07:00' }), now).getDate(), 3, 'today 07:00 has passed');
  assert.equal(nextRun(make({ kind: 'weekly', time: '09:00', days: [3] }), now).getDate(), 4, 'Wednesday');
  assert.equal(nextRun(make({ kind: 'monthly', time: '09:00', day: 1 }), now).getMonth(), 11);
  assert.equal(nextRun(make({ kind: 'cron', expr: '*/30 * * * *' }), now).getMinutes(), 30);
  assert.equal(nextRun(make({ kind: 'cron', expr: '0 9 31 2 *' }), now), null, '31 February never happens');
});

test('once: runs one time, then is done; the past is rejected', () => {
  const job = make({ kind: 'once', at: '2026-11-03T09:00' });
  assert.equal(isDue(job, at('2026-11-03T08:59:00')), false);
  assert.equal(isDue(job, at('2026-11-03T09:01:00')), true);
  assert.equal(isDue(job, at('2026-11-03T16:00:00')), false, 'older than the six-hour catch-up');
  assert.equal(jobState(job, at('2026-11-03T16:00:00')), 'missed');
  const ran = addRun(job, { id: 'r', at: '2026-11-03T09:01:00.000Z', ms: 10, status: 'ok', trigger: 'schedule', note: '' });
  assert.equal(isDue(ran, at('2026-11-03T09:02:00')), false);
  assert.equal(jobState(ran, at('2026-11-03T09:02:00')), 'done');
  assert.equal(nextRun(ran, at('2026-11-03T09:02:00')), null);
  assert.deepEqual(cadenceProblems({ kind: 'once', at: '2026-11-01T09:00' }, at('2026-11-02T08:00:00')), ['The time is in the past.']);
});

test('interval: due after the interval, measured from the last run; minimum 5 minutes', () => {
  const job = make({ kind: 'interval', every: 2, unit: 'hours' });
  assert.equal(isDue(job, at('2026-11-02T09:59:00')), false);
  assert.equal(isDue(job, at('2026-11-02T10:00:00')), true);
  const ran = { ...job, lastRun: at('2026-11-02T10:00:00').toISOString() };
  assert.equal(isDue(ran, at('2026-11-02T11:00:00')), false);
  assert.equal(nextRun(ran, at('2026-11-02T11:00:00')).getHours(), 12);
  assert.equal(cadenceProblems({ kind: 'interval', every: 3, unit: 'minutes' }, new Date()).length, 1);
  assert.equal(describeCadence({ kind: 'interval', every: 1, unit: 'days' }), 'every 1 day');
});

test('recurring: due once per planned time, catches up six hours, not before creation, paused never', () => {
  const job = make({ kind: 'daily', time: '09:00' });
  assert.equal(isDue(job, at('2026-11-02T08:30:00')), false, 'created at 08:00, the 09:00 run is still ahead');
  assert.equal(isDue(job, at('2026-11-02T09:00:30')), true);
  assert.equal(isDue({ ...job, lastRun: at('2026-11-02T09:00:40').toISOString() }, at('2026-11-02T09:05:00')), false);
  assert.equal(isDue(job, at('2026-11-02T14:59:00')), true, 'made up for within six hours');
  assert.equal(isDue(job, at('2026-11-02T15:30:00')), false);
  assert.equal(isDue({ ...job, enabled: false }, at('2026-11-02T09:00:30')), false);
  const old = make({ kind: 'daily', time: '09:00' }, agent, '2026-10-01T08:00:00');
  assert.equal(isDue(old, at('2026-11-02T09:00:30')), true);
});

test('upcoming lists the next runs for the form', () => {
  const list = upcoming({ kind: 'daily', time: '09:00' }, at('2026-11-02T08:00:00'), 3);
  assert.deepEqual(list.map((d) => d.getDate()), [2, 3, 4]);
  assert.equal(upcoming({ kind: 'once', at: '2026-11-05T10:00' }, at('2026-11-02T08:00:00')).length, 1);
  assert.equal(upcoming({ kind: 'interval', every: 30, unit: 'minutes' }, at('2026-11-02T08:00:00'))[1].getMinutes(), 0);
});

test('prompts: agents use /agent, workflows go through n8n, skills are named', () => {
  assert.equal(jobPrompt(make({ kind: 'daily', time: '09:00' })), '/agent a-1');
  const w = jobPrompt(newJob({ name: 'Reminders', target: wf, note: 'use test data', cadence: { kind: 'daily', time: '09:00' } }), true);
  assert.match(w, /n8n workflow "Invoice reminder"/);
  assert.match(w, /use test data/);
  assert.match(w, /run by hand/);
  assert.match(jobPrompt(make({ kind: 'daily', time: '09:00' }, { type: 'skill', id: 'brief', label: 'brief' })), /skill "brief"/);
});

test('run history keeps the newest 20; skipped runs do not count as a run', () => {
  let job = make({ kind: 'daily', time: '09:00' });
  for (let i = 0; i < 25; i += 1) job = addRun(job, { id: `r${i}`, at: new Date(2026, 10, 2, 9, i).toISOString(), ms: 1, status: 'ok', trigger: 'schedule', note: '' });
  assert.equal(job.runs.length, 20);
  assert.equal(job.runs[0].id, 'r24');
  const before = job.lastRun;
  assert.equal(addRun(job, { id: 's', at: new Date().toISOString(), ms: 0, status: 'skipped', trigger: 'schedule', note: '' }).lastRun, before);
});

test('storage drops broken jobs and keeps good ones', () => {
  const good = make({ kind: 'weekly', time: '09:00', days: [1, 5] });
  const out = sanitizeJobs([
    good,
    { ...good, id: 'x1', cadence: { kind: 'cron', expr: 'nonsense' } },
    { ...good, id: 'x2', target: { type: 'robot', id: 'z', label: 'z' } },
    { ...good, id: 'x3', cadence: { kind: 'weekly', time: '09:00', days: [] } },
    { ...good },
    'text', null,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, good.id);
  assert.deepEqual(sanitizeJobs('nope'), []);
});

test('the Scheduler sits in the middle of the rail and is wired to the app', () => {
  const rail = src('src/ui/Rail.tsx');
  assert.match(rail, /aria-label="Scheduler"/);
  assert.ok(rail.indexOf('className="rail-mid"') > rail.indexOf('aria-label="Develop"'), 'below the top icons');
  assert.ok(rail.indexOf('className="rail-mid"') < rail.indexOf('className="rail-foot"'), 'above help, settings and profile');
  const app = src('src/App.tsx');
  assert.match(app, /view === 'scheduler' \? \(\s*<SchedulerView/);
  assert.match(app, /isJobDue\(j, new Date\(\)\)/, 'the due check also runs jobs');
  const ui = src('src/ui/SchedulerView.tsx');
  for (const w of ['Success', 'Created', 'Run now', 'Pause', 'Resume', 'Delete', 'Run history', 'Create job', 'Cron']) assert.ok(ui.includes(w), w);
});

test('example jobs cover agent, workflow and skill, with every kind of repeat and a history', () => {
  const jobs = exampleJobs(at('2026-11-03T12:00:00'));
  assert.deepEqual(new Set(jobs.map((j) => j.target.type)), new Set(['agent', 'workflow', 'skill']));
  assert.ok(new Set(jobs.map((j) => j.cadence.kind)).size >= 4);
  assert.ok(jobs.every((j) => j.example && cadenceProblems(j.cadence, new Date(0)).length === 0), 'valid; one-time samples may lie in the past (done, missed)');
  assert.ok(jobs.some((j) => j.runs.some((r) => r.status === 'error')));
  assert.ok(jobs.some((j) => !j.enabled));
  assert.equal(sanitizeJobs(jobs).length, jobs.length, 'they survive storage');
  assert.ok(sanitizeJobs(jobs).every((j) => j.example));
});

test('an example job runs the monday-close skill every Monday morning', () => {
  const job = exampleJobs(at('2026-11-03T12:00:00')).find((j) => j.target.id === 'monday-close');
  assert.ok(job);
  assert.equal(job.target.type, 'skill');
  assert.deepEqual(job.cadence, { kind: 'weekly', time: '06:30', days: [1] });
  assert.match(jobPrompt(job), /monday-close/);
});

const NOW = at('2026-11-07T12:00:00');
const samples = exampleJobs(NOW);

test('many sample jobs, in every state and for every kind of repeat', () => {
  assert.ok(samples.length >= 40);
  assert.equal(new Set(samples.map((j) => j.id)).size, samples.length, 'ids are unique');
  const states = new Set(samples.map((j) => jobState(j, NOW)));
  for (const st of ['scheduled', 'failing', 'paused', 'done', 'missed']) assert.ok(states.has(st), st);
  assert.deepEqual(new Set(samples.map((j) => j.cadence.kind)), new Set(['once', 'interval', 'daily', 'weekly', 'monthly', 'cron']));
  assert.ok(samples.some((j) => j.cadence.kind === 'once' && !j.lastRun && nextRun(j, NOW)), 'a one-time job still ahead');
  assert.ok(samples.some((j) => j.enabled && j.runs.length === 0 && j.cadence.kind !== 'once'), 'an active job that never ran');
  assert.ok(samples.every((j) => !j.fails || jobState(j, NOW) === 'failing'), 'a job marked as failing is failing');
  assert.ok(samples.filter((j) => j.fails).length >= 3);
});

test('failing means: active and the latest run failed', () => {
  const failing = samples.find((j) => j.fails);
  assert.equal(jobState(failing, NOW), 'failing');
  assert.equal(jobState({ ...failing, enabled: false }, NOW), 'paused');
  const healed = addRun(failing, { id: 'ok', at: NOW.toISOString(), ms: 1, status: 'ok', trigger: 'manual', note: '' });
  assert.equal(jobState(healed, NOW), 'scheduled');
});

test('every sample job has a business area and an organization unit; the groups are many', () => {
  assert.ok(samples.every((j) => j.groups?.area && j.groups?.unit));
  assert.ok(new Set(samples.map((j) => j.groups.unit)).size >= 6);
  assert.ok(new Set(samples.map((j) => j.groups.area)).size >= 6);
});

test('grouping by functional type gives workflows, agents, skills in that order', () => {
  const [type, area, unit] = BUILTIN_DIMS;
  const groups = groupJobs(samples, type, NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Workflows', 'Agents', 'Skills']);
  assert.equal(groups.reduce((n, g) => n + g.jobs.length, 0), samples.length);
  assert.ok(groups.every((g) => g.jobs.every((j) => groupValue(j, type) === g.label)));
  const byUnit = groupJobs(samples, unit, NOW).map((g) => g.label);
  assert.deepEqual(byUnit, [...byUnit].sort((a, b) => a.localeCompare(b)), 'alphabetical');
  assert.equal(groupJobs(samples, null, NOW).length, 1);
  assert.equal(groupJobs([], area, NOW).length, 0);
});

test('jobs without a value land in "Unassigned", which comes last', () => {
  const [, area] = BUILTIN_DIMS;
  const jobs = [...samples.slice(0, 3), withGroup(samples[3], 'area', '')];
  const labels = groupJobs(jobs, area, NOW).map((g) => g.label);
  assert.equal(labels.at(-1), UNASSIGNED);
});

test('group figures count active, failing, paused and the success rate', () => {
  const stats = groupStats(samples, NOW);
  assert.equal(stats.total, samples.length);
  assert.equal(stats.failing, samples.filter((j) => jobState(j, NOW) === 'failing').length);
  assert.equal(stats.paused, samples.filter((j) => jobState(j, NOW) === 'paused').length);
  assert.equal(stats.runs, samples.reduce((n, j) => n + j.runs.length, 0));
  assert.ok(stats.ok <= stats.runs);
});

test('own groupings: add, set a value on a job, group by it, remove it again', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let dims = loadDims(storage);
  assert.deepEqual(dims.map((d) => d.id), ['type', 'area', 'unit']);
  const cc = newDim('  Cost   center ', dims);
  assert.equal(cc.label, 'Cost center');
  assert.equal(newDim('cost center', [...dims, cc]), null, 'no duplicate names');
  assert.equal(newDim('Business area', dims), null, 'not a built-in name either');
  dims = [...dims, cc];
  saveDims(dims, storage);
  assert.deepEqual(loadDims(storage).map((d) => d.label), ['Functional type', 'Business area', 'Organization unit', 'Cost center']);
  let jobs = samples.slice(0, 4).map((j, i) => withGroup(j, cc.id, i < 2 ? 'CC-1000' : 'CC-2000'));
  assert.deepEqual(groupValues(jobs, cc.id), ['CC-1000', 'CC-2000']);
  assert.deepEqual(groupJobs(jobs, cc, NOW).map((g) => [g.label, g.jobs.length]), [['CC-1000', 2], ['CC-2000', 2]]);
  jobs = withoutDim(jobs, cc.id);
  assert.ok(jobs.every((j) => !j.groups?.[cc.id]) && jobs.every((j) => j.groups?.area), 'only the removed grouping is gone');
});

test('at most six own groupings', () => {
  let dims = loadDims();
  for (let i = 0; i < 6; i += 1) dims = [...dims, newDim(`G${i}`, dims)];
  assert.equal(newDim('One more', dims), null);
});

test('storage keeps group values, drops broken ones and never accepts a value for the derived type', () => {
  const out = sanitizeJobs([{ ...samples[0], groups: { area: ' Finance ', unit: '', type: 'Hack', 'bad key!': 'x', 'g-1': 'CC-1' } }]);
  assert.deepEqual(out[0].groups, { area: 'Finance', 'g-1': 'CC-1' });
  assert.equal(newJob({ name: 'J', target: agent, cadence: { kind: 'daily', time: '09:00' }, groups: { area: 'Finance', type: 'x', unit: ' ' } }, NOW).groups?.type, undefined);
  assert.equal(sanitizeJobs([{ ...samples[0], fails: true }])[0].fails, true);
  assert.equal(sanitizeJobs([{ ...make({ kind: 'daily', time: '09:00' }), fails: true }])[0]?.fails, undefined, 'only samples can fail on purpose');
});

test('the larger sample set replaces the old samples once and keeps the own jobs', () => {
  const mine = make({ kind: 'daily', time: '09:00' });
  const merged = mergeExamples([mine, samples[0]], samples);
  assert.equal(merged[0].id, mine.id);
  assert.equal(merged.length, samples.length + 1);
  assert.equal(merged.filter((j) => j.example).length, samples.length);
  const app = src('src/App.tsx');
  assert.match(app, /JOBS_EXAMPLES_KEY/);
  assert.match(app, /job\.fails === true/, 'a failing sample writes failed mock runs');
});

test('the Scheduler offers grouping, filter and own groupings', () => {
  const ui = src('src/ui/SchedulerView.tsx');
  for (const w of ['Group by', 'No grouping', 'Groupings…', 'Add grouping', 'Collapse all', 'Search jobs', 'Status']) assert.ok(ui.includes(w), w);
  assert.match(ui, /groupJobs\(shown, dim, now\)/);
});
