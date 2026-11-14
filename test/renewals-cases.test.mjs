import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { caseReset, caseSave, casesList } from '../connectors/_lib/server/renewals-cases.mjs';
import { createWorkStore } from '../electron/work-store.mjs';
import { handleRenewalsMessage } from '../src/renewals-bridge.ts';

const state = (over = {}) => ({ status: 'running', stage: 'Prepared', log: [{ n: 1, actor: 'Autopilot', step: 'start', text: 'Started.' }], ...over });
const good = (over = {}) => ({ caseId: 'R-C-2026-0012', kind: 'renewal', owner: 'Mira Hoffmann', customer: 'Muster Industrie AG', state: state(), expectedRev: 0, ...over });
const recorder = () => { const calls = []; return { calls, rpc: async (fn, body) => { calls.push({ fn, body }); return { ok: true }; } }; };

test('cases: list, save and reset call the three database functions with the e-mail and the fixed field names', async () => {
  const r = recorder();
  await casesList(r.rpc, 'mira@x.com');
  await caseSave(r.rpc, 'mira@x.com', good({ expectedRev: 3 }));
  await caseReset(r.rpc, 'mira@x.com', { caseId: 'R-C-2026-0012', kind: 'winback' });
  assert.deepEqual(r.calls.map((c) => c.fn), ['renewals_cases_list', 'renewals_case_save', 'renewals_case_reset']);
  assert.deepEqual(r.calls[0].body, { p_actor: 'mira@x.com' });
  assert.deepEqual(Object.keys(r.calls[1].body).sort(), ['p_actor', 'p_case', 'p_customer', 'p_expected_rev', 'p_kind', 'p_owner', 'p_state']);
  assert.equal(r.calls[1].body.p_expected_rev, 3);
  assert.deepEqual(r.calls[2].body, { p_actor: 'mira@x.com', p_case: 'R-C-2026-0012', p_kind: 'winback' });
});

test('cases: a bad request is refused before it leaves the app', async () => {
  const r = recorder();
  const bad = (args, re) => assert.rejects(caseSave(r.rpc, 'a@b.co', args), re);
  await bad(good({ caseId: 'x1' }), /invalid case id/);
  await bad(good({ kind: 'other' }), /kind/);
  await bad(good({ owner: '' }), /owner/);
  await bad(good({ state: 'x' }), /object/);
  await bad(good({ state: state({ status: 'weird' }) }), /invalid status/);
  await bad(good({ state: state({ log: 'x' }) }), /log/);
  await bad(good({ state: state({ log: Array.from({ length: 61 }, (_, i) => ({ n: i + 1, actor: 'A', text: 'x' })) }) }), /at most 60/);
  await bad(good({ state: state({ log: [{ n: 1, actor: 'A', text: 'x'.repeat(601) }] }) }), /not valid/);
  await bad(good({ state: state({ blob: 'x'.repeat(70000) }) }), /too large/);
  await bad(good({ expectedRev: -1 }), /expectedRev/);
  await bad(good({ expectedRev: 1.5 }), /expectedRev/);
  await assert.rejects(caseReset(r.rpc, 'a@b.co', { caseId: 'R-1', kind: 'nope' }), /kind/);
  await assert.rejects(caseSave(r.rpc, 'a@b.co', null), /invalid case id/);
  assert.equal(r.calls.length, 0, 'nothing reached the database');
  await caseSave(r.rpc, 'a@b.co', good({ expectedRev: undefined }));
  assert.equal(r.calls[0].body.p_expected_rev, 0, 'a new case starts at revision 0');
});

function database(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body || '{}'); seen.push({ url: req.url, key: req.headers.apikey, body: b });
      const out = handler(req.url, b);
      res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out.json ?? {}));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
const file = () => join(mkdtempSync(join(tmpdir(), 'renewals-store-')), 'work-sync.json');

test('work store: the person is the stored e-mail, the key stays in the main process, a revision conflict comes back readable', async () => {
  const db = await database((url) => (url.endsWith('renewals_case_save') ? { status: 400, json: { code: 'P0001', message: 'conflict: this case was changed elsewhere, reload' } } : { json: { me: {}, cases: [] } }));
  try {
    const store = createWorkStore({ file: file(), readConnector: () => ({ url: db.url, key: 'secret-1' }) });
    await assert.rejects(store.renewalsCases(), /e-mail/);
    store.setEmail('mira.hoffmann@renewals.example');
    await store.renewalsCases();
    assert.match(db.seen[0].url, /rpc\/renewals_cases_list$/);
    assert.equal(db.seen[0].key, 'secret-1');
    assert.equal(db.seen[0].body.p_actor, 'mira.hoffmann@renewals.example');
    await assert.rejects(store.renewalsCaseSave({ ...good(), actor: 'someone@else.com' }), /changed elsewhere/);
    assert.equal(db.seen[1].body.p_actor, 'mira.hoffmann@renewals.example', 'the page cannot name another person');
    assert.equal(JSON.stringify(db.seen).includes('someone@else.com'), false);
  } finally { db.close(); }
  const none = createWorkStore({ file: file(), readConnector: () => null });
  none.setEmail('a@b.co');
  await assert.rejects(none.renewalsCases(), /not set up/);
});

const req = (over = {}) => ({ type: 'rn:cases-request', requestId: 'c1', action: 'list', ...over });
const deps = () => {
  const seen = [];
  return { seen, cases: { list: async () => (seen.push(['list']), { ok: true, data: { cases: [] } }), save: async (a) => (seen.push(['save', a]), { ok: true, data: { rev: 2 } }), reset: async (a) => (seen.push(['reset', a]), { ok: false, error: 'you may not change this case' }) } };
};

test('bridge: cases are listed, saved and reset through the host, and only the fixed fields go on', async () => {
  const d = deps();
  assert.deepEqual(await handleRenewalsMessage(req(), d), { type: 'rn:cases-answer', requestId: 'c1', action: 'list', ok: true, data: { cases: [] } });
  const s = await handleRenewalsMessage(req({ action: 'save', ...good(), actor: 'x@y.com', email: 'x@y.com', extra: 1 }), d);
  assert.equal(s.ok, true);
  assert.deepEqual(Object.keys(d.seen[1][1]).sort(), ['caseId', 'customer', 'expectedRev', 'kind', 'owner', 'state'], 'no person and no extra field is passed on');
  const r = await handleRenewalsMessage(req({ action: 'reset', caseId: 'R-C-2026-0012', kind: 'renewal', owner: 'x' }), d);
  assert.deepEqual(r, { type: 'rn:cases-answer', requestId: 'c1', action: 'reset', ok: false, error: 'you may not change this case' });
  assert.deepEqual(Object.keys(d.seen[2][1]).sort(), ['caseId', 'kind']);
});

test('bridge: without the host, with an unknown action, a bad id, a too large case or a host error, the page gets a reason (or nothing)', async () => {
  const d = deps();
  const noHost = await handleRenewalsMessage(req(), {});
  assert.equal(noHost.ok, false);
  assert.match(noHost.error, /Werkbank app/);
  assert.equal((await handleRenewalsMessage(req({ action: 'delete' }), d)).ok, false);
  assert.equal(await handleRenewalsMessage(req({ requestId: 'bad id!' }), d), null);
  const big = await handleRenewalsMessage(req({ action: 'save', ...good({ state: state({ blob: 'x'.repeat(120000) }) }) }), d);
  assert.match(big.error, /too large/);
  const boom = await handleRenewalsMessage(req(), { cases: { list: async () => { throw new Error('socket closed'); } } });
  assert.deepEqual([boom.ok, boom.error], [false, 'socket closed']);
  assert.equal(d.seen.length, 0, 'refused requests never reach the host');
});
