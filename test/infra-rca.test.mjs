import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { embedRca, repoRcaData } from '../scripts/sync-infra-rca.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/infra-rca/index.html');
const logicSource = /<script id="rca-logic">([\s\S]*?)<\/script>/.exec(page)[1];
const L = vm.runInNewContext(`${logicSource}; ({ analyse, needsAgreement, threshold, isWithheld })`);
const data = repoRcaData();
const plain = (x) => JSON.parse(JSON.stringify(x)); // the sandbox has its own Object prototype
const inc = (id) => data.incidents.find((i) => i.id === id);
const run = (id) => plain(L.analyse(data, inc(id)));

test('page embeds the current data and design system, is installable, has no network or storage access', () => {
  assert.equal(embedRca(page, data, read('examples/shared/design-system.css')), page, 'run npm run sync:infra-rca');
  assert.equal(EXAMPLE_SPACES['infra-rca'], 'infra-rca');
  assert.ok(SPACE_PAGES.includes('examples/infra-rca/index.html'));
  const code = page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
  assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket/);
  assert.doesNotMatch(code.replace(/<style[\s\S]*?<\/style>/g, ''), /#[0-9a-fA-F]{3,8}\b/, 'colours only as tokens');
  assert.equal(JSON.parse(read('examples/infra-rca/space.json')).title, 'Root Cause Analysis');
});

test('the certificate incident: the token rotation is named with evidence from cases and documents, confidence high, seen on this host before', () => {
  const r = run('INC-506');
  assert.equal(r.top.cause.id, 'C-ACME-TOKEN');
  assert.equal(r.confidence, 'high');
  const ids = r.top.evidence.map((e) => e.id);
  for (const id of ['CASE-1160', 'CASE-1187', 'CASE-1243', 'DOC-CHG-0730', 'DOC-PM-0212']) assert.ok(ids.includes(id), id);
  assert.deepEqual(r.seenBefore.map((s) => s.id), ['CASE-1160'], 'the same cause on proxy-edge-01 in February');
  assert.ok(r.ranked.some((x) => x.cause.id === 'C-CERT-MANUAL'), 'the weaker alternative is listed, not hidden');
  assert.ok(r.ranked[0].share > 0.9);
});

test('every quote is a literal sentence of its source, and every claim names its source', () => {
  for (const i of data.incidents) {
    const r = run(i.id);
    for (const hyp of r.ranked) for (const e of hyp.evidence) {
      const src = (e.kind === 'case' ? data.cases : data.docs).find((s) => s.id === e.id);
      assert.ok(src, `${i.id}: ${e.id} exists`);
      assert.ok(src.findings.some((f) => f.text === e.quote), `${i.id}: quote of ${e.id} is a sentence of the source`);
    }
  }
});

test('a note with an instruction to AI assistants is withheld and never counted', () => {
  assert.equal(L.isWithheld(data.docs.find((d) => d.id === 'DOC-NOTE-77')), true);
  for (const i of data.incidents) {
    const r = run(i.id);
    assert.deepEqual(r.searched.withheld, ['DOC-NOTE-77']);
    assert.ok(!JSON.stringify(r.ranked).includes('DOC-NOTE-77'), `${i.id}: not used as evidence`);
  }
  const clean = structuredClone(data); clean.docs = clean.docs.filter((d) => d.id !== 'DOC-NOTE-77');
  assert.equal(JSON.stringify(plain(L.analyse(clean, inc('INC-506'))).ranked), JSON.stringify(run('INC-506').ranked), 'the result is the same without the note');
});

test('the next best action: what fixed the cause before, with the prerequisite first, and the policy decides about the customer call', () => {
  const r = run('INC-506').nextBest;
  assert.equal(r.id, 'a-renew-now');
  assert.deepEqual(r.steps.map((s) => s.id), ['a-fix-token', 'a-renew-now'], 'renewing without a valid token would fail again');
  assert.equal(r.route, 'service-request', '2 h for Muster Industrie is within the threshold of 2 h');
  assert.match(r.text, /standard window, no call/);
  assert.match(r.why, /3 of 3/);
  assert.match(r.why, /deadline is 5 days/);
  // an operations task without downtime needs no service request
  const disk = run('INC-512');
  assert.equal(disk.top.cause.id, 'C-NO-RETENTION');
  assert.equal(disk.nextBest.route, 'ops-task');
  assert.deepEqual(disk.prevention.map((p) => p.id), ['a-retention']);
  assert.ok(disk.seenBefore.some((s) => s.id === 'CASE-1275' && s.recurred), 'the volume was extended before and the problem came back');
});

test('the hypothesis can lose: the sync incident is medium confidence with a second hypothesis whose action needs the customer on the phone', () => {
  const r = run('INC-503');
  assert.equal(r.top.cause.id, 'C-EGRESS');
  assert.equal(r.confidence, 'medium');
  assert.equal(r.nextBest.id, 'a-open-egress');
  assert.equal(r.ifNot.cause.id, 'C-TRUST-CHAIN');
  assert.equal(r.ifNot.action.id, 'a-trust-update');
  assert.equal(r.ifNot.action.route, 'service-request-hotline', 'a 4 h patch window is above the 1 h threshold of Muster Industrie');
});

test('without evidence there is no root cause', () => {
  const none = plain(L.analyse(data, { ...inc('INC-506'), signals: ['gpu-fault'] }));
  assert.equal(none.confidence, 'not evidenced');
  assert.equal(none.top, null);
  assert.match(none.text, /Nothing is guessed/);
});

test('the policy rule is the same as in the Customer Hotline, and the copy of the policy is current', () => {
  const hot = JSON.parse(read('examples/infra-hotline/data.json')), hotLogic = /<script id="hot-logic">([\s\S]*?)<\/script>/.exec(read('examples/infra-hotline/index.html'))[1];
  const H = vm.runInNewContext(`${hotLogic}; ({ needsAgreement })`);
  assert.deepEqual(plain(data.policy), hot.policy, 'same policy as the Customer Hotline');
  for (const c of hot.customers) for (const t of hot.templates) for (const hours of [0, 1, 2, 3, 4, 6, 8]) {
    const req = { customer: c.id, template: t.id, hours };
    assert.equal(L.needsAgreement(data.policy, req).needed, H.needsAgreement(hot.policy, req).needed, `${c.id} ${t.id} ${hours}`);
  }
});

test('data is consistent: causes, actions and customers exist, the story alert is the incident', () => {
  const causes = new Set(data.causes.map((c) => c.id)), actions = new Set(data.actions.map((a) => a.id)), tpl = new Set(data.templates.map((t) => t.id));
  for (const c of data.cases) { assert.ok(causes.has(c.cause), c.id); for (const a of c.resolution) assert.ok(actions.has(a), `${c.id}: ${a}`); assert.ok(c.findings.length >= 1); }
  for (const a of data.actions) { if (a.template) assert.ok(tpl.has(a.template)); for (const r of a.requires || []) assert.ok(actions.has(r)); }
  const alerts = JSON.parse(read('examples/it-operations/alerts.json')).alerts;
  const a506 = alerts.find((a) => a.id === 'A-506');
  assert.equal(inc('INC-506').host, a506.host);
  assert.equal(inc('INC-503').host, alerts.find((a) => a.id === 'A-503').host);
  assert.equal(new Set(data.cases.map((c) => c.id)).size, data.cases.length);
  const ops = JSON.parse(read('examples/infra-ops/data.json'));
  for (const c of data.customers) assert.ok(ops.customers.some((o) => o.id === c.id && o.name === c.name));
});

test('in the page: run the analysis, read the next best action, accept the root cause, switch the incident', () => {
  const dom = new JSDOM(page, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { document } = dom.window, text = () => document.querySelector('#view').textContent;
  assert.match(text(), /Pick an incident and start the analysis/);
  document.querySelector('[data-run]').click();
  assert.match(text(), /Most likely root cause/);
  assert.match(text(), /DNS API token/);
  assert.match(text(), /withheld DOC-NOTE-77/i);
  assert.match(text(), /Next best action/);
  assert.match(text(), /Replace the DNS API token/);
  assert.match(text(), /Confirm first/);
  document.querySelector('[data-verdict="accepted"]').click();
  assert.match(text(), /Root cause accepted by the operator/);
  document.querySelector('[data-inc="INC-503"]').click();
  assert.doesNotMatch(text(), /accepted by the operator/, 'a new incident starts clean');
  document.querySelector('[data-run]').click();
  assert.match(text(), /If the check shows otherwise/);
  assert.match(text(), /Service request \+ customer call/);
  dom.window.close();
});
