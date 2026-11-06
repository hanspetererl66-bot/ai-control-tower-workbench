import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createHttpClient, createMockClient, importFromSmartRecruiters, mapToRecruiting, personalLine } from '../connectors/_lib/server/smartrecruiters.mjs';
import { buildFixture } from '../scripts/smartrecruiters-mock-build.mjs';

const ROOT = join(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/recruiting-workbench/data.json'), 'utf8'));
const fixtureFile = JSON.parse(readFileSync(join(ROOT, 'connectors/_lib/server/smartrecruiters-mock.json'), 'utf8'));

async function run(rpc = async () => ({})) {
  const calls = [];
  const res = await importFromSmartRecruiters({ client: createMockClient(fixtureFile), actor: 'me@x.com', asOf: '2026-11-06', rpc: async (fn, body) => { calls.push({ fn, body }); return rpc(fn, body); } });
  return { res, calls };
}

test('the committed mock fixture is the one the builder produces', () => {
  assert.deepEqual(fixtureFile, JSON.parse(JSON.stringify(buildFixture(data))), 'run: npm run smartrecruiters:mock');
});

test('the mock really carries personal data, so the test below means something', () => {
  const text = JSON.stringify(fixtureFile);
  assert.match(text, /@example\.org/);
  assert.match(text, /firstName/);
  assert.match(text, /phoneNumber/);
});

test('the import sends no name, e-mail, phone or link to the database', async () => {
  const { calls } = await run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'recruiting_import');
  const sent = JSON.stringify(calls[0].body.p_payload);
  assert.doesNotMatch(sent, /@|firstName|lastName|phoneNumber|email|\+49|Kandidat|Beispiel|Muster/i);
  const allowed = new Set(['ref', 'requisitionRef', 'stage', 'stageSince', 'appliedOn', 'years', 'yearsLine', 'cv']);
  for (const c of calls[0].body.p_payload.candidates) for (const k of Object.keys(c)) assert.ok(allowed.has(k), `unexpected field ${k}`);
});

test('the import keeps what the process needs and counts what it left out', async () => {
  const { res, calls } = await run(async () => ({ requisitionsNew: 0, requisitionsUpdated: 6, candidatesNew: 0, candidatesUpdated: 28, candidatesSkipped: 0 }));
  const p = calls[0].body.p_payload;
  assert.equal(p.requisitions.length, 6);
  assert.equal(p.candidates.length, 28, 'hired and rejected candidates are not imported');
  assert.equal(res.dropped.notInProcess, 2);
  assert.equal(res.dropped.personalLines, 1, 'the pasted contact line is dropped');
  assert.equal(res.source, 'mock');
  // Mapped data equals the sample data, so a first import changes nothing.
  for (const c of data.candidates) {
    const m = p.candidates.find((x) => x.ref === `mock-cand-${c.id.slice(2)}`);
    assert.ok(m, c.id);
    assert.deepEqual([m.stage, m.stageSince, m.appliedOn, m.years, m.yearsLine ?? null, m.cv], [c.stage, c.since, c.applied, c.years ?? null, c.yearsLine ?? null, c.cv ?? []], c.id);
  }
  for (const j of data.jobs) {
    const m = p.requisitions.find((x) => x.ref === `mock-job-${j.id.slice(4)}`);
    assert.deepEqual([m.title, m.dept, m.location, m.managerRole, m.openedOn, m.targetDays], [j.title, j.dept, j.location, j.manager, j.opened, j.target], j.id);
  }
});

test('statuses outside the process and bad rows are skipped, not guessed', () => {
  const { payload, dropped } = mapToRecruiting(
    [{ id: 'j1', title: 'Role', createdOn: '2026-10-01T00:00:00Z', department: { label: 'Ops' } }, { id: 'j2', title: 'No date' }],
    { j1: [{ id: 'a', status: 'HIRED' }, { id: 'b', status: 'NEW', appliedOn: '2026-10-02T00:00:00Z', resumeLines: ['Call me 0151 2345 6789', 'x'.repeat(301), 'Forklift licence'] }, { status: 'NEW' }] },
    { asOf: '2026-11-06' },
  );
  assert.equal(payload.requisitions.length, 1);
  assert.equal(dropped.noDate, 1);
  assert.equal(payload.candidates.length, 1);
  assert.equal(dropped.notInProcess, 2);
  assert.deepEqual(payload.candidates[0].cv, ['Forklift licence']);
  assert.equal(dropped.personalLines, 2);
  assert.ok(personalLine('mail me: a@b.de') && personalLine('https://x.y/z') && !personalLine('SAP logistics, 8 years'));
});

test('the HTTP client only talks to smartrecruiters.com, with the key in the documented header', async () => {
  assert.throws(() => createHttpClient({}), /API key/);
  assert.throws(() => createHttpClient({ token: 't', baseUrl: 'https://evil.example' }), /only sent to smartrecruiters\.com/);
  assert.throws(() => createHttpClient({ token: 't', baseUrl: 'http://api.smartrecruiters.com' }), /only sent/);
  const seen = [];
  const c = createHttpClient({ token: 'secret', fetchImpl: async (url, init) => { seen.push({ url: String(url), init }); return { ok: true, json: async () => ({ content: [] }) }; } });
  await c.listJobs(); await c.listCandidates('a/b');
  assert.match(seen[0].url, /^https:\/\/api\.smartrecruiters\.com\/jobs/);
  assert.equal(seen[0].init.headers['X-SmartToken'], 'secret');
  assert.match(seen[1].url, /\/jobs\/a%2Fb\/candidates/);
  const bad = createHttpClient({ token: 'x', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(() => bad.listJobs(), /401/);
});

test('the import needs a database and an e-mail identity', async () => {
  await assert.rejects(() => importFromSmartRecruiters({ client: createMockClient(fixtureFile), actor: 'me@x.com', rpc: null }), /not set up/);
  await assert.rejects(() => importFromSmartRecruiters({ client: createMockClient(fixtureFile), actor: 'nobody', rpc: async () => ({}) }), /e-mail/);
});
