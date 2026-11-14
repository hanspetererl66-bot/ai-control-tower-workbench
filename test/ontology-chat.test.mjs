import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { emptyGovernance } from '../src/ontology-manager.ts';
import { buildGlossary, buildIndex } from '../src/ontology-glossary.ts';
import { rehypeTerms } from '../src/ontology-chat-marks.ts';
import { MAX_CONTEXT_TERMS, NONE, choiceLabels, choose, describeEntry, groupId, pendingChoices, splitByMentions, termContext, termsNote } from '../src/ontology-chat.ts';
import { findMentions, newBudget } from '../src/ontology-glossary.ts';
import { DEFAULT_CHAT_TOOLS, sanitizeChatTools } from '../src/preferences.ts';

const term = (id, label, over = {}) => ({ id, label, kind: 'class', definition: `${label} means something.`, formula: '', owner: 'Secret Owner', members: [], membersKind: 'none', ...over });
const onto = (slug, terms) => ({ slug, title: `${slug} ontology`, status: 'published', owner: '', domain: '', approver: '', properties: 0, openProposals: 0, example: false, terms, nodes: [], edges: [] });
const meta = (over) => ({ status: '', replacedBy: '', synonyms: [], mappings: [], ...over });
const glossary = buildGlossary(
  [onto('sales', [term('C', 'Customer', { definition: 'A buyer.' }), term('CA', 'Contract asset'), term('OLD', 'Old balance')]), onto('bill', [term('C', 'Customer', { definition: 'A payer of invoices.' }), term('DSO', 'DSO')])],
  { ...emptyGovernance(), termMeta: { 'sales|OLD': meta({ status: 'deprecated', replacedBy: 'CA' }) } },
);
const index = buildIndex(glossary);
const plain = (html) => html.replace(/<[^>]+>/g, '');

test('a name in two ontologies is asked back once; a decided or skipped name is not asked again', () => {
  const text = 'Show the customer and the Customer again';
  const p = pendingChoices(text, glossary, {});
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].options.map((o) => o.key).sort(), ['bill|C', 'sales|C']);
  assert.equal(p[0].text, 'customer');
  assert.deepEqual(pendingChoices(text, glossary, { [p[0].id]: 'bill|C' }), []);
  assert.deepEqual(pendingChoices(text, glossary, { [p[0].id]: NONE }), []);
  assert.deepEqual(pendingChoices('Show the contract asset and the DSO', glossary, {}), [], 'only real ambiguity is asked');
  assert.deepEqual(pendingChoices('', glossary, {}), []);
});

test('only an offered meaning (or "neither") is accepted as a choice', () => {
  const [a] = pendingChoices('the customer', glossary, {});
  assert.deepEqual(choose({}, a, 'bill|C'), { [a.id]: 'bill|C' });
  assert.deepEqual(choose({}, a, NONE), { [a.id]: NONE });
  assert.deepEqual(choose({}, a, 'sales|CA'), {});
  assert.deepEqual(choose({}, a, 'https://evil.example'), {});
});

test('the visible label names the chosen meaning; a skipped name gets none', () => {
  const [a] = pendingChoices('the Customer', glossary, {});
  assert.deepEqual(choiceLabels('the Customer', glossary, { [a.id]: 'sales|C' }), ['Customer = sales ontology']);
  assert.deepEqual(choiceLabels('the Customer', glossary, { [a.id]: NONE }), []);
  assert.deepEqual(choiceLabels('the Customer', glossary, {}), []);
  assert.equal(groupId(['b', 'a']), groupId(['a', 'b']));
});

test('the vocabulary note has definitions without owners, leaves unresolved names out, and keeps to five', () => {
  const [a] = pendingChoices('customer', glossary, {});
  const none = termContext('Check the Customer and the contract asset and DSO', glossary, {});
  assert.deepEqual(none.keys, ['sales|CA', 'bill|DSO'], 'the ambiguous Customer is left out');
  const chosen = termContext('Check the Customer and the contract asset', glossary, { [a.id]: 'bill|C' });
  assert.deepEqual(chosen.keys, ['bill|C', 'sales|CA']);
  assert.match(chosen.lines[0], /Customer \(bill ontology, approved\): A payer of invoices\./);
  const note = termsNote(chosen);
  assert.match(note, /^VOCABULARY/);
  assert.doesNotMatch(note, /Secret Owner/);
  assert.doesNotMatch(note, /sales ontology, approved\): A buyer/, 'the other meaning is not sent');
  assert.equal(termsNote(termContext('nothing here', glossary, {})), '');
  assert.match(termContext('the old balance', glossary, {}).lines[0], /deprecated, now: Contract asset/);
});

test('a single everyday word that exists in one ontology only is not sent; five terms at most', () => {
  const one = buildGlossary([onto('x', [term('C', 'Customer'), ...Array.from({ length: 8 }, (_, i) => term(`T${i}`, `Term number${i}`))])], emptyGovernance());
  assert.deepEqual(termContext('the customer', one, {}).keys, []);
  const all = termContext(Array.from({ length: 8 }, (_, i) => `term number${i}`).join(', '), one, {});
  assert.equal(all.lines.length, MAX_CONTEXT_TERMS);
  assert.equal(all.cut, 3);
  for (const l of all.lines) assert.ok(l.length <= 330);
});

function md(text, terms) {
  return renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: terms ? [[rehypeTerms, terms]] : [] }, text));
}

test('answers: terms are marked in paragraphs, lists and cells, not in code, links or table headers; the text stays', () => {
  const text = ['The contract asset grew.', '', '- the old balance', '', '| contract asset | x |', '|---|---|', '| contract asset | DSO |', '', '`contract asset` and [contract asset](http://a.example)', '', '```', 'contract asset', '```'].join('\n');
  const html = md(text, index);
  const marked = [...html.matchAll(/<span class="chat-term"[^>]*>(.*?)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(marked, ['contract asset', 'old balance', 'contract asset', 'DSO'], 'prose, list and body cells; not the header, the code, the link or the block (a third mark of the same term would not fit)');
  assert.equal(plain(html), plain(md(text, undefined)), 'marking does not change the text');
  assert.match(html, /data-keys="sales\|CA"/);
  assert.match(html, /role="button"/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(md(text, undefined), /chat-term/);
});

test('the own message is split into plain and marked pieces, keeping the text', () => {
  const text = 'Is the DSO above the contract asset?';
  const parts = splitByMentions(text, findMentions(text, index, newBudget()));
  assert.equal(parts.map((p) => p.text).join(''), text);
  assert.deepEqual(parts.filter((p) => p.keys).map((p) => p.text), ['DSO', 'contract asset']);
  assert.deepEqual(splitByMentions('plain', []), [{ text: 'plain' }]);
});

test('the components: ChatMarkdown takes the index, the ask-back offers every meaning and "Neither", the card layer reads only its own glossary', () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.match(read('../src/ui/ChatMarkdown.tsx'), /rehypePlugins=\{terms \? \[\[rehypeTerms, terms\]\] : \[\]\}/);
  const ui = read('../src/ui/ChatTerms.tsx');
  assert.match(ui, /a\.options\.map\(\(o\) =>/);
  assert.match(ui, /onChoose\(a, NONE\)[\s\S]{0,80}Neither/);
  assert.match(ui, /Nothing is sent until then/);
  assert.match(ui, /filter\(\(k\) => byKey\.has\(k\)\)/, 'keys from the page are checked against the glossary');
  assert.doesNotMatch(ui, /innerHTML|dangerouslySetInnerHTML|eval\(|fetch\(/);
  const chat = read('../src/ui/Chat.tsx');
  assert.match(chat, /terms \? <MarkedText text=\{m\.text\} index=\{terms\.index\} \/> : <span>\{m\.text\}<\/span>/, 'without terms the message is rendered as before');
  assert.match(chat, /Vocabulary: \{m\.terms\.sent\}/, 'what was sent to the model is visible on the message');
});

test('the card shows the same facts as in the Spaces', () => {
  const ca = glossary.entries.find((e) => e.key === 'sales|CA');
  const c = describeEntry(ca);
  assert.equal(c.status, 'Approved');
  assert.match(c.meta[0], /Owner: Secret Owner · sales ontology/);
  const old = describeEntry(glossary.entries.find((e) => e.key === 'sales|OLD'));
  assert.equal(old.status, 'Deprecated, replaced by Contract asset');
});

test('settings: terms and sending definitions are off by default; the second needs the first', () => {
  assert.equal(DEFAULT_CHAT_TOOLS.terms, false);
  assert.equal(DEFAULT_CHAT_TOOLS.termsContext, false);
  assert.equal(sanitizeChatTools({}).termsContext, false);
  assert.equal(sanitizeChatTools({ terms: true, termsContext: true }).termsContext, true);
  assert.equal(sanitizeChatTools({ terms: false, termsContext: true }).termsContext, false);
  assert.equal(sanitizeChatTools({ terms: 'yes' }).terms, false);
});

test('the wiring: the draft is held before sending, the note goes only when switched on, the style has no fixed colours', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /pendingChoices\(typed, glossary, termChoices\)[\s\S]{0,120}return 'held'/);
  assert.match(app, /prefs\.chat\.terms && !glossary && ontologyData\.source\.kind === 'loading'[\s\S]{0,160}return 'held'/, 'no silent send while the vocabulary is still being read');
  assert.match(app, /lastGlossary\.current/, 'the last good vocabulary stays while the catalog is read again');
  assert.match(app, /const termSent = prefs\.chat\.termsContext && termCtx/);
  assert.match(app, /termSent \? termsNote\(termSent\) : ''/);
  const composer = readFileSync(new URL('../src/ui/Composer.tsx', import.meta.url), 'utf8');
  assert.match(composer, /if \(onSend\(t, attachments\) === 'held'\) return;/);
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* Terms of the ontology in the chat'));
  assert.ok(block.length > 200);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/);
});
