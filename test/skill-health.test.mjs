import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { act, applyProposal, clusters, dismiss, emptyCatalog, exampleCatalog, healthOf, metrics, proposals, sanitizeCatalog, similarity, syncInstalled, DEFAULT_POLICY } from '../src/skill-health.ts';

const src = (f) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');
const NOW = new Date('2026-11-03T12:00:00').getTime();
const DAY = 86_400_000;
const mk = (id, name, description, over = {}) => ({ id, name, description, owner: 'a@x.com', department: 'Finance', level: 0, createdAt: NOW - 200 * DAY, lastUsed: NOW - 2 * DAY, uses30: 10, uses90: 30, users90: 3, success: 0.9, deps: [], state: 'active', reviewedAt: NOW - 10 * DAY, ...over });
const cat = (skills, over = {}) => ({ ...emptyCatalog(), people: ['a@x.com', 'b@x.com'], stewards: { Finance: 'b@x.com' }, skills, ...over });

test('similarity: rephrased skills are alike, different ones are not', () => {
  const a = mk('1', 'Invoice summary', 'Summarise open supplier invoices by entity and due date.');
  const b = mk('2', 'Summarize supplier invoices', 'Short summary of open supplier invoices per entity with due dates.');
  const c = mk('3', 'Job description writer', 'Write a job description from a role profile.');
  assert.ok(similarity(a, b) > 0.5, String(similarity(a, b)));
  assert.ok(similarity(a, c) < 0.15);
});

test('clusters pick the most used skill as master; dismissed groups stay away', () => {
  const skills = [
    mk('1', 'Invoice summary', 'Summarise open supplier invoices by entity and due date.', { uses90: 5, users90: 1 }),
    mk('2', 'Summarize supplier invoices', 'Short summary of open supplier invoices per entity with due dates.', { uses90: 120, users90: 20 }),
    mk('3', 'Job description writer', 'Write a job description from a role profile.'),
  ];
  const c = cat(skills);
  const cl = clusters(c);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].master, '2');
  assert.deepEqual([...cl[0].ids].sort(), ['1', '2']);
  assert.equal(clusters(dismiss(c, cl[0].key)).length, 0);
});

test('health: unused, rare, orphan, broken, deprecated', () => {
  const c = cat([]);
  const h = (over) => healthOf(mk('x', 'X', 'x', over), c, NOW);
  assert.equal(h({}), 'active');
  assert.equal(h({ uses90: 1 }), 'rare');
  assert.equal(h({ lastUsed: NOW - 120 * DAY, uses90: 0 }), 'unused');
  assert.equal(h({ lastUsed: null, createdAt: NOW - 5 * DAY, uses90: 0 }), 'rare', 'a new skill is not unused yet');
  assert.equal(h({ owner: 'gone@x.com' }), 'orphan');
  assert.equal(h({ deps: ['legacy-erp'] }), 'broken');
  assert.equal(h({ state: 'deprecated' }), 'deprecated');
  assert.equal(h({ state: 'retired' }), 'retired');
});

test('proposals: merge, phase out, retire, reassign, remind, promote, fix', () => {
  const skills = [
    mk('m1', 'Invoice summary', 'Summarise open supplier invoices by entity and due date.', { uses90: 100, users90: 12, level: 1 }),
    mk('m2', 'Summarize supplier invoices', 'Short summary of open supplier invoices per entity with due dates.', { uses90: 2, users90: 1 }),
    mk('u', 'Old thing', 'Nobody uses this one anymore in the archive.', { lastUsed: NOW - 200 * DAY, uses90: 0, users90: 0, uses30: 0 }),
    mk('r', 'Retire me', 'Phase-out ended for the legacy list.', { state: 'deprecated', sunsetAt: NOW - 3 * DAY }),
    mk('o', 'Orphan skill', 'Belongs to a person who left the company long ago.', { owner: 'gone@x.com' }),
    mk('f', 'Broken skill', 'Needs a connector which was removed from the platform.', { deps: ['legacy-erp'] }),
    mk('d', 'Due review', 'Was last confirmed by the owner a long time ago.', { reviewedAt: NOW - 300 * DAY }),
  ];
  const kinds = Object.fromEntries(proposals(cat(skills), NOW).map((p) => [p.kind, p]));
  for (const k of ['merge', 'sunset', 'retire', 'reassign', 'fix', 'remind', 'promote']) assert.ok(kinds[k], k);
  assert.equal(kinds.merge.steps[0].opt.replacedBy, 'm1');
  assert.equal(kinds.reassign.steps[0].opt.owner, 'b@x.com', 'the department steward takes over');
  assert.deepEqual(kinds.promote.ids, ['m1']);
});

test('confirming a merge phases out the others and points to the master; the log records it', () => {
  const skills = [mk('m1', 'Invoice summary', 'Summarise open supplier invoices by entity and due date.', { uses90: 100 }), mk('m2', 'Summarize supplier invoices', 'Short summary of open supplier invoices per entity with due dates.', { uses90: 2 })];
  const c = cat(skills);
  const p = proposals(c, NOW).find((x) => x.kind === 'merge');
  const next = applyProposal(c, p, NOW, 'me@x.com');
  const m2 = next.skills.find((s) => s.id === 'm2');
  assert.equal(m2.state, 'deprecated');
  assert.equal(m2.replacedBy, 'm1');
  assert.ok(m2.sunsetAt > NOW);
  assert.equal(next.skills.find((s) => s.id === 'm1').state, 'active');
  assert.equal(next.log[0].actor, 'me@x.com');
  assert.equal(proposals(next, NOW).filter((x) => x.kind === 'merge').length, 0, 'done, not proposed again');
});

test('manual actions: retire, restore, reassign, review; nothing changed = same catalog', () => {
  let c = cat([mk('a', 'A', 'alpha'), mk('b', 'B', 'beta', { state: 'deprecated', replacedBy: 'a', sunsetAt: NOW })]);
  c = act(c, 'restore', ['b'], {}, NOW, 'me');
  assert.equal(c.skills[1].state, 'active');
  assert.equal(c.skills[1].replacedBy, undefined);
  assert.equal(act(c, 'restore', ['b'], {}, NOW, 'me'), c, 'already active');
  c = act(c, 'reassign', ['a'], { owner: 'b@x.com' }, NOW, 'me');
  assert.equal(c.skills[0].owner, 'b@x.com');
  assert.equal(act(c, 'reassign', ['a'], {}, NOW, 'me'), c, 'no owner given');
  c = act(c, 'retire', ['a'], {}, NOW, 'me');
  assert.equal(c.skills[0].state, 'retired');
  assert.equal(c.log.length, 3);
});

test('no reply to the reminder after 14 days leads to a phase-out proposal', () => {
  const c = cat([mk('q', 'Quiet', 'No reply from the owner at all.', { remindedAt: NOW - 20 * DAY, reviewedAt: NOW - 300 * DAY })]);
  const p = proposals(c, NOW);
  assert.equal(p[0].kind, 'sunset');
  assert.match(p[0].detail, /No answer to the reminder/);
});

test('key figures add up on the example catalog', () => {
  const c = exampleCatalog(NOW);
  const m = metrics(c, NOW);
  assert.ok(m.total >= 40);
  assert.equal(Object.values(m.byHealth).reduce((a, b) => a + b, 0), m.total);
  assert.ok(m.duplicateRate > 0.2 && m.duplicateRate < 0.6);
  assert.ok(m.byHealth.orphan > 0 && m.byHealth.broken > 0 && m.byHealth.unused > 0);
  assert.equal(m.byDepartment.reduce((n, d) => n + d.total, 0), m.total);
  assert.ok(m.openProposals > 10 && m.potential > 0);
  assert.equal(JSON.stringify(exampleCatalog(NOW)), JSON.stringify(c), 'deterministic');
});

test('installed skills join the catalog with their local use', () => {
  const c = syncInstalled(emptyCatalog(), [{ name: 'daily-briefing', description: 'Morning briefing' }, { name: 'x-tool', description: 'Other' }], { k: { label: 'daily-briefing', count: 7, last: NOW - DAY } }, 'me@x.com', NOW);
  assert.equal(c.skills.length, 2);
  const s = c.skills.find((x) => x.name === 'daily-briefing');
  assert.equal(s.uses90, 7);
  assert.equal(s.installed, true);
  assert.ok(c.people.includes('me@x.com'));
  assert.equal(syncInstalled(c, [{ name: 'daily-briefing', description: 'Morning briefing' }], { k: { label: 'daily-briefing', count: 7, last: NOW - DAY } }, 'me@x.com', NOW), c, 'nothing new');
});

test('storage: bad data is cleaned and the policy stays in range', () => {
  const c = sanitizeCatalog({ skills: [{ id: 'a', name: 'A', level: 7, uses90: -3 }, { id: 'a', name: 'dup' }, { name: 'no id' }, 'x'], policy: { unusedDays: 1, similarity: 5, rareUses: 'x' } });
  assert.equal(c.skills.length, 1);
  assert.equal(c.skills[0].level, 0);
  assert.equal(c.skills[0].uses90, 0);
  assert.equal(c.policy.unusedDays, 7);
  assert.equal(c.policy.similarity, 0.95);
  assert.equal(c.policy.rareUses, DEFAULT_POLICY.rareUses);
  assert.equal(sanitizeCatalog(null).skills.length, 0);
});

test('the dashboard is wired: Admin tile, Rail group, five tabs, bulk actions', () => {
  assert.match(src('src/ui/AdminView.tsx'), /Skill management/);
  assert.match(src('src/ui/Rail.tsx'), /ADMIN_VIEWS: View\[\] = \[[^\]]*'skillhealth'/);
  assert.match(src('src/App.tsx'), /view === 'skillhealth' \? \(\s*<SkillHealthView/);
  const ui = src('src/ui/SkillHealthView.tsx');
  for (const w of ['Overview', 'Actions', 'Duplicates', 'Catalog', 'Policy & log', 'Confirm', 'Not duplicates', 'Phase out', 'Retire', 'Restore', 'Reassign', 'Mark as reviewed', 'Request next level']) assert.ok(ui.includes(w), w);
});
