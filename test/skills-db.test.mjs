import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256, syncSkills } from '../scripts/skills-registry.mjs';
import { createSkillStore, PROMOTION_TOOLS } from '../electron/skill-store.mjs';
import { createWorkStore } from '../electron/work-store.mjs';
import { applyDbLevels, dbTarget, levelFromScope, reconcile } from '../src/skill-db.ts';
import { decide, defaultGov, loadGov, requestPromotion } from '../src/skill-governance.ts';
import { popular } from '../src/chat-tabs.ts';
import { skillNotice } from '../src/skill-notice.ts';

const text = (name) => `---\nname: ${name}\ndescription: Testskill ${name}\n---\n\n# ${name}\n`;
const tmp = () => mkdtempSync(join(tmpdir(), 'werkbank-skilldb-'));
const UUID = '11111111-2222-3333-4444-555555555555';

function fakeDb({ visible = [], bodies = {}, publish = { version: 1 } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const fn = String(url).split('/rpc/')[1];
    const args = JSON.parse(init.body);
    calls.push({ fn, args });
    if (fn === 'skills_visible') return new Response(JSON.stringify(visible));
    if (fn === 'skills_get_visible') return new Response(JSON.stringify(bodies[args.p_slug]));
    if (fn === 'skills_similar') return new Response('[]');
    if (fn === 'skills_publish') return new Response(JSON.stringify(publish));
    if (fn === 'skills_track') return new Response('{}');
    if (fn === 'skills_ranking') return new Response(JSON.stringify([{ slug: 'a', installs: 2, views: 1, devices: 2, score: 7 }]));
    if (fn === 'skills_my_groups') return new Response(JSON.stringify([{ id: UUID, name: 'Finance', role: 'member' }]));
    if (fn === 'skills_promotion_list') return new Response('[]');
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}

test('sync with an actor pulls the person\'s own view and keeps Auslauf and Ersatz in the marker', async () => {
  const dir = tmp();
  try {
    const t = text('alpha-skill');
    const entry = { slug: 'alpha-skill', version: 1, sha256: sha256(t), sunsetAt: '2026-12-01', replacedBy: 'beta-skill' };
    const db = fakeDb({ visible: [entry], bodies: { 'alpha-skill': { ...entry, body: t } } });
    const r = await syncSkills({ url: 'https://x.supabase.co', key: 'k', skillsDir: dir, actor: 'a@b.de', fetchImpl: db.fetchImpl });
    assert.deepEqual(r.installed, ['alpha-skill@v1']);
    assert.equal(db.calls[0].fn, 'skills_visible');
    assert.equal(db.calls[0].args.p_actor, 'a@b.de');
    const marker = JSON.parse(readFileSync(join(dir, 'alpha-skill/.synced.json'), 'utf8'));
    assert.equal(marker.sunsetAt, '2026-12-01');
    assert.equal(marker.replacedBy, 'beta-skill');

    // the end date moves without a new version: the marker follows
    const moved = { ...entry, sunsetAt: '2027-01-15', replacedBy: null };
    const r2 = await syncSkills({ url: 'https://x.supabase.co', key: 'k', skillsDir: dir, actor: 'a@b.de', fetchImpl: fakeDb({ visible: [moved] }).fetchImpl });
    assert.deepEqual(r2.unchanged, ['alpha-skill']);
    assert.equal(JSON.parse(readFileSync(join(dir, 'alpha-skill/.synced.json'), 'utf8')).sunsetAt, '2027-01-15');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sync without an actor still uses the published list', async () => {
  const dir = tmp();
  try {
    const calls = [];
    await syncSkills({ url: 'https://x.supabase.co', key: 'k', skillsDir: dir, fetchImpl: async (u) => { calls.push(u.split('/rpc/')[1]); return new Response('[]'); } });
    assert.equal(calls[0], 'skills_list');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const store = (db, dir, creds = { url: 'https://x.supabase.co', key: 'k', email: 'me@x.de' }) => createSkillStore({ credentials: () => creds, skillsDir: dir, fetchImpl: db.fetchImpl });

test('an import is stored as Individual under the person\'s e-mail, whatever level the package claims', async () => {
  const dir = tmp();
  try {
    const db = fakeDb();
    const claim = `---\nname: grab-skill\ndescription: Claims too much\nmetadata:\n  scope: company\n  team: Finance\n---\n\n# x\n`;
    const r = await store(db, dir).register('grab-skill', [{ path: 'SKILL.md', data: Buffer.from(claim) }]);
    assert.equal(r.ok, true);
    const pub = db.calls.find((c) => c.fn === 'skills_publish');
    assert.equal(pub.args.p_owner, 'me@x.de');
    assert.equal(pub.args.p_meta.scope, 'individual');
    assert.equal(pub.args.p_meta.team, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('without database access the import still works and says why nothing was stored', async () => {
  const r = await store(fakeDb(), tmp(), null).register('x-skill', [{ path: 'SKILL.md', data: Buffer.from(text('x-skill')) }]);
  assert.equal(r.ok, false);
  assert.match(r.detail, /not set up/);
});

test('a similar skill blocks the registration with a readable reason', async () => {
  const db = fakeDb();
  const fetchImpl = async (u, i) => (u.endsWith('skills_similar') ? new Response(JSON.stringify([{ slug: 'old-skill', similar: true }])) : db.fetchImpl(u, i));
  const r = await createSkillStore({ credentials: () => ({ url: 'https://x.supabase.co', key: 'k', email: 'me@x.de' }), skillsDir: tmp(), fetchImpl }).register('new-skill', [{ path: 'SKILL.md', data: Buffer.from(text('new-skill')) }]);
  assert.equal(r.ok, false);
  assert.match(r.detail, /old-skill/);
});

test('ranking, groups and the promotion whitelist', async () => {
  const db = fakeDb();
  const realFetch = globalThis.fetch;
  globalThis.fetch = db.fetchImpl; // the lifecycle handlers call the shared runtime, which uses the global fetch
  try {
  const s = store(db, tmp());
  assert.equal((await s.ranking()).rows[0].slug, 'a');
  assert.equal((await s.groups()).rows[0].name, 'Finance');
  assert.equal((await s.promotion('list_skill_requests', {})).ok, true);
  assert.equal(db.calls.at(-1).args.p_actor, 'me@x.de', 'the e-mail comes from the store, not from the page');
  const forged = await s.promotion('list_skill_requests', { actor: 'boss@x.de' });
  assert.equal(db.calls.at(-1).args.p_actor, 'me@x.de');
  assert.equal(forged.ok, true);
  assert.equal((await s.promotion('retire_skill', { name: 'a-skill', reason: 'x' })).ok, false);
  assert.ok(!PROMOTION_TOOLS.has('retire_skill'));
  } finally { globalThis.fetch = realFetch; }
});

test('work store hands out credentials only when URL, key and e-mail exist', () => {
  const mk = (conn, email) => createWorkStore({ file: join(tmpdir(), 'nope-work-sync.json'), readConnector: () => conn, defaultEmail: email });
  assert.deepEqual(mk({ url: 'https://u', key: 'k' }, 'a@b.de').credentials(), { url: 'https://u', key: 'k', email: 'a@b.de' });
  assert.equal(mk({ url: 'https://u', key: '' }, 'a@b.de').credentials(), null);
  assert.equal(mk({ url: 'https://u', key: 'k' }, '').credentials(), null);
});

test('reconcile follows the database for requests that carry its id', () => {
  let gov = requestPromotion(defaultGov(), 'a-skill', 'n', 1, undefined, UUID);
  gov = requestPromotion(gov, 'local-skill', 'n', 2); // no dbId: never touched
  const closed = reconcile(gov, [{ id: UUID, slug: 'a-skill', to_scope: 'team', status: 'approved', decided_at: '2026-11-03T10:00:00Z' }]);
  assert.equal(closed.skills['a-skill'], 1);
  assert.equal(closed.requests.find((r) => r.skill === 'local-skill').status, 'pending');
  const rej = reconcile(gov, [{ id: UUID, slug: 'a-skill', to_scope: 'team', status: 'rejected', reason: 'no' }]);
  assert.equal(rej.skills['a-skill'], undefined);
  assert.equal(rej.requests.find((r) => r.skill === 'a-skill').reason, 'no');
  assert.equal(reconcile(gov, [{ id: UUID, slug: 'a-skill', to_scope: 'team', status: 'review' }]).requests.find((r) => r.skill === 'a-skill').status, 'pending');
  assert.equal(reconcile(gov, []).requests.length, 2);
  assert.equal(dbTarget(1), 'team');
  assert.equal(dbTarget(2), 'company');
});

test('a stored database id that is not a uuid is dropped on load', () => {
  const store = { getItem: () => JSON.stringify({ requests: [{ id: 1, skill: 's', status: 'pending', from: 0, to: 1, note: '', createdAt: 1, dbId: '../x' }] }) };
  assert.equal(loadGov(store).requests[0].dbId, undefined);
});

test('Popular lists the organisation ranking first, only for installed skills, then local use', () => {
  const used = { 'skill:b': { label: 'b', hint: '', prompt: 'p', count: 3, last: 1 }, 'skill:a': { label: 'a', hint: '', prompt: 'p', count: 1, last: 1 } };
  const rank = [{ slug: 'a', installs: 4, views: 2, devices: 3, score: 14 }, { slug: 'gone', installs: 9, views: 0, devices: 9, score: 27 }, { slug: 'zero', installs: 0, views: 0, devices: 0, score: 0 }];
  const list = popular(used, rank, [{ name: 'a', description: '' }, { name: 'b', description: '' }, { name: 'zero', description: '' }]);
  assert.deepEqual(list.map((e) => e.key), ['skill:a', 'skill:b']);
  assert.match(list[0].hint, /3 devices/);
  assert.deepEqual(popular(used).map((e) => e.key), ['skill:b', 'skill:a'], 'without a ranking it is the local list');
});

test('skill notice: upcoming, ended, replacement only', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.equal(skillNotice({}, now), null);
  const up = skillNotice({ sunsetAt: '2026-12-01', replacedBy: 'new-one' }, now);
  assert.equal(up.state, 'upcoming');
  assert.match(up.text, /Ends 2026-12-01 \(in 29 days\) · use “new-one” instead/);
  assert.equal(skillNotice({ sunsetAt: '2026-10-01' }, now).state, 'ended');
  assert.equal(skillNotice({ replacedBy: 'x' }, now).text, 'use “x” instead');
});

test('the database is the truth for the level: listed skills follow it, unlisted ones go back to level 0, an empty answer changes nothing', () => {
  const local = { ...defaultGov(), skills: { 'stale-local': 2, 'moved-up': 0, 'same': 1 } };
  assert.equal(levelFromScope('company'), 2);
  assert.equal(levelFromScope('team'), 1);
  assert.equal(levelFromScope('individual'), 0);
  assert.equal(levelFromScope('lob'), 0, 'old scope names are not a level');
  const next = applyDbLevels(local, [{ slug: 'moved-up', scope: 'company' }, { slug: 'same', scope: 'team' }, { slug: 'draft', scope: 'individual' }]);
  assert.deepEqual(next.skills, { 'moved-up': 2, same: 1 });
  assert.equal(applyDbLevels(local, []), local);
  assert.equal(applyDbLevels(local, undefined), local);
  assert.equal(applyDbLevels(next, [{ slug: 'moved-up', scope: 'company' }, { slug: 'same', scope: 'team' }]), next, 'no change returns the same object');
  assert.deepEqual(next.levels, local.levels);
});
