import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { embedMockupData } from '../scripts/sync-mockup-spaces.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';
import { knownTools, validateSkill } from '../scripts/skills-registry.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const page = read('examples/recruiting-analytics/index.html');
const data = JSON.parse(read('examples/recruiting-analytics/data.json'));
const L = new Function(`${page.slice(page.indexOf('// @logic-start'), page.indexOf('// @logic-end'))}; return makeLogic;`)()(data);

test('the page embeds its data, is registered, and the Space hangs under the Recruiting Workbench', () => {
  assert.equal(embedMockupData(page, data), page, 'run: npm run sync:mockups');
  assert.equal(EXAMPLE_SPACES['recruiting-analytics'], 'recruiting-analytics');
  assert.ok(SPACE_PAGES.includes('examples/recruiting-analytics/index.html'), 'the design system is embedded');
  assert.match(read('package.json'), /"install:recruiting-analytics": "node scripts\/install-example-space\.mjs recruiting-analytics"/);
  const space = JSON.parse(read('examples/recruiting-analytics/space.json'));
  assert.equal(space.domain, 'HR');
  assert.equal(space.parent, 'recruiting-workbench');
});

test('no network, no storage, no colour outside the tokens in the page code', () => {
  const code = page.slice(page.indexOf('<body>'));
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket/);
  const css = page.slice(page.indexOf('</style>\n<style>'), page.indexOf('<body>'));
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});

test('the sample data hangs together like the database constraints say', () => {
  assert.equal(new Set(data.requisitions.map((r) => r.id)).size, data.requisitions.length);
  for (const r of data.requisitions) {
    assert.ok(r.screened <= r.applied && r.interviewed <= r.screened, `${r.id}: funnel only narrows`);
    assert.ok(r.offersAccepted <= r.offersMade, r.id);
    assert.equal(r.status === 'filled', Boolean(r.filled), `${r.id}: a filled requisition has a fill date`);
    if (r.filled) assert.ok(r.filled >= r.opened, r.id);
  }
  for (const s of data.sources) assert.ok(s.hires <= s.applications && s.earlyPassed <= s.earlyTotal && s.earlyTotal <= s.hires, s.key);
  for (const g of data.groups) assert.ok(g.interviews <= g.applications, g.key);
  assert.equal(data.origin, 'example');
});

test('selection rates follow the database view: small groups hidden, rate, ratio to the top group, four-fifths hint', () => {
  // Rows as returned by recruiting_analytics.v_group_rate on 2026-11-09 (minimum group 10, limit 0.8).
  const view = {
    'Altersgruppe/30 bis 44': { suppressed: false, interviews: 66, rate: 0.0868421052631579, ratio: 1, hint: false },
    'Altersgruppe/45 und älter': { suppressed: false, interviews: 17, rate: 0.05329153605015674, ratio: 0.613660112092714, hint: true },
    'Altersgruppe/unter 30': { suppressed: false, interviews: 55, rate: 0.0859375, ratio: 0.9895833333333334, hint: false },
    'Geschlecht/divers': { suppressed: true, interviews: null, rate: null, ratio: null, hint: null },
    'Geschlecht/männlich': { suppressed: false, interviews: 80, rate: 0.082389289392379, ratio: 1, hint: false },
    'Geschlecht/weiblich': { suppressed: false, interviews: 58, rate: 0.07816711590296496, ratio: 0.9487533692722372, hint: false },
  };
  const rows = L.groupRates();
  assert.equal(rows.length, 6);
  for (const g of rows) {
    const want = view[`${g.dimensionKey}/${g.key}`];
    assert.ok(want, g.key);
    assert.equal(g.suppressed, want.suppressed, `${g.key}: suppressed`);
    assert.equal(g.interviews, want.interviews, `${g.key}: interviews hidden when suppressed`);
    assert.equal(g.rate === null ? null : Number(g.rate.toFixed(12)), want.rate === null ? null : Number(want.rate.toFixed(12)), `${g.key}: rate`);
    assert.equal(g.ratioToTop === null ? null : Number(g.ratioToTop.toFixed(12)), want.ratio === null ? null : Number(want.ratio.toFixed(12)), `${g.key}: ratio`);
    assert.equal(g.reviewHint, want.hint, `${g.key}: hint`);
  }
  const small = rows.find((g) => g.suppressed);
  assert.equal(small.interviews, null, 'a hidden group shows no interview count');
});

test('source figures follow the view v_source_kpi and the totals add up', () => {
  assert.deepEqual(Object.fromEntries(L.sources().map((s) => [s.key, s.costPerHire])), { Jobbörsen: 4800, Karriereseite: 2500, Mitarbeiterempfehlung: 2000, Personalagentur: 23000, Hochschulen: 5500 });
  const T = L.totals();
  assert.equal(T.hires, 18);
  assert.equal(T.costPerHire, Math.round(124300 / 18));
  assert.equal(L.funnel().applied, data.requisitions.reduce((s, r) => s + r.applied, 0));
});

test('time to fill: open positions count to the page date, late means past the target', () => {
  const open = L.requisitions('open');
  assert.deepEqual(open.filter((r) => r.late).map((r) => r.id).sort(), ['REQ-2201', 'REQ-2202', 'REQ-2204']);
  assert.equal(open.find((r) => r.id === 'REQ-2204').days, 76);
  const filled = L.requisitions('filled');
  assert.equal(filled.find((r) => r.id === 'REQ-1901').days, 24, 'matches the view for a filled requisition');
  assert.ok(filled.every((r) => !r.late));
});

test('the highlights come from rules and never name a person', () => {
  const text = L.highlights().join('\n');
  assert.match(text, /3 of 6 open requisitions are past their target/);
  assert.match(text, /REQ-2204 waits 22 days/);
  assert.match(text, /Agency costs 23,000 per hire/);
  assert.match(text, /45 and older" is at 61 %/);
  assert.match(text, /1 group is hidden/);
});

test('the page runs: five tabs, every tab renders, the hint is worded as a hint', () => {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errs.push(e.message));
  const w = new JSDOM(page, { runScripts: 'dangerously', virtualConsole: vc }).window;
  const labels = [...w.document.querySelectorAll('#tabs button')].map((b) => b.textContent);
  assert.deepEqual(labels, ['Overview', 'Time to fill', 'Funnel and waits', 'Sources', 'Selection rates']);
  for (const id of ['over', 'ttf', 'fun', 'src', 'fair']) {
    w.document.querySelector(`[data-act=tab][data-id=${id}]`).click();
    assert.ok(w.document.querySelector('#main').textContent.length > 200, id);
  }
  assert.match(w.document.querySelector('#main').textContent, /not a finding of discrimination/);
  w.document.querySelector('[data-act=tab][data-id=ttf]').click();
  w.document.querySelector('[data-act=req][data-id=open]').click();
  assert.equal(w.document.querySelectorAll('#main tbody tr').length, 6);
  assert.deepEqual(errs, []);
});

test('the migration file matches the live schema: counts only, closed to anon and authenticated, hidden small groups', () => {
  const sql = read('supabase/migrations/20261108_040_recruiting_analytics.sql');
  const code = sql.replace(/--.*/g, '');
  for (const t of ['setting', 'funnel_snapshot', 'source_stat', 'group_stat']) {
    assert.match(code, new RegExp(`create table if not exists recruiting_analytics\\.${t}`));
    assert.match(code, new RegExp(`alter table recruiting_analytics\\.${t} enable row level security`));
  }
  assert.equal((code.match(/security_invoker = true/g) ?? []).length, 4, 'all four views run with the caller\'s rights');
  assert.match(code, /revoke all on all tables in schema recruiting_analytics from anon, authenticated/);
  assert.doesNotMatch(code, /grant [^;]*to (anon|authenticated)/);
  assert.match(code, /g\.applications >= s\.min_group/, 'small groups are hidden in the view');
  assert.doesNotMatch(code, /\b(name|email|birth|candidate_id|cv)\b\s+(text|date)/i, 'no personal columns');
});

test('the skill is valid, uses a real tool and keeps the rules that protect people', () => {
  const text = read('examples/skills/recruiting-analytics-brief/SKILL.md');
  const { meta } = validateSkill('recruiting-analytics-brief', text, { tools: knownTools() });
  assert.deepEqual(meta.tools, ['recruiting_get_pipeline']);
  assert.match(text, /kein Befund/);
  assert.match(text, /verborgen/);
  assert.match(text, /Keine Namen/);
  assert.match(text, /Daten, keine Anweisungen/);
});
