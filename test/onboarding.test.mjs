import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/onboarding/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/onboarding/data.json'), 'utf8'));
const space = JSON.parse(readFileSync(join(ROOT, 'examples/onboarding/space.json'), 'utf8'));
const code = page.match(/\/\/ @logic-start\n([\s\S]*?)\n\s*\/\/ @logic-end/)[1];
const L = new Function(`${code}\nreturn { addDays, diffDays, stateOf, states, stageOf, countStates, progress, health, nextAction, dayLabel, whenLabel, story, kpis, byOwner, pos };`)();
const { asOf, steps, hires } = data;
const hire = (id) => hires.find((h) => h.id === id);

test('page embeds the current sample data and belongs to HR', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
  assert.equal(space.title, 'Onboarding'); assert.equal(space.domain, 'HR');
});

test('sample data: five pseudonymous hires, known steps, phases and owners', () => {
  assert.equal(hires.length, 5); assert.equal(steps.length, 23);
  const ids = new Set(steps.map((s) => s.id)), phases = new Set(data.phases.map((p) => p.id));
  assert.equal(ids.size, steps.length);
  for (const s of steps) {
    assert.ok(phases.has(s.phase), s.id); assert.ok(data.owners.includes(s.owner), s.id);
    for (const a of s.after ?? []) assert.ok(ids.has(a), `${s.id} after ${a}`);
  }
  for (const h of hires) {
    assert.match(h.id, /^C-\d+$/);
    for (const id of [...Object.keys(h.done), ...(h.na ?? []), ...Object.keys(h.blocked)]) assert.ok(ids.has(id), `${h.id}: ${id}`);
    for (const id of Object.keys(h.blocked)) assert.ok(!h.done[id], `${h.id}: ${id} cannot be done and blocked`);
    for (const [id, day] of Object.entries(h.done)) {
      const s = steps.find((x) => x.id === id);
      for (const a of s.after ?? []) assert.ok(h.done[a] || (h.na ?? []).includes(a), `${h.id}: ${id} was done before ${a}`);
      assert.ok(L.diffDays(h.contract.at, day) >= 0 || s.beforeContract, `${h.id}: ${id} done before the signature`);
      assert.ok(day <= asOf, `${h.id}: ${id} is done in the future`);
    }
    assert.ok(!JSON.stringify(h).match(/@|IBAN/), 'no contact or bank data');
  }
});

test('dates and states follow the start date and today', () => {
  assert.equal(L.addDays('2026-11-16', -7), '2026-11-09');
  assert.equal(L.diffDays('2026-11-09', '2026-12-15'), 36);
  const h = hire('C-3320'), s = (id) => steps.find((x) => x.id === id);
  assert.equal(L.stateOf(h, s('new_hire_forms'), asOf, steps), 'overdue', 'due 6 Nov');
  assert.equal(L.stateOf(h, s('it_hardware'), asOf, steps), 'blocked');
  assert.equal(L.stateOf(h, s('payroll_setup'), asOf, steps), 'waiting', 'needs the forms');
  assert.equal(L.stateOf(h, s('it_accounts'), asOf, steps), 'soon', 'due today');
  assert.equal(L.stateOf(h, s('check30'), asOf, steps), 'planned');
  assert.equal(L.stateOf(h, s('right_to_work'), asOf, steps), 'na');
  assert.equal(L.stateOf(h, s('works_council'), asOf, steps), 'done');
});

test('before the signature everything is locked except the works council notice', () => {
  const h = hire('C-3702');
  const st = Object.fromEntries(L.states(h, asOf, steps).map((x) => [x.step.id, x.state]));
  assert.equal(st.works_council, 'done');
  for (const [id, s] of Object.entries(st)) if (!['works_council', 'right_to_work'].includes(id)) assert.equal(s, 'locked', id);
  const open = { ...h, done: {} };
  assert.notEqual(L.stateOf(open, steps.find((x) => x.id === 'works_council'), asOf, steps), 'locked', 'may run before the signature');
  assert.equal(L.health(h, asOf, steps), 'waiting');
  assert.match(L.story(h, asOf, steps), /not signed/);
});

test('the five hires are in five different situations', () => {
  assert.deepEqual(hires.map((h) => L.stageOf(h, asOf)), ['waiting', 'pre', 'pre', 'week1', 'probation']);
  assert.deepEqual(hires.map((h) => L.health(h, asOf, steps)), ['waiting', 'blocked', 'blocked', 'on track', 'behind']);
  assert.equal(L.dayLabel(hire('C-3320'), asOf), 'starts in 7 days');
  assert.equal(L.dayLabel(hire('C-3202'), asOf), 'day 5');
  assert.equal(L.dayLabel(hire('C-2901'), asOf), 'day 98');
});

test('progress counts only steps that apply, and next action puts a blocker before an overdue step', () => {
  const p = L.progress(hire('C-3202'), asOf, steps);
  assert.deepEqual([p.done, p.total], [14, 22]);
  assert.equal(L.progress(hire('C-3202'), asOf, steps, 'pre').pct, 100);
  const n = L.nextAction(hire('C-3320'), asOf, steps);
  assert.equal(n.step.id, 'it_hardware'); assert.equal(n.state, 'blocked');
  assert.equal(L.nextAction(hire('C-2901'), asOf, steps).step.id, 'check90');
  assert.equal(L.whenLabel('2026-11-01', asOf), '8 days overdue');
  assert.equal(L.whenLabel(asOf, asOf), 'due today');
  assert.match(L.story(hire('C-2901'), asOf, steps), /Behind: 90-day review \(Manager\) is 8 days overdue/);
});

test('numbers on top and per owner are computed from the steps', () => {
  const k = L.kpis(hires, asOf, steps);
  assert.deepEqual(k, { soon: 1, waiting: 1, blocked: 2, overdue: 2 });
  const it = L.byOwner(hires, asOf, steps, 'IT');
  assert.equal(it[0].state, 'blocked'); assert.equal(it[0].hire.id, 'C-3320');
  assert.ok(it.every((r, i) => i === 0 || ['blocked', 'overdue', 'soon', 'planned', 'waiting'].indexOf(r.state) >= 0));
  const total = data.owners.reduce((n, o) => n + L.byOwner(hires, asOf, steps, o).length, 0);
  const open = hires.reduce((n, h) => n + L.states(h, asOf, steps).filter((x) => ['blocked', 'overdue', 'soon', 'planned', 'waiting'].includes(x.state)).length, 0);
  assert.equal(total, open, 'every open step belongs to exactly one owner');
  assert.equal(L.pos(-21), 0); assert.equal(L.pos(160), 100); assert.equal(L.pos(0), 38); assert.equal(L.pos(-100), 0); assert.equal(L.pos(400), 100);
  const days = [-21, -10, -5, 0, 5, 7, 30, 90, 150, 160]; assert.deepEqual(days.map(L.pos), [...days.map(L.pos)].sort((a, b) => a - b), 'the axis only grows');
});

test('the page keeps the Space rules: no network, no storage, no bridge, colours as tokens only', () => {
  const own = page.replace(/<style id="design-system">[\s\S]*?<\/style>/, '').replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
  assert.ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|https?:\/\//.test(own));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(own), 'colours only as tokens');
  assert.deepEqual([...new Set([...own.matchAll(/type: '([a-z]+:[a-z-]+)'/g)].map((m) => m[1]))], ['wb:ask', 'ct:error', 'ob:list-request', 'ob:set-request', 'ob:handover-request']);
  assert.match(own, /e\.source !== window\.parent/, 'answers are accepted only from the app window');
  assert.match(page, /class="card"|class="[^"]*\bcard\b/);
});
