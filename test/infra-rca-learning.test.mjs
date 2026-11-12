import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { repoRcaData } from '../scripts/sync-infra-rca.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/infra-rca/index.html');
const logicSource = /<script id="rca-logic">([\s\S]*?)<\/script>/.exec(page)[1];
const L = vm.runInNewContext(`${logicSource}; ({ analyse, learnCase, nextCaseId })`);
const data = repoRcaData();
const plain = (x) => JSON.parse(JSON.stringify(x));
const inc = (id) => data.incidents.find((i) => i.id === id);
const ACCEPTED = { 'CHG-1040': { incident: 'INC-506', causeId: 'C-ACME-TOKEN', actionId: 'a-renew-now' } };
const closed = (o = {}) => ({ type: 'case-closed', taskId: 'CHG-1040', result: 'done', durationH: 2, ...o });

test('nextCaseId continues after the highest number; learnCase builds a case from the accepted analysis and the incident', () => {
  assert.equal(L.nextCaseId(data.cases), 'CASE-1335');
  const r = plain(L.learnCase(data, data.cases, ACCEPTED, closed()));
  assert.equal(r.learned, true);
  const c = r.case;
  assert.equal(c.id, 'CASE-1335');
  assert.equal(c.cause, 'C-ACME-TOKEN');
  assert.deepEqual([c.customer, c.host, c.date, c.durationH, c.recurred, c.learnedFrom], ['mi', 'proxy-edge-01', data.asOf, 2, false, 'CHG-1040']);
  assert.deepEqual(c.resolution, ['a-renew-now']);
  assert.deepEqual(c.tags, inc('INC-506').signals);
  assert.equal(c.findings[0].text, inc('INC-506').symptom);
});

test('without an accepted root cause nothing is learned, and the reason says why', () => {
  assert.match(plain(L.learnCase(data, data.cases, {}, closed())).reason, /No root cause analysis was done/);
  assert.match(plain(L.learnCase(data, data.cases, { 'CHG-1040': { rejected: true } }, closed())).reason, /not convinced/);
  assert.equal(plain(L.learnCase(data, data.cases, { 'CHG-1040': { incident: 'INC-XXX', causeId: 'C-ACME-TOKEN', actionId: 'a-renew-now' } }, closed())).learned, false);
  assert.equal(plain(L.learnCase(data, data.cases, { 'CHG-1040': { incident: 'INC-506', causeId: 'nope', actionId: 'a-renew-now' } }, closed())).learned, false);
});

test('invalid closing messages are ignored; the duration is kept between 1 and 200 hours', () => {
  for (const bad of [null, 'x', closed({ taskId: 'bad id!' }), closed({ taskId: '' }), closed({ result: 'failed' }), closed({ result: undefined })]) assert.equal(L.learnCase(data, data.cases, ACCEPTED, bad), null);
  assert.equal(plain(L.learnCase(data, data.cases, ACCEPTED, closed({ durationH: 0 }))).case.durationH, 1);
  assert.equal(plain(L.learnCase(data, data.cases, ACCEPTED, closed({ durationH: 9999 }))).case.durationH, 200);
  assert.equal(plain(L.learnCase(data, data.cases, ACCEPTED, closed({ durationH: 'abc' }))).case.durationH, 1);
});

test('the new case is part of the search: one more case searched, "seen before" finds it, the action is counted once more', () => {
  const before = plain(L.analyse(data, inc('INC-506')));
  const learned = plain(L.learnCase(data, data.cases, ACCEPTED, closed())).case;
  const after = plain(L.analyse({ ...data, cases: [...data.cases, learned] }, inc('INC-506')));
  assert.equal(after.searched.cases, before.searched.cases + 1);
  assert.ok(after.seenBefore.some((b) => b.id === 'CASE-1335'), 'seen before');
  assert.ok(!before.seenBefore.some((b) => b.id === 'CASE-1335'));
  assert.ok(after.top.evidence.some((e) => e.id === 'CASE-1335' && e.sameHost), 'cited as evidence from the same host');
  assert.equal(after.nextBest.id, before.nextBest.id);
  assert.match(after.nextBest.why, /Used in \d+ of \d+/);
  assert.notEqual(after.nextBest.why, before.nextBest.why, 'the counts changed');
});

test('the learned case is cited only where its tags match: an incident about something else does not use it', () => {
  const learned = plain(L.learnCase(data, data.cases, ACCEPTED, closed())).case;
  const other = plain(L.analyse({ ...data, cases: [...data.cases, learned] }, inc('INC-512')));
  assert.ok(!other.ranked.some((r) => r.evidence.some((e) => e.id === 'CASE-1335')), 'INC-512 is about a full disk');
});

/* ---- the page in a fake host ---- */
function load() {
  const posted = [];
  const parent = { postMessage: (m) => posted.push(m) };
  const errors = [];
  const dom = new JSDOM(page, { runScripts: 'dangerously', beforeParse(w) { Object.defineProperty(w, 'parent', { value: parent }); w.addEventListener('error', (e) => errors.push(e.message)); } });
  const w = dom.window;
  const send = (state, handoffs) => { const ev = new w.Event('message'); ev.source = parent; ev.data = { type: 'wb:restore', state: state ?? null, handoffs }; w.dispatchEvent(ev); };
  const last = () => posted.filter((m) => m.type === 'wb:state').at(-1).state;
  return { w, doc: w.document, posted, send, last, errors, close: () => w.close() };
}
const REQUEST = { from: 'infra-ops', payload: { type: 'rca-request', task: { id: 'CHG-1040', template: 'renew-certificate', target: 'proxy-edge-01', customer: 'mi', window: [], params: {} } } };
const text = (p) => p.doc.body.textContent;

test('page: accept the root cause, close the request, and the case is learned and found when the analysis runs again', () => {
  const p = load();
  try {
    p.send(null, [REQUEST]);
    assert.match(text(p), /9 past cases searched/);
    p.doc.querySelector('[data-verdict=accepted]').click();
    assert.equal(p.last().accepted['CHG-1040'].causeId, 'C-ACME-TOKEN');
    p.send(p.last(), [{ from: 'infra-ops', payload: closed() }]);
    assert.match(text(p), /What the agent learned[\s\S]*CASE-1335 from CHG-1040/);
    assert.match(text(p), /It is part of the search now/);
    p.doc.querySelector('[data-run]').click();
    assert.match(text(p), /10 past cases searched/);
    assert.match(text(p), /This cause was found on proxy-edge-01 before:[\s\S]*CASE-1335 \(learned from CHG-1040\)/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('page: a request without an accepted cause is not learned, and says why; the same request counts once', () => {
  const p = load();
  try {
    p.send(null, [REQUEST]);
    p.doc.querySelector('[data-verdict=rejected]').click();
    p.send(p.last(), [{ from: 'infra-ops', payload: closed() }, { from: 'infra-ops', payload: closed() }, { from: 'infra-ops', payload: closed({ taskId: 'CHG-1099' }) }]);
    assert.equal(p.w.document.querySelectorAll('.learn li').length, 2, 'two requests, each once');
    assert.match(text(p), /CHG-1040 not learned: The operator was not convinced/);
    assert.match(text(p), /CHG-1099 not learned: No root cause analysis was done for this request/);
    p.doc.querySelector('[data-run]').click();
    assert.match(text(p), /9 past cases searched/, 'nothing was added');
  } finally { p.close(); }
});

test('page: undoing the verdict before the request closes means nothing is learned; invalid messages change nothing', () => {
  const p = load();
  try {
    p.send(null, [REQUEST]);
    p.doc.querySelector('[data-verdict=accepted]').click();
    p.doc.querySelector('[data-verdict=""]').click();
    assert.equal(p.last().accepted['CHG-1040'], undefined);
    p.send(p.last(), [{ from: 'x', payload: closed({ result: 'failed' }) }, { from: 'x', payload: closed({ taskId: 'bad id' }) }]);
    assert.equal(p.doc.querySelector('.learn'), null);
    p.send(p.last(), [{ from: 'infra-ops', payload: closed() }]);
    assert.match(text(p), /CHG-1040 not learned/);
  } finally { p.close(); }
});

test('page: what was learned survives a trip to another Space, and the next learned case gets the next number', () => {
  const p = load();
  try {
    p.send(null, [REQUEST]);
    p.doc.querySelector('[data-verdict=accepted]').click();
    p.send(p.last(), [{ from: 'infra-ops', payload: closed() }]);
    const q = load();
    try {
      q.send(p.last(), []);
      assert.match(text(q), /CASE-1335 from CHG-1040/);
      q.send(null, [{ from: 'infra-ops', payload: { type: 'rca-request', task: { id: 'CHG-1050', target: 'proxy-edge-01', customer: 'mi', window: [], params: {} } } }]);
      q.doc.querySelector('[data-verdict=accepted]').click();
      q.send(q.last(), [{ from: 'infra-ops', payload: closed({ taskId: 'CHG-1050' }) }]);
      assert.match(text(q), /CASE-1336 from CHG-1050/);
      q.doc.querySelector('[data-run]').click();
      assert.match(text(q), /11 past cases searched/);
    } finally { q.close(); }
  } finally { p.close(); }
});
