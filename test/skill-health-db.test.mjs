import assert from 'node:assert/strict';
import test from 'node:test';
import { createSkillStore } from '../electron/skill-store.mjs';
import { exampleCatalog, healthOf } from '../src/skill-health.ts';
import { catalogFromDatabase, levelOf, lifecycleCalls, skillsFromRows } from '../src/skill-health-db.ts';

const NOW = Date.parse('2026-11-04T10:00:00Z');
const rows = [
  { slug: 'invoice-summary', description: 'Summarise invoices', owner: 'a@x.com', scope: 'company', state: 'published', team: 'Finance', createdAt: '2026-01-02T00:00:00Z', uses30: 5, uses90: 12, devices90: 4, lastUsedAt: '2026-11-01T00:00:00Z' },
  { slug: 'old-thing', description: 'Old', owner: '', scope: 'individual', state: 'draft', uses30: 0, uses90: 0, devices90: 0, lastUsedAt: null },
  { slug: 'team-skill', description: 'Team', owner: 'b@x.com', scope: 'team', state: 'deprecated', team: 'Sales', sunsetAt: '2026-12-01', replacedBy: 'invoice-summary' },
  { nope: true }, null,
];

test('database rows become catalog skills', () => {
  const s = skillsFromRows(rows, [], NOW);
  assert.equal(s.length, 3);
  assert.deepEqual([s[0].level, s[0].department, s[0].uses90, s[0].users90, s[0].state], [2, 'Finance', 12, 4, 'active']);
  assert.equal(s[0].lastUsed, Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(s[1].lastUsed, null);
  assert.equal(s[2].state, 'deprecated');
  assert.equal(s[2].sunsetAt, Date.parse('2026-12-01'));
  assert.equal(s[2].replacedBy, 'invoice-summary');
  assert.equal(levelOf('team'), 1);
  assert.deepEqual(skillsFromRows('x'), []);
});

test('catalog from database keeps policy, log and local review dates, drops example skills', () => {
  const ex = exampleCatalog(NOW);
  const first = catalogFromDatabase({ ...ex, skills: [], log: [] }, rows, NOW);
  const reviewed = { ...first, skills: first.skills.map((s) => (s.id === 'old-thing' ? { ...s, reviewedAt: 123 } : s)), log: [{ id: 'l', at: 1, actor: 'x', action: 'a', ids: [], note: '' }] };
  const again = catalogFromDatabase(reviewed, rows, NOW);
  assert.equal(again.skills.find((s) => s.id === 'old-thing').reviewedAt, 123);
  assert.equal(again.log.length, 1);
  assert.equal(again.policy.unusedDays, ex.policy.unusedDays);
  assert.deepEqual(again.people.sort(), ['a@x.com', 'b@x.com']);
  assert.equal(healthOf(again.skills.find((s) => s.id === 'old-thing'), again, NOW), 'orphan');
});

test('only state changes become database calls', () => {
  const cat = catalogFromDatabase({ ...exampleCatalog(NOW), skills: [], log: [] }, rows, NOW);
  const next = { ...cat, skills: cat.skills.map((s) => {
    if (s.id === 'invoice-summary') return { ...s, state: 'deprecated', sunsetAt: NOW + 30 * 86_400_000, replacedBy: 'team-skill' };
    if (s.id === 'old-thing') return { ...s, state: 'deprecated', reviewedAt: 5 };
    if (s.id === 'team-skill') return { ...s, state: 'active' };
    return s;
  }) };
  const calls = lifecycleCalls(cat, next, NOW);
  assert.deepEqual(calls.map((c) => [c.slug, c.action]), [['invoice-summary', 'deprecate'], ['old-thing', 'retire'], ['team-skill', 'restore']]);
  assert.equal(calls[0].sunsetAt, '2026-12-04');
  assert.equal(calls[0].replacedBy, 'team-skill');
  assert.deepEqual(lifecycleCalls(cat, { ...cat, skills: cat.skills.map((s) => ({ ...s, reviewedAt: 9, owner: 'z' })) }, NOW), []);
});

test('store reads the health overview and changes the lifecycle with the e-mail as actor', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify(String(url).includes('overview') ? { skills: [{ slug: 'a' }] } : { ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const store = createSkillStore({ credentials: () => ({ url: 'https://db.example', key: 'k', email: 'me@x.com' }), skillsDir: '/tmp/none', fetchImpl });
  const h = await store.health();
  assert.equal(h.ok, true);
  assert.equal(h.data.skills.length, 1);
  assert.match(seen[0].url, /skills_health_overview$/);
  assert.equal(seen[0].body.p_actor, 'me@x.com');
  const l = await store.lifecycle({ slug: 'a', action: 'retire', reason: 'why' });
  assert.equal(l.ok, true);
  assert.equal(seen[1].body.p_action, 'retire');
  assert.equal((await store.lifecycle({ slug: 'a', action: 'delete' })).ok, false);
});
