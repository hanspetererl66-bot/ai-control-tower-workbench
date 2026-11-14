import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync(join(import.meta.dirname, '../examples/renewals/index.html'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

/** The page inside the app, with a fake host that answers rn:cases-request like the main process (revisions, conflicts, own cases only). */
async function hosted({ me = { email: 'mira@x.test', owners: ['Mira Hoffmann'], manager: false, admin: false }, stored = [], listError = '', saveError = '' } = {}) {
  const requests = [], errors = [], db = new Map();
  for (const c of stored) db.set(c.caseId + '|' + c.kind, { ...c });
  let w;
  const answer = (m, body) => setTimeout(() => w.dispatchEvent(Object.assign(new w.Event('message'), { source: w.parent, data: { type: 'rn:cases-answer', requestId: m.requestId, action: m.action, ...body } })), 0);
  const parent = { postMessage: (m) => {
    if (m.type !== 'rn:cases-request') return;
    requests.push(structuredClone(m));
    if (m.action === 'list') return answer(m, listError ? { ok: false, error: listError } : { ok: true, data: { me, cases: [...db.values()] } });
    if (saveError) return answer(m, { ok: false, error: saveError });
    const k = m.caseId + '|' + m.kind;
    if (m.action === 'save') {
      const cur = db.get(k);
      if ((cur ? cur.rev : 0) !== m.expectedRev) return answer(m, { ok: false, error: 'conflict: this case was changed elsewhere, reload' });
      db.set(k, { caseId: m.caseId, kind: m.kind, owner: m.owner, state: m.state, rev: (cur ? cur.rev : 0) + 1, canChange: true });
      return answer(m, { ok: true, data: { caseId: m.caseId, kind: m.kind, rev: (cur ? cur.rev : 0) + 1 } });
    }
    if (m.action === 'reset') { if (!db.delete(k)) return answer(m, { ok: false, error: 'there is no active case to reset' }); return answer(m, { ok: true, data: { archived: true } }); }
  } };
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const x = String(e.message || e); if (!/scrollIntoView/.test(x)) errors.push(x); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(win) { w = win; Object.defineProperty(win, 'parent', { value: parent }); win.ResizeObserver = class { observe() {} disconnect() {} }; } });
  await wait(150);
  return { w, requests, errors, db, q: (s) => w.document.querySelector(s), qa: (s) => [...w.document.querySelectorAll(s)], saves: () => requests.filter((r) => r.action === 'save') };
}

test('store page: the cases are loaded at the start, only own cases start, every change is saved with its revision', async () => {
  const p = await hosted();
  assert.equal(p.requests[0].action, 'list');
  click(p.w, p.q('#tab-autopilot'));
  await wait(50);
  assert.match(p.q('#ap-store').textContent, /stored in the shared database.*Mira Hoffmann/);
  click(p.w, p.q('#ap-run'));
  await wait(200);
  const mine = p.w.__renewals().filter((c) => c.owner === 'Mira Hoffmann' && c.stage < 4);
  const started = p.saves();
  assert.ok(started.length > 0 && started.length >= mine.filter((c) => c.status !== 'Lapsed').length, 'a case per renewal of this owner');
  assert.ok(started.every((r) => r.owner === 'Mira Hoffmann' && r.expectedRev === 0 && r.state.status), 'only own cases, new ones at revision 0');
  assert.ok(started.every((r) => !('actor' in r) && !('email' in r)), 'the page never names a person');
  assert.equal(p.qa('.apcase').length > 0, true);
  assert.ok(Math.max(...started.map((r) => JSON.stringify(r.state).length)) < 20000, 'a case is far below the 64 KB limit of the database');
  const n = p.saves().length;
  await wait(100);
  assert.equal(p.saves().length, n, 'nothing changed, nothing is saved again');
  const gate = p.qa('.apcase.st-waiting-person [data-apa=approve]')[0];
  assert.ok(gate, 'the sample data has a case that waits at a gate');
  {
    const id = gate.dataset.id, key = id + '|renewal';
    click(p.w, gate);
    await wait(150);
    const last = p.saves().filter((r) => r.caseId === id).at(-1);
    assert.equal(last.expectedRev, 1, 'the second save carries the revision of the first');
    assert.equal(p.db.get(key).rev, 2);
    assert.ok(p.db.get(key).state.log.length > 5);
  }
  assert.doesNotMatch(p.q('#ap-store').textContent, /Not saved/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('store page: stored cases come back at the next start; a reset archives them', async () => {
  const first = await hosted();
  click(first.w, first.q('#tab-autopilot')); click(first.w, first.q('#ap-run'));
  await wait(200);
  const stored = [...first.db.values()];
  const count = first.qa('.apcase').length;
  assert.ok(stored.length > 0 && count > 0);
  first.w.close();
  const again = await hosted({ stored });
  click(again.w, again.q('#tab-autopilot'));
  await wait(50);
  assert.equal(again.qa('.apcase').length, count, 'the same cases after a restart');
  assert.equal(again.saves().length, 0, 'what was loaded is not saved again');
  click(again.w, again.q('#ap-reset'));
  await wait(200);
  assert.equal(again.qa('.apcase').length, 0);
  assert.equal(again.requests.filter((r) => r.action === 'reset').length, stored.length);
  assert.equal(again.db.size, 0);
  again.w.close();
});

test('store page: a manager sees the cases of others but cannot operate or start them', async () => {
  const first = await hosted();
  click(first.w, first.q('#tab-autopilot')); click(first.w, first.q('#ap-run'));
  await wait(200);
  const stored = [...first.db.values()].map((c) => ({ ...c, canChange: false }));
  first.w.close();
  const m = await hosted({ stored, me: { email: 'vertrieb@x.test', owners: [], manager: true, admin: false } });
  click(m.w, m.q('#tab-autopilot'));
  await wait(50);
  assert.match(m.q('#ap-store').textContent, /only read them/);
  assert.ok(m.qa('.apcase').length > 0);
  assert.ok(m.qa('.apcase button, .apcase select').every((b) => b.disabled), 'nothing can be operated');
  click(m.w, m.q('#ap-run'));
  await wait(150);
  assert.equal(m.saves().length, 0, 'a manager writes nothing');
  assert.equal(m.qa('.apcase').length, stored.length, 'and starts nothing');
  m.w.close();
});

test('store page: without the database the page works from memory and says why; a refused save is shown as "Not saved"', async () => {
  const none = await hosted({ listError: 'The shared database is not set up.' });
  click(none.w, none.q('#tab-autopilot'));
  await wait(50);
  assert.match(none.q('#ap-store').textContent, /stay in memory only: The shared database is not set up/);
  click(none.w, none.q('#ap-run'));
  await wait(100);
  assert.ok(none.qa('.apcase').length > 0, 'the autopilot still works');
  assert.equal(none.saves().length, 0);
  none.w.close();
  const refused = await hosted({ saveError: 'you may not change this case' });
  click(refused.w, refused.q('#tab-autopilot')); click(refused.w, refused.q('#ap-run'));
  await wait(200);
  assert.match(refused.q('#ap-store').textContent, /Not saved: you may not change this case/);
  assert.ok(refused.qa('.apcase').length > 0, 'the work stays on the page');
  const n = refused.saves().length;
  await wait(100);
  assert.equal(refused.saves().length, n, 'a refused state is not retried in a loop');
  refused.w.close();
});

test('store page: a revision conflict reloads the cases from the database', async () => {
  const p = await hosted();
  click(p.w, p.q('#tab-autopilot')); click(p.w, p.q('#ap-run'));
  await wait(200);
  const [key, cur] = [...p.db.entries()].find(([, v]) => v.state.gate === 'approve') || [...p.db.entries()][0];
  p.db.set(key, { ...cur, rev: cur.rev + 5 }); // somebody else saved in between
  const before = p.requests.filter((r) => r.action === 'list').length;
  const btn = p.qa(`.apcase[data-case="${cur.caseId}"] button`).find((b) => !b.disabled);
  assert.ok(btn);
  click(p.w, btn);
  await wait(250);
  assert.ok(p.requests.filter((r) => r.action === 'list').length > before, 'the page reloads after the conflict');
  p.w.close();
});

test('store page: outside the app nothing is asked or saved', async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.test/', beforeParse(w) { w.ResizeObserver = class { observe() {} disconnect() {} }; } });
  await wait(100);
  const w = dom.window;
  click(w, w.document.querySelector('#tab-autopilot'));
  click(w, w.document.querySelector('#ap-run'));
  assert.ok(w.document.querySelectorAll('.apcase').length > 0);
  assert.equal(w.document.querySelector('#ap-store').textContent, '');
  w.close();
});
