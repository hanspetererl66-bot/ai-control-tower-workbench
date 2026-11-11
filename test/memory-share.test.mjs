import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOwnLevels, dbLevelOf, entryUnit, forgetEntry, loadShareMap, makePrivate, ownLevels, requestEntry, saveShareMap } from '../src/memory-share.ts';
import { syncShared } from '../src/memory-shared.ts';
import { defaultGov, levelOf } from '../src/skill-governance.ts';

const GROUP = '00000000-0000-4000-8000-0000000000f1';
const entry = (text = 'Renewals are reviewed on Mondays', id = 'mem-1') => ({ id, kind: 'context', text, createdAt: '2026-11-10T10:00:00Z' });

/** In-memory work items with the rules that matter here: a shared memory entry cannot be saved over (migration 046), requests are checked. */
function fakeDb({ block = false } = {}) {
  const items = new Map(); const reqs = []; const calls = []; let n = 0;
  return {
    items, reqs, calls,
    async call(tool, a) {
      calls.push({ tool, a });
      if (tool === 'save_work_item') {
        let i = a.id ? items.get(a.id) : null;
        if (i && a.expected_rev !== i.current_rev) throw new Error('The item was changed meanwhile');
        if (i && i.visibility !== 'private' && (a.visibility ?? 'private') !== 'private') throw new Error('A shared memory entry cannot be changed. Make it private first');
        if (!i) { i = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, current_rev: 0, owner: 'me@x.com', archived: false, visibility: 'private' }; items.set(i.id, i); }
        Object.assign(i, { kind: a.kind, name: a.name, stage: a.stage, files: a.files, visibility: a.visibility ?? 'private', current_rev: i.current_rev + 1 });
        return { id: i.id, rev: i.current_rev };
      }
      if (tool === 'get_work_item') return { ...items.get(a.id) };
      if (tool === 'archive_work_item') { if (a.id === 'fail') throw new Error('nope'); items.get(a.id).archived = true; return {}; }
      if (tool === 'request_agent_promotion') {
        const r = { id: `11111111-2222-4333-8444-${String(reqs.length + 1).padStart(12, '0')}`, item_id: a.id, to: a.to, status: block ? 'blocked' : 'review', checks: block ? [{ id: 'secrets', status: 'fail', detail: 'Looks like a password, key, card number or IBAN.' }] : [] };
        reqs.push(r); return { request: { id: r.id, status: r.status } };
      }
      if (tool === 'list_agent_requests') return { requests: reqs };
      if (tool === 'withdraw_agent_request') { reqs.find((r) => r.id === a.id).status = 'withdrawn'; return {}; }
      throw new Error(`unexpected ${tool}`);
    },
  };
}

test('asking uploads the entry first as a private item, then asks; nothing is uploaded again while the text is the same', async () => {
  const db = fakeDb();
  const r = await requestEntry(db, {}, entry(), 0, GROUP, 'note');
  assert.ok(r.id);
  const item = [...db.items.values()][0];
  assert.equal(item.kind, 'memory'); assert.equal(item.stage, 'memory-entry'); assert.equal(item.visibility, 'private');
  assert.deepEqual(JSON.parse(item.files[0].content).entry, { id: 'mem-1', kind: 'context', text: 'Renewals are reviewed on Mondays' });
  assert.equal(r.map['mem-1'].itemId, item.id);
  assert.deepEqual(db.calls.map((c) => c.tool).slice(0, 2), ['save_work_item', 'request_agent_promotion']);
  db.calls.length = 0;
  await requestEntry(db, r.map, entry(), 0, GROUP, '').catch(() => undefined);
  assert.equal(db.calls.filter((c) => c.tool === 'save_work_item').length, 0, 'same text: no new revision');
});

test('an edited private entry is saved as a new revision before the next request', async () => {
  const db = fakeDb();
  const first = await requestEntry(db, {}, entry(), 0, GROUP, '');
  db.reqs[0].status = 'withdrawn';
  const second = await requestEntry(db, first.map, entry('Renewals are reviewed on Tuesdays now'), 0, GROUP, '');
  assert.equal([...db.items.values()][0].current_rev, 2);
  assert.equal(second.map['mem-1'].rev, 2);
  assert.notEqual(second.map['mem-1'].hash, first.map['mem-1'].hash);
});

test('a request the checks block is withdrawn and named; the item stays private', async () => {
  const db = fakeDb({ block: true });
  const r = await requestEntry(db, {}, entry('My IBAN is DE89 3704 0044 0532 0130 00'), 0, GROUP, '');
  assert.equal(r.id, undefined);
  assert.match(r.error, /password, key, card number or IBAN/);
  assert.equal(db.reqs[0].status, 'withdrawn');
  assert.equal([...db.items.values()][0].visibility, 'private');
});

test('a local level without an item counts as 0 for the request: the department comes first', () => {
  const gov = { ...defaultGov(), skills: { 'mem-1': 1, 'mem-2': 1 } };
  const map = { 'mem-2': { itemId: 'i2', rev: 1, hash: 'h' } };
  assert.equal(dbLevelOf(gov, map, 'mem-1'), 0, 'old simulation: never uploaded');
  assert.equal(dbLevelOf(gov, map, 'mem-2'), 1, 'has an item: the level counts');
});

test('a shared entry is fixed: saving it over is refused, making it private works and allows a change', async () => {
  const db = fakeDb();
  const r = await requestEntry(db, {}, entry(), 0, GROUP, '');
  const item = [...db.items.values()][0];
  item.visibility = 'team'; // approved by the department admin
  const refused = await requestEntry(db, r.map, entry('Changed while shared'), 1, '', '');
  assert.match(refused.error, /Make the entry private first/);
  assert.equal(item.current_rev, 1, 'nothing was saved over the shared text');
  // and the database refuses it too, should anything else try
  await assert.rejects(db.call('save_work_item', { id: item.id, expected_rev: 1, visibility: 'team', kind: 'memory', name: 'x', stage: 'memory-entry', files: [] }), /cannot be changed/);
  const priv = await makePrivate(db, r.map, entry('Changed after making it private'));
  assert.equal(priv.error, undefined);
  assert.equal(item.visibility, 'private');
  assert.equal(priv.map['mem-1'].hash, entryUnit(entry('Changed after making it private')).hash);
  assert.deepEqual(await makePrivate(db, {}, entry()), { map: {} }, 'no item: nothing to do');
});

test('forgetting archives the item; a failing archive keeps the link and says so', async () => {
  const db = fakeDb();
  const r = await requestEntry(db, {}, entry(), 0, GROUP, '');
  const gone = await forgetEntry(db, r.map, 'mem-1');
  assert.deepEqual(gone.map, {}); assert.equal([...db.items.values()][0].archived, true);
  const failing = await forgetEntry({ call: async () => { throw new Error('nope'); } }, { 'mem-9': { itemId: 'x', rev: 1, hash: 'h' } }, 'mem-9');
  assert.match(failing.error, /nope/); assert.ok(failing.map['mem-9']);
  assert.deepEqual(await forgetEntry(db, {}, 'mem-5'), { map: {} });
});

test('the database decides the level of entries that have an item; others keep theirs', async () => {
  const map = { 'mem-1': { itemId: 'i1', rev: 1, hash: 'h' }, 'mem-2': { itemId: 'i2', rev: 1, hash: 'h' }, 'mem-3': { itemId: 'i3', rev: 1, hash: 'h' } };
  const levels = ownLevels([{ itemId: 'i1', visibility: 'team' }, { itemId: 'i2', visibility: 'private' }, { itemId: 'i3', visibility: 'company', archived: true }], map);
  assert.deepEqual(levels, { 'mem-1': 1, 'mem-2': 0 });
  const gov = { ...defaultGov(), skills: { 'mem-2': 2, 'mem-legacy': 1 } };
  const r = applyOwnLevels(gov, levels);
  assert.equal(levelOf(r.gov, 'mem-1'), 1); assert.equal(levelOf(r.gov, 'mem-2'), 0, 'lowered in the database');
  assert.equal(levelOf(r.gov, 'mem-legacy'), 1, 'no item: untouched');
  assert.deepEqual(r.changed.sort(), ['mem-1', 'mem-2']);
  assert.equal(applyOwnLevels(r.gov, levels).gov, r.gov);
});

test('the sync round also reports the person’s own memory items, and the link map survives a reload', async () => {
  const rows = [{ id: 'i1', kind: 'memory', owner: 'Me@X.com', visibility: 'team', current_rev: 1 }, { id: 'i2', kind: 'memory', owner: 'other@x.com', visibility: 'private', current_rev: 1 }];
  const r = await syncShared({ call: async () => rows }, 'me@x.com', []);
  assert.deepEqual(r.own, [{ itemId: 'i1', visibility: 'team', archived: false }]);
  const mem = new Map(); const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  saveShareMap(store, { 'mem-1': { itemId: 'i1', rev: 2, hash: 'h' } });
  assert.deepEqual(loadShareMap(store), { 'mem-1': { itemId: 'i1', rev: 2, hash: 'h' } });
  mem.set('werkbank.memory.itemMap', '{"a":{"itemId":5},"b":{"itemId":"x","rev":1,"hash":"h"}}');
  assert.deepEqual(Object.keys(loadShareMap(store)), ['b']);
});
