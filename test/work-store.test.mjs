import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkStore } from '../electron/work-store.mjs';

function database(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers.apikey, body: JSON.parse(body || '{}') });
      const out = handler(req.url, JSON.parse(body || '{}'));
      res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out.json ?? []));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
const dir = () => join(mkdtempSync(join(tmpdir(), 'work-store-')), 'work-sync.json');

test('status: needs the database access and an e-mail; the e-mail is checked and stored', () => {
  const store = createWorkStore({ file: dir(), readConnector: () => null });
  assert.deepEqual(store.status(), { configured: false, email: '', source: '' });
  assert.equal(store.setEmail('not an email').ok, false);
  assert.equal(store.setEmail('  Anna.Berger@Example.com ').email, 'anna.berger@example.com');
  assert.equal(store.status().email, 'anna.berger@example.com');
  const second = createWorkStore({ file: store && dir(), readConnector: (n) => (n === 'skill-marketplace' ? { url: 'https://x.supabase.co', key: 'k' } : { url: '', key: '' }) });
  assert.deepEqual(second.status(), { configured: true, email: '', source: 'skill-marketplace' });
});

test('a call names the person by the stored e-mail, uses the key, and cannot reach other functions', async () => {
  const db = await database(() => ({ json: [] }));
  try {
    const store = createWorkStore({ file: dir(), readConnector: (n) => (n === 'werkbank-workspace' ? { url: db.url, key: 'secret-key-1' } : null) });
    await assert.rejects(store.call('list_work_items', {}), /e-mail/);
    store.setEmail('anna@example.com');
    await store.call('list_work_items', { actor: 'someone.else@example.com', include_archived: true });
    assert.equal(db.seen.length, 1);
    assert.match(db.seen[0].url, /\/rest\/v1\/rpc\/work_list$/);
    assert.equal(db.seen[0].key, 'secret-key-1');
    assert.equal(db.seen[0].body.p_actor, 'anna@example.com', 'the page cannot name another person');
    assert.equal(db.seen[0].body.p_include_archived, true);
    await assert.rejects(store.call('skills_list', {}), /not allowed/);
    await assert.rejects(store.call('save_work_item', { kind: 'agent', name: 'x', files: [{ path: 'a.md', content: 'password: abcdefgh1234' }] }), /credential/);
    assert.equal(db.seen.length, 1, 'a refused save never reaches the database');
  } finally { db.close(); }
});

test('rules of the database come back as readable text; no access means a clear message', async () => {
  const db = await database(() => ({ status: 400, json: { code: 'P0001', message: 'The item was changed meanwhile (now revision 4).' } }));
  try {
    const store = createWorkStore({ file: dir(), readConnector: () => ({ url: db.url, key: 'k' }) });
    store.setEmail('anna@example.com');
    await assert.rejects(store.call('save_work_item', { id: '11111111-1111-4111-8111-111111111111', kind: 'agent', name: 'x', expected_rev: 1, files: [{ path: 'a.md', content: 'ok' }] }), /changed meanwhile/);
  } finally { db.close(); }
  const none = createWorkStore({ file: dir(), readConnector: () => null });
  none.setEmail('a@b.co');
  await assert.rejects(none.call('list_work_items', {}), /not set up/);
});

test('the window gets only the three calls, never the key', () => {
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /workStatus/); assert.match(preload, /workSetEmail/); assert.match(preload, /workCall/);
  const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(main.slice(main.indexOf("ipcMain.handle('work-status'"), main.indexOf("ipcMain.handle('work-call'") + 400), /return \{[^}]*key[^}]*\}/, 'status does not return the key');
});
