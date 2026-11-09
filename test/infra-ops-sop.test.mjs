import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { ORCHESTRATION, PLAYBOOKS, createInfraOpsHandlers, planTask } from '../connectors/_lib/server/infra-ops.mjs';
import { repoData } from '../scripts/sync-infra-ops.mjs';

const data = repoData();
const wiki = JSON.parse(readFileSync(new URL('../examples/infra-wiki/pages.json', import.meta.url), 'utf8'));
const win = ['2026-11-10T22:00', '2026-11-11T00:00'];
const plan = (template, target) => planTask(data, { template, target, window: win, state: 'planned' });
class ToolError extends Error {}

test('two SOPs, one per typical operation, each tied to an approved playbook and to a page of the internal wiki', () => {
  assert.deepEqual(data.sops.map((s) => s.template).sort(), ['patch-vm', 'renew-certificate']);
  for (const s of data.sops) {
    assert.equal(PLAYBOOKS[s.template].status, 'approved', s.id);
    const page = wiki.pages.find((p) => p.id === s.page.id);
    assert.ok(page, `${s.id}: wiki page`);
    assert.deepEqual([s.page.path, s.page.version, s.page.updated, s.page.status], [page.path, page.version, page.updated, page.status], `${s.id}: page header matches the wiki`);
    assert.equal(page.template, s.template);
  }
});

test('the SOP steps are the wiki steps: same order, title, text and orchestration step', () => {
  for (const sop of data.sops) {
    const page = wiki.pages.find((p) => p.id === sop.page.id);
    assert.equal(sop.steps.length, page.steps.length, sop.id);
    sop.steps.forEach((st, i) => {
      const w = page.steps[i];
      assert.equal(st.wikiStep, i + 1);
      assert.deepEqual([st.id, st.title, st.orch, st.text], [w.id, w.title, w.orch, w.summary], `${sop.id} step ${i + 1}`);
      assert.ok(st.does, `${sop.id} step ${i + 1}: what the automation does`);
      assert.equal(Boolean(st.extra), Boolean(w.extra), `${sop.id} step ${i + 1}: extra`);
    });
  }
});

test('the wiki pages are complete: roles, before you start, steps with who, tool, what to do, done when and failure; rollback and evidence', () => {
  assert.equal(wiki.pages.length, 2);
  for (const p of wiki.pages) {
    for (const k of ['purpose', 'scope', 'rollback', 'owner', 'reviewer', 'version', 'updated']) assert.ok(p[k], `${p.id}: ${k}`);
    assert.ok(p.roles.length >= 3 && p.before.length >= 2 && p.evidence.length >= 2);
    for (const s of p.steps) for (const k of ['who', 'tool', 'summary', 'doneWhen', 'onFailure']) assert.ok(s[k], `${p.id}/${s.id}: ${k}`);
    for (const s of p.steps) assert.ok(s.do.length >= 2, `${p.id}/${s.id}: what to do`);
    for (const r of p.related) assert.ok(wiki.pages.some((x) => x.id === r), `${p.id}: related ${r}`);
  }
});

test('end to end: every orchestration step is covered by the SOP, in order, and nothing points outside the flow', () => {
  for (const sop of data.sops) {
    const order = sop.steps.map((st) => ORCHESTRATION.findIndex((o) => o.id === st.orch));
    assert.ok(order.every((i) => i >= 0), `${sop.id}: unknown orchestration step`);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${sop.id}: steps run in orchestration order`);
    for (const o of ORCHESTRATION) assert.ok(sop.steps.some((st) => st.orch === o.id), `${sop.id}: ${o.id} has no SOP step`);
  }
});

test('the plan carries the SOP, and its extra steps join the technical flow', () => {
  const cert = plan('renew-certificate', 'mi-ariba-gw'), patch = plan('patch-vm', 'mi-qas-db01');
  assert.equal(cert.sop.id, 'sop-renew-certificate');
  assert.equal(patch.sop.id, 'sop-patch-vm');
  assert.ok(cert.steps.some((s) => s.id === 'sop-csr') && cert.steps.some((s) => s.id === 'sop-enrol'));
  assert.ok(patch.steps.some((s) => s.id === 'sop-twin'));
  assert.equal(plan('update-dns-record', 'mi-s4').sop, null, 'no SOP for the other playbooks yet');
  assert.deepEqual(cert.steps.slice(-ORCHESTRATION.length).map((s) => s.id), ORCHESTRATION.map((s) => s.id));
});

test('read_wiki_page returns the pages to the agent, lists them, and refuses unknown ones', () => {
  const h = createInfraOpsHandlers({ ToolError, loadWiki: () => wiki });
  assert.deepEqual(h.read_wiki_page({}).pages.map((p) => p.id), ['renew-tls-certificate', 'patch-vm']);
  const page = h.read_wiki_page({ page: 'patch-vm' });
  assert.equal(page.steps.length, 10);
  assert.equal(page.view.space, 'infra-wiki');
  assert.throws(() => h.read_wiki_page({ page: '../../etc/passwd' }), ToolError);
  assert.equal(h.plan_infra_change({ template: 'patch-vm', target: 'mi-qas-db01', window_start: win[0], window_end: win[1] }).sop.steps.length, 10);
});

const opened = [];
after(() => opened.forEach((w) => w.close()));
function load(slug) {
  const html = readFileSync(new URL(`../examples/${slug}/index.html`, import.meta.url), 'utf8');
  assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|https?:\/\/(?!www\.w3\.org)/, `${slug}: no network, no address`);
  const dom = new JSDOM(html, { runScripts: 'dangerously', beforeParse(win) { win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }); win.HTMLElement.prototype.scrollIntoView = () => {}; } });
  opened.push(dom.window);
  return dom.window;
}

test('the Infra Wiki Space shows both pages with their steps', () => {
  const w = load('infra-wiki');
  const text = () => w.document.querySelector('#page').textContent;
  for (const p of wiki.pages) {
    w.__wiki.S.id = p.id; w.__wiki.render();
    assert.ok(text().includes(p.title) && text().includes(`Version ${p.version}`));
    assert.equal(w.document.querySelectorAll('.stepcard').length, p.steps.length);
    p.steps.forEach((s, i) => assert.ok(text().includes(`Step ${i + 1}: ${s.title}`)));
  }
});

test('Infrastructure Operations lists both SOPs with their wiki page and shows the SOP of an open task', () => {
  const w = load('infra-ops');
  w.__io.S.tab = 'playbooks'; w.__io.render();
  const main = w.document.querySelector('#main').textContent;
  for (const sop of data.sops) { assert.ok(main.includes(sop.title), sop.title); assert.ok(main.includes(sop.page.path), sop.page.path); }
  assert.equal(w.document.querySelectorAll('[data-sopask]').length, 2);
  assert.equal(w.document.querySelectorAll('[data-sopopen]').length, 2);
  w.__io.openTask(data.tasks.find((x) => x.template === 'renew-certificate').id);
  const drawer = w.document.body.textContent;
  assert.ok(drawer.includes('SOP: Renew a TLS certificate') && drawer.includes('Wiki step 3') && drawer.includes('Generate key pair and CSR'));
});
