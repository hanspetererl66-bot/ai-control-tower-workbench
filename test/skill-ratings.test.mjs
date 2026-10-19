import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createSkillRatingHandlers, raterId, summarise } from '../connectors/control-tower/server/skill-ratings.mjs';
import { extractMarketplaceData } from '../connectors/control-tower/server/skill-profiles.mjs';
import { ToolError } from '../connectors/control-tower/server/tools.mjs';
import { buildRatingsSql, sampleRows } from '../scripts/sync-skill-ratings.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const ratings = JSON.parse(read('examples/skill-marketplace/ratings.json'));
const page = extractMarketplaceData(read('examples/skill-marketplace/index.html'));

test('migration 013 and the embedded Space data match ratings.json', () => {
  assert.equal(buildRatingsSql(ratings), read('supabase/migrations/20261019_013_skill_ratings.sql'), 'run: npm run sync:skill-ratings');
  assert.deepEqual(page.ratings, { settings: ratings.settings, skills: ratings.skills }, 'run: npm run sync:skill-marketplace');
});

test('sample ratings: every skill, comments fit the distribution, profile numbers agree', () => {
  assert.deepEqual(Object.keys(ratings.skills).sort(), page.skills.filter((s) => page.profiles[s.name]).map((s) => s.name).sort());
  for (const [name, r] of Object.entries(ratings.skills)) {
    assert.equal(r.distribution.length, 5, name);
    const s = summarise(r.distribution, ratings.settings);
    const p = page.profiles[name].impact;
    assert.equal(p.ratings, s.count, `${name}: profile rating count`);
    assert.equal(p.avgRating, Math.round(s.average * 10) / 10, `${name}: profile average`);
    const used = [0, 0, 0, 0, 0];
    for (const c of r.comments) { used[c.stars - 1]++; assert.ok(c.text.length <= 280 && c.date && c.version, name); }
    used.forEach((n, i) => assert.ok(n <= r.distribution[i], `${name}: ${n} comments with ${i + 1} stars but only ${r.distribution[i]} ratings`));
  }
  assert.equal(sampleRows(ratings).length, Object.values(ratings.skills).reduce((a, r) => a + r.distribution.reduce((x, y) => x + y, 0), 0));
  assert.ok(Object.values(ratings.skills).some((r) => summarise(r.distribution, ratings.settings).enough === false), 'at least one skill shows as new');
});

test('summarise damps small samples and marks new skills', () => {
  const few = summarise([0, 0, 0, 0, 2], ratings.settings);
  const many = summarise([0, 1, 1, 2, 36], ratings.settings);
  assert.equal(few.average, 5);
  assert.ok(few.score < many.score, 'two five-star votes do not beat forty votes at 4.6');
  assert.equal(few.enough, false);
  assert.match(few.label, /new/);
  assert.equal(summarise([0, 0, 0, 0, 0]).label, 'not rated yet');
  assert.equal(summarise([1, 0, 0, 0, 4], ratings.settings).average, 4.2);
  assert.match(many.label, /^4\.\d of 5 \(40 ratings\)$/);
});

test('skill recommendations carry the rating', async () => {
  const { createSkillProfileHandlers } = await import('../connectors/control-tower/server/skill-profiles.mjs');
  const h = createSkillProfileHandlers(() => page);
  const r = await h.recommend_skills({ role: 'Account Executive' });
  assert.ok(r.skills.every((s) => /of 5|new|not rated/.test(s.rating)));
  const w = await h.recommend_skill_workflow({ role: 'Account Manager', goal: 'Kundentermin Verlängerung' });
  assert.match(w.workflows[0].steps[0].rating, /of 5/);
});

test('raterId is stable, anonymous and overridable', () => {
  const a = raterId();
  assert.equal(a, raterId());
  assert.match(a, /^[0-9a-f]{32}$/);
  process.env.SKILL_RATER_ID = 'someone-else';
  try { assert.notEqual(raterId(), a); } finally { delete process.env.SKILL_RATER_ID; }
});

test('get_skill_ratings: ranking and detail from sample data, live overlay from Supabase', async () => {
  const h = createSkillRatingHandlers(() => page);
  const r = await h.get_skill_ratings({ limit: 5 });
  assert.equal(r.ranking.length, 5);
  assert.equal(r.ranking[0].rank, 1);
  assert.ok(r.ranking.every((x, i, a) => !i || x.score <= a[i - 1].score));
  assert.match(r.dataSource, /sample/);
  const d = await h.get_skill_ratings({ name: 'customer-call-prep' });
  assert.equal(d.ratings, 14);
  assert.deepEqual(Object.values(d.distribution), [0, 1, 1, 2, 10]);
  assert.ok(d.comments.length >= 1 && d.comments.length <= 5);
  const fresh = await h.get_skill_ratings({ name: 'access-review-prep' });
  assert.equal(fresh.enoughRatings, true);
  const rpc = async (fn) => {
    assert.equal(fn, 'skills_ratings');
    return { settings: { minRatings: 5 }, skills: { 'ticket-writer': { distribution: [0, 0, 0, 0, 2], comments: [] } } };
  };
  const live = await createSkillRatingHandlers(() => page, rpc).get_skill_ratings({});
  assert.equal(live.dataSource, 'supabase (ratings)');
  assert.equal(live.ranking[0].skill, 'ticket-writer');
  assert.match(live.ranking[0].rating, /new/);
  const broken = await createSkillRatingHandlers(() => page, async () => { throw new Error('down'); }).get_skill_ratings({ limit: 1 });
  assert.match(broken.dataSource, /sample/);
  await assert.rejects(h.get_skill_ratings({ name: 'no-such-skill' }), ToolError);
  await assert.rejects(h.get_skill_ratings({ limit: 99 }), /limit/);
});

test('rate_skill validates before it writes and sends an anonymous id', async () => {
  const calls = [];
  const rpc = async (fn, body) => { calls.push([fn, body]); return { skill: body.p_skill, updated: false, distribution: [0, 1, 1, 2, 11] }; };
  const h = createSkillRatingHandlers(() => page, rpc, () => 'a'.repeat(32));
  const ok = await h.rate_skill({ name: 'customer-call-prep', stars: 5, comment: '  Sehr hilfreich  ' });
  assert.deepEqual(calls, [['skills_rate', { p_skill: 'customer-call-prep', p_rater: 'a'.repeat(32), p_stars: 5, p_comment: 'Sehr hilfreich', p_version: 1 }]]);
  assert.equal(ok.status, 'rating saved');
  assert.match(ok.now, /of 5 \(15 ratings\)/);
  const again = await createSkillRatingHandlers(() => page, async () => ({ updated: true, distribution: [0, 0, 0, 0, 3] })).rate_skill({ name: 'ticket-writer', stars: 4 });
  assert.equal(again.status, 'rating updated');
  calls.length = 0;
  for (const bad of [{ name: 'customer-call-prep', stars: 0 }, { name: 'customer-call-prep', stars: 6 }, { name: 'customer-call-prep', stars: 4.5 }, { name: 'customer-call-prep', stars: '5' }, { name: 'customer-call-prep', stars: 3, comment: 'x'.repeat(281) }, { stars: 3 }, { name: 'nope', stars: 3 }]) {
    await assert.rejects(h.rate_skill(bad), ToolError, JSON.stringify(bad).slice(0, 60));
  }
  const sample = page.skills.find((s) => s.sample);
  await assert.rejects(h.rate_skill({ name: sample.name, stars: 3 }), /sample skill/);
  assert.equal(calls.length, 0, 'nothing was sent for invalid input');
  await assert.rejects(createSkillRatingHandlers(() => page, null).rate_skill({ name: 'ticket-writer', stars: 3 }), /Supabase/);
});
