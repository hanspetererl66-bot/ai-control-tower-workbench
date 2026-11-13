import assert from 'node:assert/strict';
import test from 'node:test';
import { applyProposal, describeSource, refreshable, runSource } from '../src/space-designer-refresh.ts';

const base = { id: 'd1', name: 'Tickets', columns: ['Priority', 'Open'], rows: [['High', '1']] };
const joule = { ...base, source: { kind: 'joule', prompt: 'Open tickets by priority', asOf: '2026-11-01T08:00', note: 'old' } };
const file = { ...base, source: { kind: 'file', name: 'tickets.csv', asOf: '', note: '' } };
const database = { ...base, source: { kind: 'database', view: 'observability.cost-agents', days: 14, asOf: '', note: '' } };
const json = (o) => '```json\n' + JSON.stringify(o) + '\n```';

test('each source says in plain words what refreshing does; the Joule question is shown word for word', () => {
  assert.equal(describeSource(base), null);
  const j = describeSource(joule);
  assert.equal(j.detail, 'Open tickets by priority');
  assert.equal(j.button, 'Ask Joule');
  assert.match(j.reads, /read only/);
  assert.match(describeSource(file).what, /tickets\.csv/);
  assert.match(describeSource(file).detail, /choose the file again/);
  assert.match(describeSource(database).detail, /Cost per agent, last 14 days/);
});

test('only data sets with a source are refreshable', () => {
  assert.deepEqual(refreshable({ datasets: [base, joule, file] }).map((d) => d.id), ['d1', 'd1']);
});

test('Joule: the question goes to the agent once, a table comes back as a proposal; errors and junk become a sentence', async () => {
  let calls = 0, prompt = '';
  const ok = await runSource(joule, { generate: async (p) => { calls += 1; prompt = p; return json({ columns: ['Priority', 'Open'], rows: [['High', 5]], sources: 'Jira' }); } }, 'My page');
  assert.equal(calls, 1);
  assert.match(prompt, /Open tickets by priority/);
  assert.deepEqual(ok.proposal.rows, [['High', '5']]);
  assert.match((await runSource(joule, { generate: async () => json({ error: 'no access' }) }, 't')).note, /no access/);
  assert.match((await runSource(joule, { generate: async () => 'hello' }, 't')).note, /table I can read/);
  assert.match((await runSource(joule, { generate: async () => { throw new Error('offline'); } }, 't')).note, /offline/);
  assert.match((await runSource(joule, {}, 't')).note, /not connected/);
});

test('file: cancel is silent, a bad file gives its reason, a good one a proposal named after the file', async () => {
  assert.equal((await runSource(file, { pickFile: async () => ({ ok: false, canceled: true }) }, 't')).note, '');
  assert.match((await runSource(file, { pickFile: async () => ({ ok: true, name: 'x.json', text: '{nope' }) }, 't')).note, /not valid JSON/);
  const r = await runSource(file, { pickFile: async () => ({ ok: true, name: 'new.csv', text: 'Priority,Open\nHigh,9' }) }, 't');
  assert.deepEqual(r.proposal.rows, [['High', '9']]);
  assert.equal(r.proposal.sources, 'File new.csv');
});

test('database: the view id and days are passed on as saved; empty or failed answers become a sentence', async () => {
  let asked;
  const table = { columns: ['Agent'], rows: [['A']], sources: 'Agent Observability', notes: [] };
  const r = await runSource(database, { dataView: async (id, days) => { asked = [id, days]; return { ok: true, table }; } }, 't');
  assert.deepEqual(asked, ['observability.cost-agents', 14]);
  assert.deepEqual(r.proposal.rows, [['A']]);
  assert.match((await runSource(database, { dataView: async () => ({ ok: true, table: { ...table, rows: [] } }) }, 't')).note, /no rows/);
  assert.match((await runSource(database, { dataView: async () => ({ ok: false, detail: 'No database access' }) }, 't')).note, /No database access/);
});

test('applying a proposal replaces the numbers, sets the time, keeps the source, and never keeps a path in a file name', () => {
  const now = new Date('2026-11-13T10:07:30Z');
  const j = applyProposal(joule, { columns: ['Priority', 'Open'], rows: [['High', '5']], sources: 'Jira', notes: [] }, now);
  assert.deepEqual(j.rows, [['High', '5']]);
  assert.deepEqual(j.source, { kind: 'joule', prompt: 'Open tickets by priority', asOf: '2026-11-13T10:07', note: 'Jira' });
  const f = applyProposal(file, { columns: ['a'], rows: [['1']], sources: 'File /Users/me/x/new.csv', notes: ['Only the first 200 of 300 rows are kept.'] }, now);
  assert.equal(f.source.name, 'Usersmexnew.csv');
  assert.ok(!/[\\/]/.test(f.source.name));
  assert.equal(f.source.note, 'Only the first 200 of 300 rows are kept.');
  assert.equal(applyProposal(base, { columns: ['a'], rows: [], sources: '', notes: [] }), base);
});
