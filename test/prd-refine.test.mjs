import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { handlePrdMessage, MAX_REFINE_ANSWER, MAX_REFINE_PROMPT, REFINE_START } from '../src/prd-bridge.ts';
import { parseAskMessage, MAX_ASK_LENGTH } from '../src/space-ask.ts';

const page = readFileSync(join(import.meta.dirname, '..', 'examples/prd-builder/index.html'), 'utf8');
const good = 'You refine a product requirements document. Keep everything.\n\nBEGIN DOCUMENT\n# T\nEND DOCUMENT';

test('regression: the old Refine sent the whole document as wb:ask, which the host drops above 600 characters; it does not use wb:ask any more', () => {
  const long = { type: 'wb:ask', prompt: 'Refine this product requirements document. ' + 'x'.repeat(5000) };
  assert.equal(parseAskMessage(long), null, 'the host drops such a message');
  assert.ok(MAX_ASK_LENGTH < 12000);
  assert.doesNotMatch(page, /type:'wb:ask'/, 'no wb:ask in the page any more');
});

test('bridge: only a refine prompt with the fixed start runs, without tools and in a conversation of its own; the answer is cut', async () => {
  const calls = [];
  const host = { ask: async (prompt, title, session) => { calls.push([prompt, title, session]); return '  # Better\n'; } };
  assert.deepEqual(await handlePrdMessage({ type: 'prd:refine-request', requestId: 'r1', prompt: good }, undefined, host), { type: 'prd:refine-answer', requestId: 'r1', text: '# Better' });
  assert.match(calls[0][0], /^Use no tools and read no files\./); assert.equal(calls[0][1], 'PRD refinement'); assert.equal(calls[0][2], '');
  assert.ok(REFINE_START.test(good));
  for (const bad of ['Tell me a joke.', ' ' + good, '', 7]) assert.match((await handlePrdMessage({ type: 'prd:refine-request', requestId: 'r2', prompt: bad }, undefined, host)).message, /not one the PRD Builder may send/);
  assert.match((await handlePrdMessage({ type: 'prd:refine-request', requestId: 'r3', prompt: good + 'x'.repeat(MAX_REFINE_PROMPT) }, undefined, host)).message, /too long/);
  assert.match((await handlePrdMessage({ type: 'prd:refine-request', requestId: 'r4', prompt: good }, undefined, {})).message, /agent is not connected/);
  assert.match((await handlePrdMessage({ type: 'prd:refine-request', requestId: 'r5', prompt: good }, undefined, undefined)).message, /agent is not connected/);
  assert.match((await handlePrdMessage({ type: 'prd:refine-request', requestId: 'r6', prompt: good }, undefined, { ask: async () => '   ' })).message, /stopped/);
  assert.match((await handlePrdMessage({ type: 'prd:refine-request', requestId: 'r7', prompt: good }, undefined, { ask: async () => { throw new Error('boom'); } })).message, /boom/);
  assert.equal((await handlePrdMessage({ type: 'prd:refine-request', requestId: 'r8', prompt: good }, undefined, { ask: async () => 'y'.repeat(30000) })).text.length, MAX_REFINE_ANSWER);
  assert.equal(await handlePrdMessage({ type: 'prd:refine-request', requestId: 'no id!', prompt: good }, undefined, host), null);
  assert.equal((await handlePrdMessage({ type: 'prd:refine-request', requestId: 'r9', prompt: good }, undefined, host)).type, 'prd:refine-answer');
  assert.equal(calls.length, 2, 'the agent only ran for valid requests (r1 and r9)');
});

function open() {
  const sent = [], errors = [];
  const dom = new JSDOM(page, { runScripts: 'dangerously', beforeParse(w) { Object.defineProperty(w, 'parent', { value: { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } }); w.addEventListener('error', (e) => errors.push(e.message)); } });
  const w = dom.window, d = w.document;
  return { w, d, sent, errors, reply: (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w.parent })), click: (sel) => d.querySelector(sel).click() };
}

test('the page: Refine sends a request the bridge accepts, shows the answer as a proposal with a check of the ticket keys, and only "Use this text" changes the document', () => {
  const p = open(); const { d } = p;
  p.click('#refine'); assert.equal(p.sent.filter((m) => m.type === 'prd:refine-request').length, 0, 'nothing to refine yet');
  p.click('#demo');
  const ta = d.querySelector('#prd'), before = ta.value;
  p.click('#refine');
  const req = p.sent.filter((m) => m.type === 'prd:refine-request').at(-1);
  assert.ok(REFINE_START.test(req.prompt) && req.prompt.length < MAX_REFINE_PROMPT); assert.ok(req.prompt.includes(before));
  assert.equal(p.sent.filter((m) => m.type === 'wb:ask').length, 0);
  assert.equal(d.querySelector('#refine').disabled, true, 'one request at a time');
  assert.match(d.querySelector('#status').textContent, /Joule is refining/);
  // an answer nobody asked for is ignored
  p.reply({ type: 'prd:refine-answer', requestId: 'other', text: 'x' }); assert.equal(d.querySelector('#refprop').hidden, true);
  // the proposal drops a ticket key: the page says so
  p.reply({ type: 'prd:refine-answer', requestId: req.requestId, text: before.replaceAll('DEMO-5', 'X') });
  assert.equal(d.querySelector('#refprop').hidden, false); assert.equal(d.querySelector('#refine').disabled, false);
  assert.match(d.querySelector('#refwarn').textContent, /ticket key is missing in the proposal: DEMO-5/);
  assert.equal(ta.value, before, 'nothing changes until the text is used');
  p.click('#refdiscard'); assert.equal(d.querySelector('#refprop').hidden, true); assert.equal(ta.value, before);
  // a good proposal: used, then undone
  p.click('#refine');
  const req2 = p.sent.filter((m) => m.type === 'prd:refine-request').at(-1);
  p.reply({ type: 'prd:refine-answer', requestId: req2.requestId, text: before + '\nSuggestion: ask the product owner.\n' });
  assert.match(d.querySelector('#refwarn').textContent, /Every ticket key of the document is still there/);
  p.click('#refuse');
  assert.match(ta.value, /Suggestion: ask the product owner\./); assert.equal(d.querySelector('#refprop').hidden, true);
  assert.match(d.querySelector('#status').textContent, /Undo brings the old one back/);
  p.click('#undo'); assert.equal(ta.value, before);
  // an error comes back to the status line and frees the button
  p.click('#refine');
  const req3 = p.sent.filter((m) => m.type === 'prd:refine-request').at(-1);
  p.reply({ type: 'prd:refine-error', requestId: req3.requestId, message: 'The agent is not connected yet.' });
  assert.match(d.querySelector('#status').textContent, /agent is not connected/); assert.equal(d.querySelector('#refine').disabled, false);
  // a document that is too long for one go is refused on the page
  ta.value = 'x'.repeat(12500); ta.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  const n = p.sent.filter((m) => m.type === 'prd:refine-request').length;
  p.click('#refine'); assert.equal(p.sent.filter((m) => m.type === 'prd:refine-request').length, n); assert.match(d.querySelector('#status').textContent, /longer than 12,000 characters/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('the page outside the app says so instead of doing nothing', () => {
  const dom = new JSDOM(page, { runScripts: 'dangerously' });
  const d = dom.window.document; d.querySelector('#demo').click(); d.querySelector('#refine').click();
  assert.match(d.querySelector('#status').textContent, /Open this Space in the app to refine/);
  dom.window.close();
});
