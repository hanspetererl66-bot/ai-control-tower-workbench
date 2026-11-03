import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addLink, collapse, diffLines, diffRevisions, featureArgs, featureFiles, filterItems, itemFrom, itemsForRef, loadHistory, loadRegistry, loadRevFiles,
  newFeature, noFilter, parseFeature, restoreRevision, revsFrom, rollbackArgs, setStage, stageText, targetsOf, typeOf,
} from '../src/registry.ts';
import { developUnit } from '../src/work-sync.ts';
import { syncOnce } from '../src/work-sync.ts';
import { newProject } from '../src/develop.ts';

const row = (o) => ({ id: 'i1', kind: 'workflow', name: 'Contract upload', owner: 'a@b.de', visibility: 'private', stage: 'build', archived: false, current_rev: 3, updated_at: '2026-11-03T10:00:00Z', files: 2, ...o });
const ref = { source: 'jira', key: 'A-1', title: 'Weekly report', url: 'https://j/A-1' };

test('typeOf and itemFrom: kind and intent decide the type', () => {
  assert.equal(typeOf('agent', {}), 'agent');
  assert.equal(typeOf('workflow', {}), 'workflow');
  assert.equal(typeOf('code', { source: 'feature' }), 'feature');
  assert.equal(typeOf('code', {}), 'code');
  const i = itemFrom(row(), { intent: { sources: [ref], extends: { id: 'a1', name: 'Watcher' } }, approved: ['intent', 'requirements'] });
  assert.equal(i.rev, 3);
  assert.deepEqual(i.refs, [ref]);
  assert.deepEqual(i.extendsItem, { id: 'a1', name: 'Watcher' });
  assert.equal(itemFrom(row()).refs.length, 0, 'without detail the item is shown without links');
});

test('stageText: steps by name, agents by confirmed steps', () => {
  assert.equal(stageText({ type: 'workflow', stage: 'specification', approved: [] }), 'Specification & Architecture');
  assert.equal(stageText({ type: 'agent', stage: 'prd,tfd', approved: ['prd', 'tfd'] }), '2 steps confirmed');
  assert.equal(stageText({ type: 'agent', stage: '', approved: [] }), 'Draft');
  assert.equal(stageText({ type: 'code', stage: '', approved: [] }), '');
});

test('filterItems: type, status and search over name, owner, ticket key and extended item', () => {
  const items = [
    itemFrom(row({ id: 'w', updated_at: '2026-11-01T00:00:00Z' }), { intent: { sources: [ref] } }),
    itemFrom(row({ id: 'a', kind: 'agent', name: 'Renewal watcher', updated_at: '2026-11-03T00:00:00Z' }), {}),
    itemFrom(row({ id: 'f', kind: 'code', name: 'Column', archived: true, updated_at: '2026-11-02T00:00:00Z' }), { intent: { source: 'feature', extends: { id: 'a', name: 'Renewal watcher' } } }),
  ];
  assert.deepEqual(filterItems(items, noFilter()).map((i) => i.id), ['a', 'w'], 'active, newest first');
  assert.deepEqual(filterItems(items, { ...noFilter(), status: 'archived' }).map((i) => i.id), ['f']);
  assert.deepEqual(filterItems(items, { type: 'workflow', status: 'all', query: '' }).map((i) => i.id), ['w']);
  assert.deepEqual(filterItems(items, { ...noFilter(), query: 'a-1' }).map((i) => i.id), ['w'], 'by Jira key');
  assert.deepEqual(filterItems(items, { type: 'all', status: 'all', query: 'watcher' }).map((i) => i.id), ['a', 'f'], 'also by the item it extends');
  assert.deepEqual(itemsForRef(items, 'jira', 'A-1').map((i) => i.id), ['w']);
  assert.deepEqual(itemsForRef(items, 'slack', 'A-1'), []);
  assert.deepEqual(targetsOf(items), [{ id: 'w', kind: 'workflow', name: 'Contract upload' }, { id: 'a', kind: 'agent', name: 'Renewal watcher' }]);
});

test('revsFrom: newest first, broken rows dropped', () => {
  const r = revsFrom([{ rev: 1, author: 'a', note: 'first', created_at: '2026-11-01T08:00:00Z', files: 2 }, { rev: 3, author: 'b', note: '', created_at: '2026-11-03T08:00:00Z' }, { rev: 0 }, null]);
  assert.deepEqual(r.map((x) => x.rev), [3, 1]);
  assert.equal(r[1].note, 'first');
  assert.deepEqual(revsFrom('x'), []);
});

test('diffLines: additions, removals and unchanged lines', () => {
  const d = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(d.map((l) => l.t + l.s), [' a', '-b', '+B', ' c', ' d', '+e']);
  assert.deepEqual(diffLines('same', 'same'), [{ t: ' ', s: 'same' }]);
  const big = diffLines(Array.from({ length: 3000 }, (_, i) => `x${i}`).join('\n'), Array.from({ length: 3000 }, (_, i) => `y${i}`).join('\n'));
  assert.equal(big.filter((l) => l.t === '-').length, 3000, 'very large input still ends');
});

test('collapse: long unchanged runs become one line, context stays', () => {
  const lines = [...Array.from({ length: 10 }, (_, i) => ({ t: ' ', s: `l${i}` })), { t: '+', s: 'new' }, ...Array.from({ length: 10 }, (_, i) => ({ t: ' ', s: `m${i}` }))];
  const c = collapse(lines, 1);
  assert.deepEqual(c.map((l) => l.t), ['…', ' ', '+', ' ', '…']);
  assert.equal(c[0].s, '9 unchanged lines');
  assert.deepEqual(collapse([{ t: ' ', s: 'x' }]), [{ t: '…', s: '1 unchanged line' }]);
});

test('diffRevisions: JSON is pretty-printed, files are added, removed, changed', () => {
  const a = [{ path: 'project.json', content: '{"name":"A","n":1}' }, { path: 'old.md', content: 'x' }, { path: 'same.md', content: 's' }];
  const b = [{ path: 'project.json', content: '{"name":"B","n":1}' }, { path: 'new.md', content: 'y' }, { path: 'same.md', content: 's' }];
  const d = diffRevisions(a, b);
  assert.deepEqual(d.map((x) => `${x.path}:${x.status}`), ['project.json:changed', 'new.md:added', 'old.md:removed', 'same.md:same']);
  const changed = d[0].lines.filter((l) => l.t === '+' || l.t === '-').map((l) => l.t + l.s.trim());
  assert.deepEqual(changed, ['-"name": "A",', '+"name": "B",'], 'a one-line JSON file shows the real change');
});

test('feature: files, reading back, stages and links', () => {
  const f = newFeature({ name: 'Contract column', goal: 'Show the notice period', refs: [ref], brief: '# Contract column' });
  assert.equal(f.stage, 'intent');
  const files = featureFiles(f);
  assert.deepEqual(files.map((x) => x.path), ['project.json', 'brief.md']);
  assert.deepEqual(parseFeature(files), f);
  assert.equal('brief' in JSON.parse(files[0].content), false, 'the brief text is kept once, in brief.md');
  assert.equal(files[1].content, '# Contract column');
  assert.equal(parseFeature([{ path: 'project.json', content: '{"format":"other"}' }]), null);
  const later = setStage(f, 'build');
  assert.deepEqual(later.approved, ['intent', 'requirements', 'specification']);
  assert.deepEqual(setStage(later, 'requirements').approved, ['intent'], 'moving back takes later approvals back');
  const linked = addLink(f, 'PR 181', 'https://github.com/x/y/pull/181');
  assert.equal(linked.links.length, 1);
  assert.equal(addLink(linked, 'again', 'https://github.com/x/y/pull/181'), null, 'no duplicates');
  assert.equal(addLink(f, 'bad', 'javascript:alert(1)'), null);
  const a1 = featureArgs(f, { note: 'Created from Sources' });
  assert.equal(a1.kind, 'code');
  assert.equal('id' in a1, false);
  assert.equal(a1.intent.source, 'feature');
  assert.deepEqual(a1.intent.sources, [ref]);
  const a2 = featureArgs(later, { id: 'i9', expectedRev: 4, note: 'Stage: Build' });
  assert.equal(a2.id, 'i9');
  assert.equal(a2.expected_rev, 4);
  assert.equal(a2.stage, 'build');
});

test('rollbackArgs: exact files, stage and links read back from the old revision', () => {
  const p = { ...newProject('workflow'), stage: 'specification', approved: ['intent', 'requirements'], sources: [ref] };
  p.intent = { ...p.intent, name: 'Contract upload', goal: 'Check the notice period of uploaded contracts' };
  const files = developUnit(p).files;
  const a = rollbackArgs({ id: 'i1', kind: 'workflow', name: 'Contract upload', currentRev: 5 }, files, 2);
  assert.equal(a.expected_rev, 5);
  assert.equal(a.stage, 'specification');
  assert.deepEqual(a.approved, ['intent', 'requirements']);
  assert.deepEqual(a.intent.sources, [ref]);
  assert.deepEqual(a.files.map((f) => f.content), files.map((f) => f.content), 'copied exactly');
  assert.equal(a.note, 'Restored revision 2');
  const feature = newFeature({ name: 'F', goal: 'g', refs: [ref], brief: 'b' });
  const af = rollbackArgs({ id: 'i2', kind: 'code', name: 'F', currentRev: 2 }, featureFiles(setStage(feature, 'build')), 1);
  assert.equal(af.stage, 'build');
  assert.equal(af.intent.source, 'feature');
  const plain = rollbackArgs({ id: 'i3', kind: 'code', name: 'Script', currentRev: 2, intent: { note: 'keep' } }, [{ path: 'a.py', content: 'print(1)' }], 1);
  assert.deepEqual(plain.intent, { note: 'keep' });
});

/** A small fake of the five work item tools. */
function fakeApi({ rows = [], details = {}, history = {}, revs = {}, fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    call: async (tool, args) => {
      calls.push([tool, args]);
      if (fail[tool + (args.id ?? '')]) throw new Error('boom');
      if (tool === 'list_work_items') return rows;
      if (tool === 'get_work_item') return args.rev ? { files: revs[`${args.id}:${args.rev}`] ?? [] } : details[args.id] ?? {};
      if (tool === 'work_item_history') return history[args.id] ?? [];
      if (tool === 'save_work_item') return { id: args.id, rev: (args.expected_rev ?? 0) + 1 };
      throw new Error(`unexpected ${tool}`);
    },
  };
}

test('loadRegistry: completes every item and survives one failing item', async () => {
  const api = fakeApi({
    rows: [row({ id: 'a', updated_at: '2026-11-01T00:00:00Z' }), row({ id: 'b', kind: 'code', updated_at: '2026-11-02T00:00:00Z' }), row({ id: 'c', updated_at: '2026-11-03T00:00:00Z' })],
    details: { a: { intent: { sources: [ref] } }, b: { intent: { source: 'feature' } } },
    fail: { get_work_itemc: true },
  });
  const items = await loadRegistry(api, 2);
  assert.deepEqual(items.map((i) => i.id), ['c', 'b', 'a']);
  assert.equal(items[1].type, 'feature');
  assert.deepEqual(items[2].refs, [ref]);
  assert.equal(items[0].refs.length, 0);
  assert.deepEqual(await loadRegistry(fakeApi()), []);
});

test('loadHistory and loadRevFiles', async () => {
  const api = fakeApi({ history: { i1: [{ rev: 1, author: 'a', note: 'n', created_at: '2026-11-01T00:00:00Z' }] }, revs: { 'i1:1': [{ path: 'a.md', content: 'x', language: 'markdown' }, { path: 'b.bin', sha256: 'z' }] } });
  assert.equal((await loadHistory(api, 'i1'))[0].note, 'n');
  assert.deepEqual(await loadRevFiles(api, 'i1', 1), [{ path: 'a.md', language: 'markdown', content: 'x' }], 'files without content are left out');
});

test('restoreRevision saves the old files on top of the current revision', async () => {
  const p = { ...newProject('workflow'), sources: [ref] };
  const files = developUnit(p).files.map((f) => ({ ...f }));
  const api = fakeApi({ details: { i1: { current_rev: 7, intent: {} } }, revs: { 'i1:2': files } });
  const rev = await restoreRevision(api, { id: 'i1', type: 'workflow', name: 'Contract upload', rev: 5 }, 2);
  assert.equal(rev, 8);
  const save = api.calls.find((c) => c[0] === 'save_work_item')[1];
  assert.equal(save.expected_rev, 7, 'based on what the database says now, not on the list');
  assert.equal(save.kind, 'workflow');
  assert.equal(save.note, 'Restored revision 2');
  await assert.rejects(() => restoreRevision(fakeApi(), { id: 'x', type: 'agent', name: 'n', rev: 1 }, 1), /no files/);
});

test('the project sync leaves features and other code items alone', async () => {
  const api = fakeApi({ rows: [row({ id: 'f', kind: 'code', name: 'Feature' })] });
  const r = await syncOnce(api, { agent: [], dev: [], map: {} });
  assert.equal(r.pulled, 0);
  assert.equal(api.calls.filter((c) => c[0] === 'get_work_item').length, 0, 'a code item is never fetched or restored as a project');
});
