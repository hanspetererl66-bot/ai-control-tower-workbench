import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { emptyGovernance } from '../src/ontology-manager.ts';
import { buildGlossary, buildIndex, findMentions, newBudget } from '../src/ontology-glossary.ts';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { SPACE_TERMS_SCRIPT, SPACE_TERMS_STYLE, applySpaceTerms, pageEntries, parseOpenTermMessage, setTermsForDomain, setTermsForSpace, termsOn } from '../src/space-terms.ts';

const term = (id, label, over = {}) => ({ id, label, kind: 'class', definition: `${label} means something.`, formula: '', owner: 'Anna', members: [], membersKind: 'none', ...over });
const onto = (slug, terms) => ({ slug, title: `Title ${slug}`, status: 'published', owner: '', domain: '', approver: '', properties: 0, openProposals: 0, example: false, terms, nodes: [], edges: [] });
const gov = (termMeta = {}) => ({ ...emptyGovernance(), termMeta });
const glossary = buildGlossary(
  [onto('fin', [term('CA', 'Contract asset'), term('D', 'DSO'), term('OI', 'Open items'), term('OLD', 'Old balance')]), onto('bill', [term('OI', 'Open items')])],
  gov({ 'fin|OLD': { status: 'deprecated', replacedBy: 'CA', synonyms: [], mappings: [] }, 'fin|CA': { status: '', replacedBy: '', synonyms: ['unbilled revenue'], mappings: [{ system: 'IFRS 15', ref: 'Vertragsvermögenswert' }] } }),
);
const entries = pageEntries(glossary.entries);

/** A page with the real script; the host side is played by the test through postMessage events. */
function page(body, { send = true, on = true } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const sent = [];
  Object.defineProperty(w, 'parent', { value: { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } });
  w.eval(SPACE_TERMS_SCRIPT);
  const host = (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w.parent }));
  if (send) host({ type: 'ot:glossary', entries });
  if (on) host({ type: 'ot:enable', on: true });
  return { w, d: w.document, sent, host, settle: () => new Promise((r) => setTimeout(r, 40)) };
}

test('the page script marks the same words as findMentions (parity)', () => {
  const win = { __WB_TEST__: true };
  vm.runInNewContext(SPACE_TERMS_SCRIPT, { window: win, String, Object, Array, JSON, RegExp, Math });
  const idxPage = win.__wbTerms.buildIndex(JSON.parse(JSON.stringify(entries)));
  const idxHost = buildIndex(glossary);
  const texts = [
    'The CONTRACT ASSETS grew and the DSO fell; dso stays; open items everywhere, open items again, open items thrice.',
    'unbilled revenue, Vertragsvermögenswert and old balance next to contract asset',
    'Straße der Zahlung, XDSO DSO1 (DSO)',
    '',
  ];
  for (const text of texts) {
    const a = JSON.parse(JSON.stringify(win.__wbTerms.findMentions(text, idxPage, win.__wbTerms.newBudget())));
    const b = findMentions(text, idxHost, newBudget());
    assert.deepEqual(a, JSON.parse(JSON.stringify(b)), text);
  }
});

test('without a glossary or without the switch nothing is marked', async () => {
  const a = page('<p>The contract asset</p>', { send: false });
  await a.settle();
  assert.equal(a.d.querySelectorAll('.wb-term').length, 0);
  const b = page('<p>The contract asset</p>', { on: false });
  await b.settle();
  assert.equal(b.d.querySelectorAll('.wb-term').length, 0);
  assert.equal(b.sent.at(-1).enabled, false);
});

test('terms are marked in paragraphs and cells, not in headers, inputs, code, search marks or opted-out blocks', async () => {
  const p = page(`<h1>Contract asset</h1><p>One contract asset here.</p><table><thead><tr><th>Contract asset</th></tr></thead><tbody><tr><td>Open items</td></tr></tbody></table>
    <input value="contract asset"><textarea>contract asset</textarea><code>contract asset</code><pre>contract asset</pre><button>contract asset</button>
    <p><mark class="wb-hit">contract asset</mark></p><div data-wb-noterms><p>contract asset</p></div><script>var x = "contract asset"</script>`);
  await p.settle();
  const marked = [...p.d.querySelectorAll('.wb-term')].map((e) => e.textContent);
  assert.deepEqual(marked, ['Contract asset', 'contract asset', 'Open items']);
  assert.equal(p.d.querySelector('th .wb-term'), null);
  assert.equal(p.sent.at(-1).count, 3);
  assert.equal(p.d.querySelector('p').textContent, 'One contract asset here.', 'the text stays the same');
});

test('at most two marks per term on a page; switching off removes every mark and keeps the text', async () => {
  const p = page('<p>contract asset</p><p>contract asset</p><p>contract asset</p>');
  await p.settle();
  assert.equal(p.d.querySelectorAll('.wb-term').length, 2);
  const before = p.d.body.textContent;
  p.host({ type: 'ot:enable', on: false });
  await p.settle();
  assert.equal(p.d.querySelectorAll('.wb-term').length, 0);
  assert.equal(p.d.body.textContent, before);
  assert.equal(p.sent.at(-1).enabled, false);
});

test('a page that changes later is marked again, and the marks do not start a loop', async () => {
  const p = page('<p id="a">nothing here</p>');
  await p.settle();
  p.d.getElementById('a').textContent = 'now the contract asset appears';
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(p.d.querySelectorAll('.wb-term').length, 1);
  const states = p.sent.filter((m) => m.type === 'ot:state').length;
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(p.sent.filter((m) => m.type === 'ot:state').length, states, 'quiet page, no more passes');
});

test('the card shows definition, owner, status, synonyms and mapping, built from text only', async () => {
  const p = page('<p>The contract asset and the old balance.</p>');
  await p.settle();
  const [a, b] = p.d.querySelectorAll('.wb-term');
  a.click();
  const card = p.d.getElementById('wb-term-card');
  assert.ok(card);
  const t = card.textContent;
  for (const s of ['Contract asset', 'Approved', 'Contract asset means something.', 'Owner: Anna', 'Title fin', 'unbilled revenue', 'IFRS 15: Vertragsvermögenswert', 'Open in the catalog']) assert.ok(t.includes(s), s);
  assert.equal(a.getAttribute('aria-describedby'), 'wb-term-card');
  b.click();
  assert.match(p.d.getElementById('wb-term-card').textContent, /Deprecated, replaced by Contract asset/);
  assert.equal(a.getAttribute('aria-describedby'), null);
});

test('an open card stays open while the page is quiet, and closes when the page really changes', async () => {
  const p = page('<p id="a">The contract asset.</p>');
  await p.settle();
  p.d.querySelector('.wb-term').click();
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(p.d.getElementById('wb-term-card'), 'opening the card is no change of the page');
  assert.equal(p.d.querySelectorAll('.wb-term').length, 1);
  p.d.getElementById('a').textContent = 'The open items now.';
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(p.d.getElementById('wb-term-card'), null);
  assert.equal(p.d.querySelectorAll('.wb-term').length, 1);
});

test('a phrase in two ontologies shows both meanings', async () => {
  const p = page('<p>Check the open items.</p>');
  await p.settle();
  p.d.querySelector('.wb-term').click();
  const card = p.d.getElementById('wb-term-card');
  assert.match(card.textContent, /different things in 2 ontologies/);
  assert.equal(card.querySelectorAll('.wb-t-open').length, 2);
});

test('keyboard: Enter opens, Escape closes and returns the focus; Tab reaches the term', async () => {
  const p = page('<p>The contract asset.</p>');
  await p.settle();
  const a = p.d.querySelector('.wb-term');
  assert.equal(a.getAttribute('tabindex'), '0');
  assert.equal(a.getAttribute('role'), 'button');
  a.focus();
  a.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.ok(p.d.getElementById('wb-term-card'));
  assert.equal(p.d.activeElement, p.d.getElementById('wb-term-card'));
  p.d.activeElement.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(p.d.getElementById('wb-term-card'), null);
  assert.equal(p.d.activeElement, a);
});

test('"Open in the catalog" sends only the key of a known term; an unknown key is never sent', async () => {
  const p = page('<p>The contract asset.</p>');
  await p.settle();
  p.d.querySelector('.wb-term').click();
  p.d.querySelector('.wb-t-open').click();
  assert.deepEqual(p.sent.filter((m) => m.type === 'ot:open'), [{ type: 'ot:open', key: 'fin|CA' }]);
  const fake = p.d.createElement('button');
  fake.className = 'wb-t-open'; fake.setAttribute('data-key', 'evil|x'); p.d.body.appendChild(fake);
  fake.click();
  assert.equal(p.sent.filter((m) => m.type === 'ot:open').length, 1);
});

test('messages from anything but the parent are ignored', async () => {
  const p = page('<p>The contract asset.</p>', { send: false, on: false });
  p.w.dispatchEvent(new p.w.MessageEvent('message', { data: { type: 'ot:glossary', entries }, source: p.w }));
  p.w.dispatchEvent(new p.w.MessageEvent('message', { data: { type: 'ot:enable', on: true }, source: p.w }));
  await p.settle();
  assert.equal(p.d.querySelectorAll('.wb-term').length, 0);
});

test('odd entries from the host do not break the page', async () => {
  const p = page('<p>The contract asset.</p>', { send: false });
  p.host({ type: 'ot:glossary', entries: [null, 1, { key: 3 }, { key: 'x|y', label: 'Bad', phrases: 'no' }, ...entries] });
  await p.settle();
  assert.equal(p.d.querySelectorAll('.wb-term').length, 1);
});

test('the injected style uses no fixed colours, only variables with system colours as fallback', () => {
  assert.doesNotMatch(SPACE_TERMS_STYLE, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/);
  assert.match(SPACE_TERMS_STYLE, /var\(--ink, CanvasText\)/);
  assert.doesNotMatch(SPACE_TERMS_SCRIPT, /style\.(color|background)/);
  assert.doesNotMatch(SPACE_TERMS_SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|Function\(|fetch\(|XMLHttpRequest|localStorage/);
});

test('applySpaceTerms adds script and style once, before the end of the body', () => {
  const once = applySpaceTerms('<html><body><p>x</p></body></html>');
  assert.equal(applySpaceTerms(once), once);
  assert.ok(once.indexOf('werkbank-space-terms') < once.indexOf('</body>'));
  assert.ok(applySpaceTerms('<p>no body</p>').includes('werkbank-space-terms'));
});

test('opt-in: default off; per Space or per domain; switching a Space off turns its domain off too', () => {
  const p = { ...DEFAULT_PREFERENCES };
  assert.equal(termsOn(p, 'sales', 'Sales'), false);
  const a = setTermsForSpace(p, 'sales', 'Sales', true);
  assert.equal(termsOn(a, 'sales', 'Sales'), true);
  assert.equal(termsOn(a, 'other', 'Sales'), false);
  const d = setTermsForDomain(a, 'Finance', true);
  assert.equal(termsOn(d, 'x', 'Finance'), true);
  const off = setTermsForSpace(d, 'x', 'Finance', false);
  assert.equal(termsOn(off, 'x', 'Finance'), false);
  assert.equal(termsOn(off, 'sales', 'Sales'), true);
  assert.deepEqual(p.termSpaces, [], 'the input is not changed');
});

test('the host accepts an open request only for a key of its own glossary', () => {
  const known = new Set(['fin|CA']);
  assert.equal(parseOpenTermMessage({ type: 'ot:open', key: 'fin|CA' }, known), 'fin|CA');
  assert.equal(parseOpenTermMessage({ type: 'ot:open', key: 'fin|XX' }, known), null);
  assert.equal(parseOpenTermMessage({ type: 'ot:open', key: 'https://evil.example' }, known), null);
  assert.equal(parseOpenTermMessage({ type: 'ot:open', key: { a: 1 } }, known), null);
  assert.equal(parseOpenTermMessage({ type: 'other', key: 'fin|CA' }, known), null);
  assert.equal(parseOpenTermMessage(null, known), null);
});
