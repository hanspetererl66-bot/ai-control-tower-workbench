import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createSkillProfileHandlers, economics, extractMarketplaceData } from '../connectors/control-tower/server/skill-profiles.mjs';
import { buildProfilesSql } from '../scripts/sync-skill-profiles.mjs';
import { loadProfiles } from '../scripts/sync-skill-marketplace.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const page = extractMarketplaceData(read('examples/skill-marketplace/index.html'));
const source = JSON.parse(read('examples/skill-marketplace/profiles.json'));

test('every skill in the Space has a complete profile in all four fields', () => {
  for (const skill of page.skills) {
    const p = page.profiles[skill.name];
    assert.ok(p, `${skill.name} has a profile`);
    for (const field of ['impact', 'governance', 'lifecycle', 'discovery']) assert.ok(p[field] && Object.keys(p[field]).length, `${skill.name}.${field}`);
    assert.equal(p.impact.runsPerMonth.length, page.assumptions.months.length, `${skill.name} runs per month`);
    assert.ok(p.lifecycle.tests.passed <= p.lifecycle.tests.total, skill.name);
  }
});

test('profile links point to things that exist', () => {
  const names = new Set(page.skills.map((s) => s.name));
  const risks = new Set(JSON.parse(read('examples/control-tower/data.json')).risks.map((r) => r.id));
  const families = new Set(JSON.parse(read('examples/control-tower/data.json')).agents.registry.map((a) => a.family));
  for (const [name, p] of Object.entries(page.profiles)) {
    for (const r of p.governance.linkedRisks) assert.ok(risks.has(r), `${name} -> risk ${r}`);
    for (const a of p.governance.linkedAgents) assert.ok(families.has(a), `${name} -> agent ${a}`);
    for (const rel of [...p.discovery.related, ...p.lifecycle.dependencies.skills, ...(p.lifecycle.replacedBy ? [p.lifecycle.replacedBy] : [])]) assert.ok(names.has(rel), `${name} -> skill ${rel}`);
    assert.ok(p.governance.nextReview > p.governance.lastReview, name);
  }
});

test('the Space data and the Supabase migration are generated from profiles.json', () => {
  assert.deepEqual(loadProfiles().profiles, source.profiles);
  assert.deepEqual(page.profiles, source.profiles);
  assert.deepEqual(page.processGaps, source.processGaps);
  assert.equal(buildProfilesSql(source), read('supabase/migrations/20261019_012_skill_profiles.sql'), 'run: npm run sync:skill-profiles');
  const sql = read('supabase/migrations/20261019_012_skill_profiles.sql');
  assert.match(sql, /grant execute on function public\.skills_profiles\(\) to service_role/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/i);
});

test('impact: ranking, detail and the value arithmetic', async () => {
  const h = createSkillProfileHandlers(() => page);
  const all = await h.get_skill_impact({});
  assert.equal(all.skills, page.skills.length);
  assert.equal(all.totals.valueEur, all.ranking.reduce((a, r) => a + r.valueEur, 0));
  assert.ok(all.ranking[0].valueEur >= all.ranking.at(-1).valueEur);
  const one = await h.get_skill_impact({ name: 'expense-check' });
  const e = economics(page.profiles['expense-check'], 85);
  assert.equal(one.valueEur, e.valueEur);
  assert.equal(one.hoursSaved, Math.round((220 * 6) / 60 * 10) / 10);
  assert.equal((await h.get_skill_impact({ boardArea: 'Sales', sort: 'runs' })).ranking.every((r) => r.boardArea === 'Sales'), true);
  await assert.rejects(h.get_skill_impact({ name: 'nope' }), /No skill named/);
  await assert.rejects(h.get_skill_impact({ sort: 'x' }), /sort must be/);
});

test('governance: filters for risk, DPIA and due reviews', async () => {
  const h = createSkillProfileHandlers(() => page);
  const high = await h.get_skill_governance({ aiActRisk: 'High' });
  assert.deepEqual(high.skills.map((s) => s.name), ['sf-job-text-reviewer']);
  const dpia = await h.get_skill_governance({ dpiaOpen: true });
  assert.ok(dpia.count === 3 && dpia.skills.every((s) => /progress|not started/.test(s.dpia)));
  const due = await h.get_skill_governance({ dueWithinDays: 60 });
  assert.ok(due.skills.every((s) => s.daysUntilReview <= 60) && due.count >= 3);
  const conf = await h.get_skill_governance({ dataClass: 'vertraulich' });
  assert.ok(conf.count > 0 && conf.skills.every((s) => s.allowedDataClasses.includes('vertraulich')));
  assert.ok((await h.get_skill_governance({ name: 'board-briefing' })).skill.linkedRisks.includes('R6'));
  await assert.rejects(h.get_skill_governance({ dueWithinDays: -1 }), /dueWithinDays/);
});

test('lifecycle, gaps and recommendations', async () => {
  const h = createSkillProfileHandlers(() => page);
  const dep = await h.get_skill_lifecycle({ dependsOn: 'expense-check' });
  assert.ok(dep.skills.map((s) => s.name).includes('invoice-matcher'));
  const att = await h.get_skill_lifecycle({});
  assert.ok(att.sunsetPlanned.some((s) => s.name === 'concur-receipt-audit' && s.replacedBy === 'expense-check'));
  assert.ok(att.noDeputy.includes('quote-drafter'));
  assert.equal((await h.get_skill_lifecycle({ name: 'expense-check' })).skill.changelog.length, 3);

  const gaps = await h.find_skill_gaps({ boardArea: 'Finance' });
  assert.ok(gaps.gaps.every((g) => g.boardArea === 'Finance') && gaps.gaps[0].minutesPerMonth >= gaps.gaps.at(-1).minutesPerMonth);
  assert.equal((await h.find_skill_gaps({ status: 'No skill' })).gaps.every((g) => g.status === 'No skill'), true);

  const rec = await h.recommend_skills({ role: 'Controller' });
  assert.ok(rec.skills.some((s) => s.name === 'expense-check') && rec.skills[0].examplePrompts.length);
  const byTask = await h.recommend_skills({ task: 'Verträge verlängern Fristen' });
  assert.equal(byTask.skills[0].name, 'renewal-radar');
  await assert.rejects(h.recommend_skills({}), /role, a task/);
});

test('profiles come live from Supabase when connected and fall back otherwise', async () => {
  const live = createSkillProfileHandlers(() => page, async (fn) => {
    assert.equal(fn, 'skills_profiles');
    return { assumptions: { hourlyRateEur: 100 }, profiles: { 'expense-check': page.profiles['expense-check'] }, processGaps: [], requests: [] };
  });
  const r = await live.get_skill_impact({});
  assert.match(r.dataSource, /supabase/);
  assert.equal(r.skills, 1);
  const broken = createSkillProfileHandlers(() => page, async () => { throw new Error('missing function'); });
  const fb = await broken.get_skill_impact({});
  assert.match(fb.dataSource, /sample data/);
  assert.equal(fb.skills, page.skills.length);
});

test('playbooks reference real skills, say why, and are found by role and goal', async () => {
  const names = new Set(page.skills.map((s) => s.name));
  assert.ok(page.playbooks.length >= 5);
  for (const pb of page.playbooks) {
    assert.ok(pb.steps.length >= 2 && pb.roles.length && pb.goal, pb.id);
    for (const st of pb.steps) { assert.ok(names.has(st.skill), `${pb.id} -> ${st.skill}`); assert.ok(st.why && st.input && st.output, `${pb.id} ${st.skill}`); }
    assert.equal(new Set(pb.steps.map((s) => s.skill)).size, pb.steps.length, `${pb.id} has no repeated skill`);
  }
  const h = createSkillProfileHandlers(() => page);
  const r = await h.recommend_skill_workflow({ role: 'Account Manager', goal: 'Kundentermin und Verlängerung' });
  assert.equal(r.workflows[0].id, 'PB-01');
  assert.deepEqual(r.workflows[0].steps.map((s) => s.skill), ['customer-call-prep', 'renewal-radar', 'quote-drafter', 'ticket-writer']);
  assert.ok(r.workflows[0].steps.every((s, i) => s.step === i + 1 && s.why));
  assert.ok(r.workflows[0].steps.find((s) => s.skill === 'renewal-radar').warnings.includes('sample skill, not published'));
  const none = await h.recommend_skill_workflow({ role: 'Zahnarzt' });
  assert.equal(none.count, 0);
  await assert.rejects(h.recommend_skill_workflow({}), /role, a goal/);
  await assert.rejects(h.recommend_skill_workflow({ role: 'x', limit: 9 }), /limit/);
});
