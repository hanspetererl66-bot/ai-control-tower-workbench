import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embedLogic, embedMockupData } from '../scripts/sync-mockup-spaces.mjs';
import { makeLogic } from '../connectors/_lib/server/recruiting-logic.mjs';
import { RECRUITING_TOOL_DEFINITIONS } from '../connectors/_lib/server/recruiting.mjs';
import { buildSeedSql } from '../scripts/recruiting-seed.mjs';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/recruiting-workbench/index.html'), 'utf8');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/recruiting-workbench/data.json'), 'utf8'));

// The logic lives in the connector module; the page carries an embedded copy that must be identical.
const L = makeLogic(data);

const ids = (list) => list.map((e) => e.cand.id);

test('recruiting-workbench page embeds the current sample data', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
});

test('recruiting-workbench page logic is the connector module, embedded', () => {
  assert.equal(embedLogic(page, makeLogic.toString()), page, 'run: npm run sync:mockups');
});

test('recruiting-workbench committed seed.sql matches data.json', () => {
  assert.equal(readFileSync(join(ROOT, 'examples/recruiting-workbench/seed.sql'), 'utf8'), buildSeedSql(data), 'run: npm run recruiting:seed');
});

test('recruiting-workbench sample data is internally consistent', () => {
  const jobIds = new Set(data.jobs.map((j) => j.id));
  assert.equal(jobIds.size, data.jobs.length, 'requisition ids are unique');
  assert.equal(new Set(data.candidates.map((c) => c.id)).size, data.candidates.length, 'candidate ids are unique');
  for (const c of data.candidates) {
    assert.ok(jobIds.has(c.job), `${c.id} points to an unknown requisition`);
    assert.ok(data.stages.includes(c.stage), `${c.id} has an unknown stage`);
    assert.ok(c.since >= c.applied, `${c.id} entered its stage before applying`);
    assert.ok(c.since <= data.asOf, `${c.id} is dated after the sample date`);
    if (c.cv) {
      assert.ok(Number.isInteger(c.years) && c.yearsLine >= 1 && c.yearsLine <= c.cv.length, `${c.id} has a bad years line`);
      assert.match(c.cv[c.yearsLine - 1], /\d|year/i, `${c.id} years line states no duration`);
    }
  }
  for (const stage of data.stages) assert.ok(data.sla[stage] > 0, `${stage} needs a target`);
  for (const [job, crits] of Object.entries(data.criteria)) {
    assert.ok(jobIds.has(job));
    assert.equal(new Set(crits.map((c) => c.id)).size, crits.length, `${job} criteria ids are unique`);
    assert.ok(crits.some((c) => c.must) && crits.some((c) => !c.must), `${job} needs must-haves and nice-to-haves`);
    for (const c of L.cands(job)) assert.ok(c.cv, `${c.id} needs CV text for the shortlist`);
  }
  for (const h of data.history) assert.ok(h.accepted <= h.offers, `${h.id} accepted more offers than it made`);
  for (const j of data.jobs) assert.ok(L.baseline(j.dept).n > 0, `${j.dept} has no closed requisitions`);
});

test('recruiting-workbench requisition status follows the stated rule', () => {
  const st = Object.fromEntries(data.jobs.map((j) => [j.id, L.jobStatus(j).status]));
  assert.deepEqual(st, {
    'REQ-2201': 'late', 'REQ-2202': 'offer', 'REQ-2203': 'offer', 'REQ-2204': 'late', 'REQ-2205': 'watch', 'REQ-2206': 'ok',
  });
  assert.equal(L.daysBetween('2026-08-24', '2026-11-06'), 74);
});

test('recruiting-workbench counts and funnel add up', () => {
  assert.equal(L.stalledList().length, 10);
  const f = L.funnel();
  assert.equal(f.reduce((a, x) => a + x.count, 0), data.candidates.length);
  assert.equal(f.reduce((a, x) => a + x.stalled, 0), L.stalledList().length);
  const acc = L.acceptance('all');
  assert.equal(acc.offers, data.history.reduce((a, h) => a + h.offers, 0));
  assert.equal(acc.accepted, data.history.reduce((a, h) => a + h.accepted, 0));
});

test('recruiting-workbench shortlist groups candidates by stated criteria', () => {
  const s = L.shortlist('REQ-2201');
  const g = (x) => ids(s.filter((e) => e.group === x));
  assert.deepEqual(g('A'), ['C-4101', 'C-4102']);
  assert.deepEqual(g('B').sort(), ['C-4103', 'C-4104', 'C-4105']);
  assert.deepEqual(g('C'), ['C-4106']);
  assert.deepEqual(s.map((e) => e.rank), [1, 2, 3, 4, 5, 6]);
  // partly-met lead experience lands in "needs a human look", not in "missing"
  const c4104 = s.find((e) => e.cand.id === 'C-4104');
  assert.equal(c4104.res.find((r) => r.crit.id === 'M2').status, 'partly');
  const a2204 = ids(L.shortlist('REQ-2204').filter((e) => e.group === 'A'));
  assert.deepEqual(a2204.sort(), ['C-4301', 'C-4304']);
});

test('recruiting-workbench order inside a group follows the stated rule only', () => {
  for (const job of Object.keys(data.criteria)) {
    const s = L.shortlist(job);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      assert.ok(a.group <= b.group, `${job}: groups are in order`);
      if (a.group === b.group) {
        const key = (e) => [-e.mustMet, -e.mustPartly, -e.niceMet, e.cand.applied];
        const ka = key(a), kb = key(b);
        const cmp = ka.find((v, k) => v !== kb[k]);
        if (cmp !== undefined) {
          const k = ka.findIndex((v, n) => v !== kb[n]);
          assert.ok(ka[k] < kb[k], `${job}: ${a.cand.id} before ${b.cand.id} breaks the rule`);
        }
      }
    }
  }
});

test('recruiting-workbench proof lines point at real CV lines', () => {
  for (const job of Object.keys(data.criteria)) {
    for (const e of L.shortlist(job)) {
      for (const r of e.res) {
        if (r.status === 'missing' && r.crit.kind !== 'years') continue;
        assert.ok(r.line >= 1 && r.line <= e.cand.cv.length, `${e.cand.id} ${r.crit.id} has no proof line`);
        assert.equal(r.text, e.cand.cv[r.line - 1]);
      }
    }
  }
});

test('recruiting-workbench Joule only proposes, never rejects or acts alone', () => {
  const pr = L.proposals();
  assert.equal(pr.length, 13);
  assert.equal(new Set(pr.map((p) => p.id)).size, pr.length, 'proposal ids are unique');
  const writes = new Set(data.tools.filter((t) => t.kind === 'write').map((t) => t.name));
  assert.deepEqual([...writes], ['recruiting_create_proposal'], 'the only write tool writes a proposal');
  for (const p of pr) {
    assert.ok(writes.has(p.tool), `${p.tool} is not a declared write tool`);
    assert.ok(['move', 'remind', 'ask'].includes(p.type));
    assert.doesNotMatch(p.text, /reject|decline|turn down|discard/i, `${p.id} reads like a rejection`);
    const e = L.shortlist(p.job).find((x) => x.cand.id === p.cand);
    assert.notEqual(e.group, 'C', `${p.cand} does not meet the criteria; Joule proposes nothing`);
    if (p.type === 'move') {
      assert.equal(e.group, 'A');
      assert.ok(['Applied', 'Screening'].includes(e.cand.stage));
    }
  }
  assert.ok(!pr.some((p) => p.cand === 'C-4106'), 'no proposal for C-4106');
});

test('recruiting-workbench brief names the longest-waiting best match', () => {
  const best = L.bestWaiting();
  assert.equal(best.cand.id, 'C-4304');
  assert.equal(L.daysIn(best.cand), 17);
  const text = L.brief().map((x) => x.text).join(' ');
  assert.match(text, /C-4304/);
  assert.match(text, /REQ-2201/);
  assert.match(text, /REQ-2204/);
});

test('recruiting-workbench keeps personal data out and states what it is', () => {
  for (const f of ['name', 'photo', 'date of birth', 'gender', 'address']) assert.ok(data.privacy.removed.includes(f), `${f} must be removed`);
  const keys = new Set(data.candidates.flatMap((c) => Object.keys(c)));
  for (const k of ['name', 'email', 'phone', 'photo', 'birthdate', 'address', 'gender']) assert.ok(!keys.has(k), `candidate data holds ${k}`);
  assert.match(page, /No SmartRecruiters or SuccessFactors system is called/);
  assert.match(page, /EU AI Act/);
});

test('recruiting-workbench tools are the real connector tools and the write tool needs a release', () => {
  assert.ok(data.tools.some((t) => t.kind === 'read') && data.tools.some((t) => t.kind === 'write'));
  for (const t of data.tools.filter((x) => x.kind === 'write')) assert.match(t.what, /release/i, `${t.name} must say it needs a release`);
  const real = new Set(RECRUITING_TOOL_DEFINITIONS.map((t) => t.name));
  assert.deepEqual(data.tools.map((t) => t.name).sort(), [...real].sort(), 'the Space lists exactly the connector tools');
  for (const t of data.later) assert.match(t.what, /Not built/);
  for (const q of data.questions) for (const c of q.calls) {
    assert.ok(data.tools.some((t) => t.name === c.tool && t.kind === 'read'), `${c.tool} in questions must be a read tool`);
    JSON.parse(c.args);
  }
});

test('recruiting-workbench is a static, sandbox-safe page', () => {
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage|type="submit"/);
  assert.match(page, /wb:ask/);
  assert.match(page, /e\.source|window\.parent/);
  assert.match(page, /slice\(0, 600\)/);
});
