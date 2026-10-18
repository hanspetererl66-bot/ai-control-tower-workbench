import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { embeddedData, embedData } from '../scripts/sync-control-tower-data.mjs';

const DIR = join(import.meta.dirname, '..', 'examples/control-tower');
const data = JSON.parse(readFileSync(join(DIR, 'data.json'), 'utf8'));
const html = readFileSync(join(DIR, 'index.html'), 'utf8');

test('index.html embeds exactly the data in data.json', () => {
  assert.deepEqual(embeddedData(html), data);
  assert.equal(embedData(html, data), html, 'run `npm run sync:control-tower`');
});

test('risk records are well-formed', () => {
  const severities = new Set(['high', 'medium', 'low']);
  const tones = new Set(['red', 'amber', 'blue', 'green']);
  const colors = new Set(['red', 'amber', 'blue', 'purple', 'green']);
  const ids = new Set();
  assert.ok(data.risks.length > 0);
  for (const risk of data.risks) {
    assert.ok(!ids.has(risk.id), `duplicate id ${risk.id}`);
    ids.add(risk.id);
    assert.ok(severities.has(risk.severity), `${risk.id} severity`);
    assert.ok(tones.has(risk.etaTone), `${risk.id} etaTone`);
    assert.ok(colors.has(risk.progressColor), `${risk.id} progressColor`);
    assert.ok(Number.isInteger(risk.progressPct) && risk.progressPct >= 0 && risk.progressPct <= 100, `${risk.id} progressPct`);
    for (const key of ['title', 'description', 'owner', 'ownerTeam', 'eta', 'progressNote', 'action', 'tile', 'short']) {
      assert.equal(typeof risk[key], 'string', `${risk.id}.${key}`);
      assert.ok(risk[key].length > 0, `${risk.id}.${key} is empty`);
    }
  }
});

test('the page has the containers the renderer fills, and no hand-written risk rows', () => {
  assert.match(html, /id="risk-summary"/);
  assert.match(html, /<tbody id="risk-register-body"><\/tbody>/);
  assert.doesNotMatch(html, /Instability \(20%\)/);
});

test('net annual return is stated consistently', () => {
  assert.doesNotMatch(html, /&euro;134M/);
});

test('agent registry numbers add up', () => {
  const a = data.agents;
  const sum = (items, key) => items.reduce((n, item) => n + item[key], 0);
  assert.equal(sum(a.types, 'count'), a.total, 'agent types must add up to the registry total');
  assert.equal(sum(a.accessTiers, 'count'), a.production, 'access tiers must add up to production agents');
  assert.ok(a.production <= a.total);
  assert.ok(a.discovery.length < a.unregistered, 'listed assets must be fewer than all unregistered assets');
  assert.ok(sum(a.overprivilegedQueue, 'count') < a.overprivileged, 'queue must leave a remainder for "+ N more"');
  assert.ok(a.overprivileged <= a.production);
});

test('risk register agrees with the agent registry', () => {
  const byId = Object.fromEntries(data.risks.map((risk) => [risk.id, risk]));
  assert.match(byId.R2.title, new RegExp(`\\(${data.agents.overprivileged}\\)`));
  assert.match(byId.R3.title, new RegExp(`^${data.agents.unregistered} unregistered`));
});

test('budget groups are well-formed', () => {
  assert.ok(data.budget.groups.length > 0);
  for (const group of data.budget.groups) {
    assert.ok(Number.isInteger(group.budgetK) && group.budgetK > 0, group.name);
    assert.ok(Number.isInteger(group.utilisationPct) && group.utilisationPct >= 0, group.name);
  }
  assert.ok(data.budget.totalActualM <= data.budget.ceilingM);
});

test('registry and budget sections are rendered from data, not hand-written', () => {
  for (const id of ['agent-types', 'discovery-body', 'op-queue', 'access-tiers', 'budget-groups']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /BTP Extension Agent \(prod\)<\/td>/);
  assert.doesNotMatch(html, /Engineering \(budget &euro;1\.1M\)/);
});

test('budget team rows add up to the stated ceiling and actual', () => {
  const { groups, ceilingM, totalActualM } = data.budget;
  const budgetK = groups.reduce((sum, group) => sum + group.budgetK, 0);
  const actualK = groups.reduce((sum, group) => sum + Math.round((group.budgetK * group.utilisationPct) / 100), 0);
  assert.equal(budgetK, Math.round(ceilingM * 1000));
  assert.equal(actualK, Math.round(totalActualM * 1000));
  assert.equal(new Set(groups.map((group) => group.name)).size, groups.length);
});

test('every data-bound fact in the page shows its current value without scripts', () => {
  const resolve = (path) =>
    path === 'derived.highRisks'
      ? data.risks.filter((risk) => risk.severity === 'high').length
      : path.split('.').reduce((value, key) => value?.[key], data);
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const bound = [...markup.matchAll(/<span data-ct="([\w.]+)">([^<]*)<\/span>/g)];
  assert.ok(bound.length >= 25, `only ${bound.length} bound facts`);
  for (const [, path, text] of bound) {
    const value = resolve(path);
    assert.notEqual(value, undefined, `unknown path ${path}`);
    assert.equal(text.replaceAll('&nbsp;', ' ').replaceAll('&lsquo;', "'"), String(value), path);
  }
});

test('the EU AI Act audit is on 12 Dec 2026 everywhere, and its counts agree', () => {
  const { euAiAct } = data.compliance;
  assert.equal(euAiAct.auditDate, '2026-12-12');
  assert.equal(euAiAct.complete + euAiAct.outstanding, euAiAct.total);
  const r6 = data.risks.find((risk) => risk.id === 'R6');
  assert.match(r6.eta, /12 Dec 2026/);
  assert.match(r6.description, new RegExp(`${euAiAct.total} agents`));
  assert.match(r6.description, new RegExp(`${euAiAct.outstanding} outstanding`));
  const text = html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
  for (const stale of [/February/, /Feb 2027/, /Feb&nbsp;&lsquo;27/, /Feb&nbsp;'27/, /end of January/]) {
    assert.doesNotMatch(text, stale, String(stale));
  }
});

test('the explanation tabs are gone and every tab button has exactly one page', () => {
  const buttons = [...html.matchAll(/onclick="go\('(\w+)',this\)"/g)].map((match) => match[1]);
  const pages = [...html.matchAll(/<section id="page-(\w+)" class="pg/g)].map((match) => match[1]);
  assert.deepEqual(buttons, pages);
  for (const removed of ['primer', 'model', 'intro']) assert.ok(!pages.includes(removed), removed);
  assert.ok(!/Tab Explanation|Model on a page/.test(html));
  assert.equal(html.match(/<section id="page-\w+" class="pg on"/g)?.length, 1); // one default page
  assert.match(html, /class="tb on"\s+onclick="go\('board'/);
});
