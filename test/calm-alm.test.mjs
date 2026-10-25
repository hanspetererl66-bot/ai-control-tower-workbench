import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { callCalm } from '../shared/calm-mock.mjs';
import { embedCalmAlm, modelSource, repoData } from '../scripts/sync-calm-alm.mjs';

const page = readFileSync(new URL('../examples/calm-alm/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../examples/shared/design-system.css', import.meta.url), 'utf8');
const data = repoData();
const call = (name, args) => callCalm(data, name, args);
const p1 = data.projects[0].id;

test('sample data is consistent: ids resolve and codes are the real Cloud ALM codes', () => {
  const pids = new Set(data.projects.map((p) => p.id)), tbs = new Set(data.timeboxes.map((t) => t.id)), fs = new Set(data.features.map((f) => f.id));
  assert.equal(new Set(data.tasks.map((t) => t.id)).size, data.tasks.length);
  for (const t of data.tasks) {
    assert.ok(pids.has(t.projectId), t.id);
    assert.match(t.type, /^CALM(TASK|US|REQU|DEF|RISK|QGATE)$/);
    assert.match(t.status, /^CIP[A-Z]+$/);
    assert.ok([10, 20, 30, 40].includes(t.priority));
    if (t.timeboxId) assert.ok(tbs.has(t.timeboxId), t.id);
    if (t.featureId) assert.ok(fs.has(t.featureId), t.id);
  }
});

test('calm_analytics counts open defects per project and says it is a snapshot', () => {
  const r = call('calm_analytics', { provider: 'Defects', filter: "defectStatus eq 'CIPDFCTOPEN'", group_by: 'projectName' });
  assert.equal(r.isError, false);
  const open = data.tasks.filter((t) => t.type === 'CALMDEF' && t.status === 'CIPDFCTOPEN').length;
  assert.equal(r.data.total, open);
  assert.equal(r.data.groups.reduce((n, g) => n + g.count, 0), open);
  assert.match(r.data.snapshot, /snapshot/);
});

test('calm_analytics rejects unknown providers, unknown fields and filters it cannot read', () => {
  assert.match(call('calm_analytics', { provider: 'Nope' }).data, /Unknown provider/);
  assert.match(call('calm_analytics', { provider: 'Defects', filter: "bogus eq 'x'" }).data, /no field 'bogus'/);
  assert.match(call('calm_analytics', { provider: 'Defects', filter: 'priority gt 10' }).data, /Cannot read the filter/);
});

test('calm_list needs a project for tasks, resolves sprint names, projects fields and pages', () => {
  assert.match(call('calm_list', { resource: 'tasks' }).data, /needs project_id/);
  const r = call('calm_list', { resource: 'tasks', project_id: p1, task_type: 'CALMUS', status: 'CIPUSOPEN', timebox_name: 'Sprint 5', fields: 'displayId,title' });
  assert.equal(r.isError, false);
  assert.ok(r.data.records.length > 0 && r.data.records.every((x) => Object.keys(x).join() === 'displayId,title'));
  assert.match(call('calm_list', { resource: 'tasks', project_id: p1, timebox_name: 'Sprint 99' }).data, /No timebox named/);
  assert.match(call('calm_list', { resource: 'tasks', project_id: p1, timebox_id: 'x', timebox_name: 'Sprint 5' }).data, /either timebox_id or timebox_name/);
  const page1 = call('calm_list', { resource: 'tasks', project_id: p1, limit: 5 });
  assert.equal(page1.data.records.length, 5);
  assert.deepEqual(page1.data.nextPage, { offset: 5 });
  assert.match(call('calm_list', { resource: 'tasks', project_id: p1, task_type: 'CALMQGATE', status: 'CIPQGDONE' }).data.note, /No records matched/);
});

test('count_only and group_by return tallies, never records, and refuse fields', () => {
  const c = call('calm_list', { resource: 'tasks', project_id: p1, task_type: 'CALMUS', count_only: true });
  assert.equal(c.data.total, data.tasks.filter((t) => t.projectId === p1 && t.type === 'CALMUS').length);
  assert.equal(c.data.records, undefined);
  const g = call('calm_list', { resource: 'tasks', project_id: p1, group_by: 'priority' });
  assert.equal(g.data.groups.reduce((n, x) => n + x.count, 0), g.data.total);
  assert.match(call('calm_list', { resource: 'tasks', project_id: p1, count_only: true, fields: 'title' }).data, /cannot be combined/);
});

test('calm_get finds tasks and features by id or display id', () => {
  const t = data.tasks[0];
  assert.equal(call('calm_get', { resource: 'task', id: t.id }).data.title, t.title);
  assert.equal(call('calm_get', { resource: 'feature', id: '6-101' }).data.id, 'f-01');
  assert.match(call('calm_get', { resource: 'task', id: 'missing' }).data, /not found/);
});

test('the mock is read-only: calm_create is refused and unknown tools are errors', () => {
  const r = call('calm_create', { resource: 'document', title: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.data, /CALM_WRITE_ENABLED/);
  assert.match(call('calm_delete', {}).data, /Unknown tool/);
});

test('the page embeds exactly the mock and the data, is in sync, and runs the same tools', () => {
  assert.equal(embedCalmAlm(page, data, undefined, css), page, 'run: npm run sync:calm-alm');
  const embedded = /<script id="ca-model">([\s\S]*?)<\/script>/.exec(page)[1].trim();
  assert.equal(embedded, modelSource().trim());
  const ctx = vm.createContext({});
  vm.runInContext(`${embedded}\nthis.run = callCalm;`, ctx);
  const args = { provider: 'Tasks', group_by: 'statusText' };
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.run(data, 'calm_analytics', args))), JSON.parse(JSON.stringify(call('calm_analytics', args))));
});

test('the page is self-contained, escapes what it prints and sends Ask Joule within the host limit', () => {
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket|<form|https?:\/\/(?!www\.w3\.org)/);
  assert.match(page, /type: 'wb:ask'/);
  assert.match(page, /slice\(0, 600\)/);
  assert.match(page, /class="card"/);
  assert.match(page, /read-only/);
});
