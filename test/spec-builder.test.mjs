import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { buildArchitecture, buildFunctionalSpec, DRAFT_START, docFacts, draftPrompt, parsePrd, prdBrief, replaceSectionBody } from '../examples/spec-builder/spec-model.mjs';
import { buildPrd } from '../examples/prd-builder/prd-model.mjs';
import { demoPrd, embedSpecBuilder, modelSource } from '../scripts/sync-spec-builder.mjs';
import { fromLinear, fromNotion, fromSlack } from '../src/prd-sources.ts';
import { handleSpecMessage, DRAFT_START as BRIDGE_START, MAX_DRAFT_ANSWER, MAX_DRAFT_PROMPT } from '../src/spec-bridge.ts';
import { parseHandoffMessage, MAX_HANDOFF_BYTES } from '../src/space-handoff.ts';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const page = read('examples/spec-builder/index.html');
const prdPage = read('examples/prd-builder/index.html');
const demo = JSON.parse(read('examples/prd-builder/demo-sources.json'));
const issues = [...fromLinear(demo.linear), ...fromSlack(demo.slack.messages, 'sales-feedback'), ...fromNotion(demo.notion)];
const prdMd = buildPrd({ project: 'Mixed', issues, selectedKeys: issues.map((i) => i.key), today: '2026-11-14' });

test('the Space is installable, carries the design system and its page is in sync with the models', () => {
  assert.equal(EXAMPLE_SPACES['spec-builder'], 'spec-builder');
  assert.ok(SPACE_PAGES.includes('examples/spec-builder/index.html'));
  assert.equal(embedSpecBuilder(page, read('examples/spec-builder/spec-model.mjs'), read('examples/shared/design-system.css')), page, 'run: npm run sync:spec-builder');
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage/, 'Spaces have no network and no localStorage');
  assert.doesNotMatch(page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style id="design-system">[\s\S]*?<\/style>/, ''), /#[0-9a-f]{3,6}\b/i, 'only tokens outside the design system');
});

test('parse: title, goals, roles, requirements with group, source key, priority, text, criteria and notes, open questions', () => {
  const p = parsePrd(prdMd);
  assert.equal(p.title, 'Mixed');
  assert.equal(p.requirements.length, 10);
  const r1 = p.requirements.find((r) => r.key === 'SAL-41');
  assert.equal(r1.group, 'Pipeline view'); assert.equal(r1.priority, 'High'); assert.equal(r1.criteria.length, 3);
  assert.match(r1.need.join(' '), /^As a seller I want a kanban view/);
  const note = p.requirements.find((r) => r.note === 'Slack');
  assert.ok(note && note.quote.length > 0 && note.criteria.length === 0);
  assert.deepEqual(p.roles.map((r) => r.name).sort(), ['account executive', 'sales manager', 'seller', 'unnamed role']);
  assert.ok(p.open.length >= 6 && p.sources.length === 14 && p.goals.includes('Pipeline view'));
  assert.deepEqual(parsePrd('').requirements, []);
  assert.deepEqual(parsePrd('nothing useful here').groups, []);
});

test('functional specification: every requirement gets a place with its source, open parts are marked, nothing is invented', () => {
  const p = parsePrd(prdMd), md = buildFunctionalSpec(p, '2026-11-14');
  assert.match(md, /^# Functional specification: Mixed/);
  for (const r of p.requirements) assert.match(md, new RegExp(`\\*\\*FR-${r.n} · ${r.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\* \\(from R${r.n}, ${r.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(md, /Acceptance criteria:\n- One column per stage/);
  assert.match(md, /From a note \(Slack\), not yet phrased as a requirement: “/);
  assert.equal((md.match(/Behaviour: To be specified\./g) || []).length, 10);
  assert.match(md, /## 8\. Open points[\s\S]*From the PRD: /);
  assert.match(md, /FR-\d+ has no acceptance criteria yet\./);
  assert.match(md, /## 9\. Traceability[\s\S]*FR-1 ← R1 \(SAL-41\)/);
  const nums = [...md.matchAll(/^## (\d+)\./gm)].map((m) => +m[1]); assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.match(buildFunctionalSpec(parsePrd(''), 'd'), /No requirements found in the PRD/);
});

test('architecture: one building block and one decision per group, technology is left to be decided, traceability to the requirements', () => {
  const p = parsePrd(prdMd), md = buildArchitecture(p, '2026-11-14');
  assert.match(md, /^# Technical solution architecture: Mixed/);
  for (const g of p.groups) assert.ok(md.includes(`**Building block: ${g}**`), g);
  assert.equal((md.match(/\*\*ADR-\d+ · /g) || []).length, p.groups.length + 2);
  assert.match(md, /Technology: To be decided\./);
  assert.match(md, /\*\*Availability\*\*: target To be specified\./);
  assert.match(md, /## 10\. Traceability[\s\S]*Pipeline view ← FR-1, FR-2/);
  assert.doesNotMatch(md, /\b(AWS|Azure|Kubernetes|PostgreSQL|React|Java)\b/, 'no technology is invented');
  assert.match(md, /Technology, hosting and integrations are not decided yet\./);
});

test('facts, the drafting prompt and the replacement of a section', () => {
  const fs = buildFunctionalSpec(parsePrd(prdMd), 'd'), f = docFacts(fs);
  assert.equal(f.title, 'Mixed'); assert.equal(f.sections, 9); assert.ok(f.placeholders >= 20); assert.ok(f.open.length >= 6);
  const p = parsePrd(prdMd), prompt = draftPrompt('fs', p, 'Roles and permissions', '- seller: SAL-41');
  assert.ok(prompt.startsWith(DRAFT_START)); assert.match(prompt, /BEGIN FACTS[\s\S]*FR-1 \(Pipeline view, High\)[\s\S]*END FACTS/);
  assert.match(prompt, /Do not invent systems/); assert.ok(prompt.length < MAX_DRAFT_PROMPT);
  assert.ok(draftPrompt('arch', p, 'x', '').includes('technical solution architecture'));
  assert.ok(prdBrief({ title: 't', goals: [], roles: [], open: [], requirements: Array.from({ length: 500 }, (_, i) => ({ n: i, group: 'g', priority: '', summary: 's'.repeat(50), need: ['n'.repeat(50)], quote: [], criteria: [] })) }, 6000).length <= 6000);
  assert.equal(replaceSectionBody('# T\n\n## 1. A\n\nold\n\n## 2. B\n\nb\n', 1, '- new'), '# T\n\n## 1. A\n\nold\n\n## 2. B\n\n- new\n');
  assert.equal(replaceSectionBody('# T\n\n## 1. A\n\nold\n', 5, 'x'), '# T\n\n## 1. A\n\nold\n');
  assert.equal(BRIDGE_START.test(prompt), true);
});

test('bridge: only a drafting prompt with the fixed start runs, without tools and in a conversation of its own; Word only when confirmed', async () => {
  const calls = [];
  const deps = { ask: async (prompt, title, session) => { calls.push([prompt, title, session]); return '  - one\n- two  '; }, exportDocx: async (p) => ({ ok: true, path: '/tmp/s.docx', bytes: 2048, title: p.title }) };
  const good = draftPrompt('fs', parsePrd(prdMd), 'Roles', 'x');
  assert.deepEqual(await handleSpecMessage({ type: 'spec:draft-request', requestId: 'd1', prompt: good }, deps), { type: 'spec:draft-answer', requestId: 'd1', text: '- one\n- two' });
  assert.match(calls[0][0], /^Use no tools and read no files\./); assert.equal(calls[0][1], 'Specification draft'); assert.equal(calls[0][2], '');
  for (const bad of ['Write me a poem.', ' ' + good, '', 42]) assert.match((await handleSpecMessage({ type: 'spec:draft-request', requestId: 'd2', prompt: bad }, deps)).message, /not one the Spec Builder may send/);
  assert.match((await handleSpecMessage({ type: 'spec:draft-request', requestId: 'd3', prompt: good + 'x'.repeat(MAX_DRAFT_PROMPT) }, deps)).message, /too long/);
  assert.match((await handleSpecMessage({ type: 'spec:draft-request', requestId: 'd4', prompt: good }, {})).message, /agent is not connected/);
  assert.match((await handleSpecMessage({ type: 'spec:draft-request', requestId: 'd5', prompt: good }, { ask: async () => '  ' })).message, /stopped/);
  assert.match((await handleSpecMessage({ type: 'spec:draft-request', requestId: 'd6', prompt: good }, { ask: async () => { throw new Error('boom'); } })).message, /boom/);
  assert.equal((await handleSpecMessage({ type: 'spec:draft-request', requestId: 'd7', prompt: good }, { ask: async () => 'x'.repeat(10_000) })).text.length, MAX_DRAFT_ANSWER);
  assert.equal(await handleSpecMessage({ type: 'spec:draft-request', requestId: 'bad id!', prompt: good }, deps), null);
  assert.equal(await handleSpecMessage({ type: 'jira:something' }, deps), null);
  assert.equal((await handleSpecMessage({ type: 'spec:export-docx', title: 'T', markdown: '# T\n', confirmed: true }, deps)).type, 'spec:exported');
  assert.equal((await handleSpecMessage({ type: 'spec:export-docx', title: 'T', markdown: '# T\n', confirmed: true }, deps)).ok, true);
  assert.match((await handleSpecMessage({ type: 'spec:export-docx', title: 'T', markdown: '# T\n' }, deps)).detail, /Confirm the document first/);
  assert.match((await handleSpecMessage({ type: 'spec:export-docx', title: 'T', markdown: '# T\n', confirmed: true }, {})).detail, /works in the Werkbank app/);
});

function open() {
  const sent = [], errors = [];
  const dom = new JSDOM(page, { runScripts: 'dangerously', beforeParse(w) { Object.defineProperty(w, 'parent', { value: { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } }); w.addEventListener('error', (e) => errors.push(e.message)); } });
  const w = dom.window, d = w.document;
  const reply = (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w.parent }));
  const click = (sel) => { const el = d.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); };
  const ta = (k) => d.querySelector(`#pg-${k} [data-r=ta]`);
  const q = (k, sel) => d.querySelector(`#pg-${k} ${sel}`);
  return { w, d, sent, errors, reply, click, ta, q };
}

test('the page: a PRD handed over from the PRD Builder builds both documents; the tabs switch; a rebuild can be undone', async () => {
  const p = open(); const { d } = p;
  assert.equal(p.ta('fs').value, ''); assert.equal(d.querySelector('#rebuild').hidden, true);
  p.reply({ type: 'wb:restore', state: null, handoffs: [{ from: 'prd-builder', payload: { type: 'spec:from-prd', title: 'Mixed', markdown: prdMd } }, { from: 'x', payload: { type: 'other' } }, { from: 'y', payload: { type: 'spec:from-prd', markdown: 'x'.repeat(40000) } }] });
  assert.match(d.querySelector('#srcline').textContent, /PRD: Mixed · 10 requirements · handed over from the PRD Builder/);
  assert.match(p.ta('fs').value, /^# Functional specification: Mixed/);
  assert.match(p.ta('tsa').value, /^# Technical solution architecture: Mixed/);
  assert.equal(d.querySelector('#pg-tsa').hidden, true);
  p.click('#tab-tsa'); assert.equal(d.querySelector('#pg-tsa').hidden, false); assert.equal(d.querySelector('#pg-fs').hidden, true);
  assert.equal(d.querySelector('#tab-tsa').getAttribute('aria-selected'), 'true');
  // the person edits, then rebuilds: the edit is gone, Undo brings it back
  p.click('#tab-fs');
  const ta = p.ta('fs'); const built = ta.value;
  ta.focus(); ta.setSelectionRange(0, 0); p.click('#pg-fs [data-ed=h3]');
  const edited = ta.value; assert.notEqual(edited, built);
  p.click('#rebuild'); assert.equal(ta.value, built);
  p.click('#pg-fs [data-act=undo]'); assert.equal(ta.value, edited);
  assert.ok(p.q('fs', '[data-r=outline] li') && d.querySelectorAll('#pg-fs [data-r=outline] li').length === 9);
  await new Promise((r) => setTimeout(r, 450));
  assert.ok(p.sent.some((m) => m.type === 'wb:state'), 'the work is reported to the host');
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('the page: demo and paste, no handover means an empty page, a PRD without requirements says so', () => {
  const p = open(); const { d } = p;
  p.click('#usepaste'); assert.match(d.querySelector('#status').textContent, /Paste a PRD first/);
  d.querySelector('#paste').value = 'x'.repeat(40000); p.click('#usepaste'); assert.match(d.querySelector('#status').textContent, /longer than 38 KB/);
  d.querySelector('#paste').value = '# Product requirements: Empty\n\n## 1. Overview\n\nNothing.\n'; p.click('#usepaste');
  assert.match(d.querySelector('#srcline').textContent, /Empty · 0 requirements · pasted/);
  assert.match(d.querySelector('#status').textContent, /holds no requirements/); assert.match(p.ta('fs').value, /No requirements found in the PRD/);
  p.click('#demo');
  assert.match(d.querySelector('#srcline').textContent, /Sales Companion · 10 requirements · demo PRD/);
  assert.match(p.ta('fs').value, /FR-10 ·/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('the page: Joule drafts one section, the person checks the proposal and uses or discards it; errors and a second request are handled', () => {
  const p = open(); const { d } = p;
  p.click('#demo');
  p.click('#pg-fs [data-draft="1"]');
  const req = p.sent.filter((m) => m.type === 'spec:draft-request').at(-1);
  assert.ok(req.prompt.startsWith(DRAFT_START)); assert.match(req.prompt, /section "Roles and permissions"/); assert.match(req.requestId, /^d[a-z0-9]+$/);
  p.click('#pg-fs [data-draft="2"]'); assert.match(d.querySelector('#status').textContent, /still working/);
  assert.equal(p.sent.filter((m) => m.type === 'spec:draft-request').length, 1);
  p.reply({ type: 'spec:draft-answer', requestId: req.requestId, text: '- **seller**: creates and moves deals.\n- Open question: who may see forecasts?' });
  assert.equal(d.querySelector('#pg-fs [data-r=prop]').hidden, false);
  assert.match(d.querySelector('#pg-fs [data-r=proptext]').textContent, /Open question: who may see forecasts/);
  const before = p.ta('fs').value;
  p.click('#pg-fs [data-act=discard]'); assert.equal(d.querySelector('#pg-fs [data-r=prop]').hidden, true); assert.equal(p.ta('fs').value, before, 'nothing changes until the text is used');
  p.click('#pg-fs [data-draft="1"]');
  const req2 = p.sent.filter((m) => m.type === 'spec:draft-request').at(-1);
  p.reply({ type: 'spec:draft-answer', requestId: req2.requestId, text: '- new roles text' });
  p.click('#pg-fs [data-act=use]');
  assert.match(p.ta('fs').value, /## 2\. Roles and permissions\n\n- new roles text\n/);
  assert.doesNotMatch(p.ta('fs').value, /Permissions: To be specified\.\n\n## 3/);
  p.click('#pg-fs [data-act=undo]'); assert.equal(p.ta('fs').value, before);
  p.click('#pg-fs [data-draft="3"]');
  const req3 = p.sent.filter((m) => m.type === 'spec:draft-request').at(-1);
  p.reply({ type: 'spec:error', requestId: req3.requestId, message: 'The agent is not connected yet.' });
  assert.match(d.querySelector('#status').textContent, /agent is not connected/);
  p.reply({ type: 'spec:draft-answer', requestId: 'unknown', text: 'x' }); assert.equal(d.querySelector('#pg-fs [data-r=prop]').hidden, true, 'an answer nobody asked for is ignored');
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('the page: each document is confirmed on its own, with a warning for placeholders, and only then saved as Word; a change takes the confirmation back', () => {
  const p = open(); const { d } = p;
  assert.equal(d.querySelector('#pg-fs [data-act=confirm]').disabled, true, 'nothing to confirm yet');
  p.click('#demo');
  const word = (k) => d.querySelector(`#pg-${k} [data-act=word]`);
  assert.equal(word('fs').disabled, true);
  p.click('#pg-fs [data-act=confirm]');
  assert.equal(d.querySelector('#cfwrap').hidden, false);
  assert.match(d.querySelector('#cf-h').textContent, /functional specification/);
  assert.match(d.querySelector('#cfopen').textContent, /The document is a draft: \d+ places still say/);
  assert.equal(d.querySelector('#cfyes').disabled, true);
  p.click('#cfno'); assert.equal(word('fs').disabled, true);
  p.click('#pg-fs [data-act=confirm]'); p.click('#cfcheck'); p.click('#cfyes');
  assert.equal(word('fs').disabled, false); assert.equal(word('tsa').disabled, true, 'the other document is not confirmed');
  const confirmed = p.ta('fs').value;
  p.click('#pg-fs [data-act=word]');
  const msg = p.sent.filter((m) => m.type === 'spec:export-docx').at(-1);
  assert.equal(msg.confirmed, true); assert.equal(msg.markdown, confirmed); assert.match(msg.title, /^Functional specification - Sales Companion/);
  p.reply({ type: 'spec:exported', ok: true, path: '/Users/x/Downloads/FS.docx', bytes: 8200 });
  assert.match(d.querySelector('#status').textContent, /Saved as Word: \/Users\/x\/Downloads\/FS\.docx \(8 KB\)/);
  p.reply({ type: 'spec:exported', ok: false, detail: 'disk full' }); assert.match(d.querySelector('#status').textContent, /disk full/);
  const ta = p.ta('fs'); ta.value += '\nOne more line.'; ta.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  assert.equal(word('fs').disabled, true); assert.match(d.querySelector('#pg-fs [data-r=cnote]').textContent, /Changed after the confirmation/);
  p.click('#tab-tsa'); p.click('#pg-tsa [data-act=confirm]'); p.click('#cfcheck'); p.click('#cfyes');
  p.click('#pg-tsa [data-act=word]');
  assert.match(p.sent.filter((m) => m.type === 'spec:export-docx').at(-1).title, /^Technical solution architecture - Sales Companion/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('the page: the work comes back after a Space switch (state) and nothing but the known fields is taken over', () => {
  const p = open(); const { d } = p;
  p.reply({ type: 'wb:restore', state: { prd: prdMd, from: 'demo PRD', tab: 'tsa', fs: '# Functional specification: Kept\n\n## 1. A\n\ntext\n', tsa: '# Technical solution architecture: Kept\n\n## 1. B\n\ntext\n', evil: '<img src=x onerror=alert(1)>' }, handoffs: [] });
  assert.match(p.ta('fs').value, /Kept/); assert.match(p.ta('tsa').value, /Kept/);
  assert.equal(d.querySelector('#pg-tsa').hidden, false);
  assert.match(d.querySelector('#srcline').textContent, /Mixed · 10 requirements · demo PRD/);
  assert.equal(d.querySelectorAll('#pg-fs [data-r=outline] li').length, 1);
  assert.equal(d.querySelector('img'), null);
  p.reply({ type: 'wb:restore', state: 'nope', handoffs: 'nope' });
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('the PRD Builder hands over only a confirmed PRD, within the size the host accepts', () => {
  const sent = [];
  const dom = new JSDOM(prdPage, { runScripts: 'dangerously', beforeParse(w) { Object.defineProperty(w, 'parent', { value: { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } }); } });
  const d = dom.window.document; const click = (sel) => d.querySelector(sel).click();
  assert.equal(d.querySelector('#tospec').disabled, true);
  click('#demoMulti'); assert.equal(d.querySelector('#tospec').disabled, true);
  click('#confirmBtn'); click('#cfcheck'); click('#cfyes');
  assert.equal(d.querySelector('#tospec').disabled, false);
  click('#tospec');
  const msg = sent.filter((m) => m.type === 'wb:handoff').at(-1);
  assert.equal(msg.to, 'spec-builder'); assert.equal(msg.open, true); assert.equal(msg.payload.type, 'spec:from-prd'); assert.match(msg.payload.markdown, /^# Product requirements: /);
  const parsed = parseHandoffMessage(msg);
  assert.ok(parsed && parsed.to === 'spec-builder', 'the host accepts it');
  assert.ok(JSON.stringify(msg.payload).length < MAX_HANDOFF_BYTES);
  assert.deepEqual(parsePrd(msg.payload.markdown).requirements.length, 10);
  const ta = d.querySelector('#prd'); ta.value += '\nchanged'; ta.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(d.querySelector('#tospec').disabled, true, 'a change takes the confirmation back');
  dom.window.close();
});

test('the demo PRD of the page is what the PRD Builder writes, and the model block embeds the edit helpers it needs', () => {
  assert.equal(demoPrd(), /<script type="text\/plain" id="spec-demo-prd">\n([\s\S]*?)<\/script>/.exec(page)[1]);
  const src = modelSource();
  for (const fn of ['function toggleLines', 'function sections', 'function moveSection', 'function parsePrd', 'function buildFunctionalSpec', 'function buildArchitecture', 'function docFacts', 'function replaceSectionBody']) assert.ok(src.includes(fn), fn);
  assert.doesNotMatch(src, /^import |^export /m, 'plain script code, no modules');
});
