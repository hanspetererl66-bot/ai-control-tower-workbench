import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGovernanceSync, createSharedGovernance } from '../electron/ontology-shared.mjs';
import { createOntologyStore, normalizeGovernance } from '../electron/ontology-store.mjs';

/** A stand-in for the database with the same rules as migration 026 (revision check, conflict = nothing written). */
function fakeDatabase() {
  const db = { rev: 0, data: {}, by: '', down: false, log: [] };
  const rpc = async (fn, body) => {
    if (db.down) throw new Error('fetch failed');
    if (fn === 'ontology_governance_get') return { rev: db.rev, data: db.data, updatedBy: db.by, updatedAt: null };
    if (body.p_base_rev !== db.rev) return { conflict: true, rev: db.rev, data: db.data, updatedBy: db.by };
    db.rev += 1; db.data = body.p_data; db.by = body.p_actor; db.log.push(db.rev);
    return { conflict: false, rev: db.rev, data: db.data, updatedBy: db.by };
  };
  return { db, rpc };
}

function person(rpc, email = 'a@x.com', folder = mkdtempSync(join(tmpdir(), 'ontoshared-'))) {
  mkdirSync(join(folder, 'ontologies'), { recursive: true });
  writeFileSync(join(folder, 'ontologies', 'catalog.json'), '{"ontologies":[]}');
  const store = createOntologyStore({ readSettings: () => ({ folder }) });
  const shared = createSharedGovernance({ credentials: () => ({ url: 'https://x.supabase.co', key: 'k', email }), rpcImpl: rpc });
  return { folder, store, sync: createGovernanceSync({ store, shared }), file: join(folder, 'ontologies', 'governance.json') };
}
const gov = (owner) => ({ ontologies: { werkbank_fin: { owner, domain: 'Finance', approver: '' } } });

test('a save goes to the file and to the database; the second person sees it when the view opens', async () => {
  const { db, rpc } = fakeDatabase();
  const anna = person(rpc, 'anna@x.com');
  const res = await anna.sync.save(gov('Anna'));
  assert.equal(res.state, 'synced');
  assert.equal(db.rev, 1);
  assert.equal(db.by, 'anna@x.com');
  const ben = person(rpc, 'ben@x.com');
  const open = await ben.sync.open();
  assert.equal(open.state, 'synced');
  assert.equal(open.governance.ontologies.werkbank_fin.owner, 'Anna');
  assert.equal(JSON.parse(readFileSync(ben.file, 'utf8')).ontologies.werkbank_fin.owner, 'Anna');
});

test('with nothing shared yet, opening uploads the local file once; an empty local file uploads nothing', async () => {
  const { db, rpc } = fakeDatabase();
  const empty = person(rpc);
  assert.equal((await empty.sync.open()).state, 'synced');
  assert.equal(db.rev, 0);
  const p = person(rpc);
  p.store.saveGovernance(gov('Local'));
  assert.equal((await p.sync.open()).rev, 1);
  assert.equal(db.data.ontologies.werkbank_fin.owner, 'Local');
  assert.equal((await p.sync.open()).rev, 1);
  assert.equal(db.rev, 1, 'a second open does not save again');
});

test('somebody saved first: nothing is overwritten, their version is loaded, ours is kept as a local copy', async () => {
  const { db, rpc } = fakeDatabase();
  const anna = person(rpc, 'anna@x.com');
  const ben = person(rpc, 'ben@x.com');
  await anna.sync.save(gov('Anna'));
  await ben.sync.open();
  await anna.sync.save(gov('Anna 2'));           // rev 2
  const res = await ben.sync.save(gov('Ben'));   // Ben still based on rev 1
  assert.equal(res.state, 'conflict');
  assert.equal(res.governance.ontologies.werkbank_fin.owner, 'Anna 2');
  assert.equal(db.rev, 2, 'the database was not overwritten');
  const copy = JSON.parse(readFileSync(join(ben.folder, 'ontologies', 'governance.local-copy.json'), 'utf8'));
  assert.equal(copy.ontologies.werkbank_fin.owner, 'Ben');
  assert.equal(JSON.parse(readFileSync(ben.file, 'utf8')).ontologies.werkbank_fin.owner, 'Anna 2');
});

test('when the database is down the file still has the change; it is uploaded on the next open, or kept as a copy on a clash', async () => {
  const { db, rpc } = fakeDatabase();
  const anna = person(rpc, 'anna@x.com');
  await anna.sync.save(gov('Anna'));
  db.down = true;
  const offline = await anna.sync.save(gov('Anna offline'));
  assert.equal(offline.ok, true);
  assert.equal(offline.state, 'local');
  assert.equal(JSON.parse(readFileSync(anna.file, 'utf8')).ontologies.werkbank_fin.owner, 'Anna offline');
  assert.equal((await anna.sync.open()).state, 'local');
  db.down = false;
  const back = await anna.sync.open();
  assert.equal(back.state, 'synced');
  assert.equal(db.data.ontologies.werkbank_fin.owner, 'Anna offline');
  // offline edit + a newer shared revision = a clash, the shared one wins and the offline edit stays as a copy
  db.down = true; await anna.sync.save(gov('Offline again')); db.down = false;
  db.rev += 1; db.data = normalizeGovernance(gov('Ben'));
  const clash = await anna.sync.open();
  assert.equal(clash.state, 'conflict');
  assert.ok(existsSync(join(anna.folder, 'ontologies', 'governance.local-copy.json')));
  assert.equal(clash.governance.ontologies.werkbank_fin.owner, 'Ben');
});

test('without database settings or e-mail the shared part says so and the local part keeps working', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ontoshared-'));
  mkdirSync(join(folder, 'ontologies'));
  writeFileSync(join(folder, 'ontologies', 'catalog.json'), '{"ontologies":[]}');
  const store = createOntologyStore({ readSettings: () => ({ folder }) });
  const sync = createGovernanceSync({ store, shared: createSharedGovernance({ credentials: () => null }) });
  const res = await sync.save(gov('Solo'));
  assert.equal(res.ok, true);
  assert.equal(res.state, 'local');
  assert.match(res.detail, /not set up/);
  assert.equal(store.read().governance.ontologies.werkbank_fin.owner, 'Solo');
});

test('the window can only sync and save: no key, no path, and the wiring is in main and preload', () => {
  const root = join(import.meta.dirname, '..');
  const main = readFileSync(join(root, 'electron/main.mjs'), 'utf8');
  assert.match(main, /ontology-governance-sync/);
  assert.match(main, /ontologySync\.save\(governance\)/);
  assert.match(readFileSync(join(root, 'electron/preload.cjs'), 'utf8'), /ontologyGovernanceSync/);
  const sql = readFileSync(join(root, 'supabase/migrations/20261105_026_ontology_governance.sql'), 'utf8');
  assert.match(sql, /grant execute on function public\.ontology_governance_set\(text, integer, jsonb\) to service_role/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated|public)\b/);
});

// Real Postgres (throw-away database named *_test, see skill-lifecycle-sql.test.mjs)
const dsn = process.env.SKILL_SQL_TEST_DSN?.trim();
const dbName = (() => { try { return new URL(dsn).pathname.slice(1); } catch { return ''; } })();
const skip = !dsn ? 'set SKILL_SQL_TEST_DSN to a throw-away database' : /^[a-z0-9_]*_test$/.test(dbName) ? false : 'database is not named *_test';
test('migration 026 in real Postgres: revisions, conflict, closed to the public, append only', { skip }, () => {
  const psql = (sql) => execFileSync('psql', [dsn, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('psql', [dsn, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', 'drop schema if exists werkbank cascade', '-f', join(import.meta.dirname, '..', 'supabase/migrations/20261105_026_ontology_governance.sql')], { stdio: 'pipe' });
  assert.equal(JSON.parse(psql("select public.ontology_governance_get('a@x.com')")).rev, 0);
  assert.equal(JSON.parse(psql(`select public.ontology_governance_set('a@x.com', 0, '{"v":1}')`)).conflict, false);
  const clash = JSON.parse(psql(`select public.ontology_governance_set('b@x.com', 0, '{"v":2}')`));
  assert.equal(clash.conflict, true);
  assert.equal(clash.data.v, 1);
  assert.throws(() => psql("update werkbank.ontology_governance_rev set data = '{}'"), /cannot be changed/);
  assert.throws(() => psql("select public.ontology_governance_get('not-an-email')"), /e-mail/);
});
