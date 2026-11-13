import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyGovernance, exampleGovernance, exampleOntologies } from '../src/ontology-manager.ts';
import { extraExampleOntologies } from '../src/ontology-examples.ts';
import {
  MAX_DEFINITION, MAX_PER_PAGE, MAX_PER_TERM, MAX_PHRASES, MAX_TERMS, ambiguousMentions, buildGlossary, buildIndex, findMentions, isAcronym, newBudget,
} from '../src/ontology-glossary.ts';

const term = (id, label, over = {}) => ({ id, label, kind: 'class', definition: `${label} defined.`, formula: '', owner: 'Owner', members: [], membersKind: 'none', ...over });
const onto = (slug, terms, over = {}) => ({ slug, title: `Title ${slug}`, status: 'published', owner: '', domain: '', approver: '', properties: 0, openProposals: 0, example: false, terms, nodes: [], edges: [], ...over });
const gov = (termMeta = {}) => ({ ...emptyGovernance(), termMeta });
const meta = (over) => ({ status: '', replacedBy: '', synonyms: [], mappings: [], ...over });
const keysOf = (g) => g.entries.map((e) => e.key);

test('only approved terms and deprecated ones with the replacement are in the glossary; drafts never', () => {
  const o = onto('fin', [term('A', 'Contract asset'), term('B', 'Contract liability'), term('C', 'Old balance'), term('D', 'Draft idea')]);
  const g = gov({
    'fin|B': meta({ status: 'approved' }),
    'fin|C': meta({ status: 'deprecated', replacedBy: 'B' }),
    'fin|D': meta({ status: 'draft' }),
  });
  const out = buildGlossary([o], g);
  assert.deepEqual(keysOf(out), ['fin|A', 'fin|B', 'fin|C']);
  const c = out.entries.find((e) => e.key === 'fin|C');
  assert.equal(c.status, 'deprecated');
  assert.equal(c.replacedBy, 'Contract liability');
  assert.equal(out.entries[0].replacedBy, '');
  assert.equal(out.entries[0].ontology, 'Title fin');
});

test('terms of a draft ontology count as draft and stay out unless set to approved', () => {
  const o = onto('x', [term('A', 'Open item list'), term('B', 'Credit memo')], { status: 'draft' });
  assert.deepEqual(keysOf(buildGlossary([o], gov({ 'x|B': meta({ status: 'approved' }) }))), ['x|B']);
});

test('an empty catalog gives an empty glossary', () => {
  assert.deepEqual(buildGlossary([], emptyGovernance()), { entries: [], cut: 0 });
});

test('synonyms and mapped names are phrases; duplicates collapse; limits hold', () => {
  const syn = Array.from({ length: 20 }, (_, i) => `synonym number ${i}`);
  const o = onto('fin', [term('A', 'Contract asset', { definition: 'x'.repeat(500) })]);
  const g = gov({ 'fin|A': meta({ synonyms: ['unbilled revenue', 'Unbilled  Revenue', ...syn], mappings: [{ system: 'IFRS 15', ref: 'Vertragsvermögenswert' }, { system: 's', ref: '' }] }) });
  const [e] = buildGlossary([o], g).entries;
  assert.equal(e.phrases.length, MAX_PHRASES);
  assert.equal(e.phrases.filter((p) => p.toLowerCase().replace(/\s+/g, ' ') === 'unbilled revenue').length, 1);
  assert.ok(e.definition.length <= MAX_DEFINITION && e.definition.endsWith('…'));
  assert.deepEqual(e.mappings, [{ system: 'IFRS 15', ref: 'Vertragsvermögenswert' }]);
  const o2 = onto('big', Array.from({ length: MAX_TERMS + 25 }, (_, i) => term(`T${i}`, `Term ${i} name`)));
  const big = buildGlossary([o2], emptyGovernance());
  assert.equal(big.entries.length, MAX_TERMS);
  assert.equal(big.cut, 25);
});

test('a phrase in two ontologies marks both terms as ambiguous; the same ontology does not', () => {
  const a = onto('sales', [term('C', 'Customer'), term('C2', 'Client')]);
  const b = onto('bill', [term('C', 'Customer')]);
  const g = gov({ 'sales|C2': meta({ synonyms: ['customer'] }) });
  const out = buildGlossary([a, b], g);
  const by = (k) => out.entries.find((e) => e.key === k);
  assert.deepEqual(by('sales|C').alsoIn, ['bill|C']);
  assert.deepEqual(by('bill|C').alsoIn.sort(), ['sales|C', 'sales|C2']);
  assert.deepEqual(buildGlossary([onto('s', [term('A', 'Open items'), term('B', 'Open items')])], emptyGovernance()).entries.map((e) => e.alsoIn), [[], []]);
});

test('multi-word phrases are marked, whole words only, any case, with umlauts folded', () => {
  const o = onto('fin', [term('A', 'Contract asset'), term('B', 'Größe der Straße')]);
  const idx = buildIndex(buildGlossary([o], emptyGovernance()));
  const text = 'The CONTRACT ASSETS grew; a subcontract asset not. Und die grosse der strasse.';
  const m = findMentions(text, idx);
  assert.deepEqual(m.map((x) => x.text), ['CONTRACT ASSETS', 'grosse der strasse']);
  const m2 = findMentions('Die Größe der Straße gilt.', idx);
  assert.deepEqual(m2.map((x) => x.text), ['Größe der Straße']);
  assert.equal('Die Größe der Straße gilt.'.slice(m2[0].start, m2[0].end), m2[0].text);
});

test('offsets point into the original text even when the folding changes the length', () => {
  const o = onto('fin', [term('A', 'Straße der Zahlung')]);
  const idx = buildIndex(buildGlossary([o], emptyGovernance()));
  const text = '  Vorher ÄÖ ß  STRASSE   der  Zahlung nachher';
  const [m] = findMentions(text, idx);
  assert.equal(m.text, 'STRASSE   der  Zahlung');
});

test('acronyms are found only in capitals; single everyday words never, unless asked', () => {
  const o = onto('fin', [term('D', 'DSO'), term('C', 'Customer'), term('V', 'Value added tax', ), term('W', 'WIP2')]);
  const g = gov({ 'fin|V': meta({ synonyms: ['VAT'] }) });
  const idx = buildIndex(buildGlossary([o], g));
  assert.ok(isAcronym('DSO') && isAcronym('VAT') && !isAcronym('Dso') && !isAcronym('A') && !isAcronym('WIP2') && !isAcronym('ABCDEFG'));
  assert.deepEqual(findMentions('The DSO and VAT, but dso and Vat and customer.', idx).map((x) => x.text), ['DSO', 'VAT']);
  assert.deepEqual(findMentions('A customer ordered WIP2', idx).map((x) => x.text), []);
  const idx2 = buildIndex(buildGlossary([o], g), { singleWords: true });
  assert.deepEqual(findMentions('A customer ordered WIP2', idx2).map((x) => x.text), ['customer', 'WIP2']);
  assert.deepEqual(findMentions('XDSO DSO1 (DSO)', idx).map((x) => x.text), ['DSO']);
});

test('the longest phrase wins and nothing overlaps', () => {
  const o = onto('fin', [term('A', 'Days sales outstanding'), term('B', 'Sales outstanding')]);
  const idx = buildIndex(buildGlossary([o], emptyGovernance()));
  const m = findMentions('days sales outstanding today', idx);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].keys, ['fin|A']);
});

test('at most two marks per term and 200 per page, over all text nodes of the page', () => {
  const o = onto('fin', [term('A', 'Contract asset')]);
  const idx = buildIndex(buildGlossary([o], emptyGovernance()));
  assert.equal(findMentions('contract asset, contract asset, contract asset', idx).length, MAX_PER_TERM);
  const b = newBudget();
  assert.equal(findMentions('contract asset', idx, b).length, 1);
  assert.equal(findMentions('contract asset and contract asset', idx, b).length, 1);
  assert.equal(findMentions('contract asset', idx, b).length, 0);
  const many = onto('m', Array.from({ length: 300 }, (_, i) => term(`T${i}`, `Alpha${String.fromCharCode(97 + (i % 26))}${i} item`)));
  const idx2 = buildIndex(buildGlossary([many], emptyGovernance()));
  const bb = newBudget();
  let n = 0;
  for (let i = 0; i < 300; i++) n += findMentions(`alpha${String.fromCharCode(97 + (i % 26))}${i} item`, idx2, bb).length;
  assert.equal(n, MAX_PER_PAGE);
});

test('mentions come in reading order and an ambiguous phrase carries every meaning', () => {
  const a = onto('sales', [term('C', 'Open items')]);
  const b = onto('bill', [term('C', 'Open items'), term('P', 'Payment run')]);
  const idx = buildIndex(buildGlossary([a, b], emptyGovernance()));
  const m = findMentions('First the payment run, then open items.', idx);
  assert.deepEqual(m.map((x) => x.text), ['payment run', 'open items']);
  assert.deepEqual(m[1].keys, ['sales|C', 'bill|C']);
});

test('the ask-back finds single words that mean something different in two ontologies', () => {
  const a = onto('sales', [term('C', 'Customer'), term('O', 'Offer')]);
  const b = onto('bill', [term('C', 'Customer')]);
  const g = buildGlossary([a, b], emptyGovernance());
  const m = ambiguousMentions('Show the customer and the offer.', g);
  assert.deepEqual(m.map((x) => x.text), ['customer']);
  assert.deepEqual(m[0].keys, ['sales|C', 'bill|C']);
  assert.deepEqual(ambiguousMentions('Show the offer.', g), []);
  assert.deepEqual(ambiguousMentions('', g), []);
});

test('empty or odd input gives no mentions', () => {
  const idx = buildIndex(buildGlossary([onto('f', [term('A', 'Contract asset')])], emptyGovernance()));
  assert.deepEqual(findMentions('', idx), []);
  assert.deepEqual(findMentions(null, idx), []);
  assert.deepEqual(findMentions('contract asset', { phrases: [] }), []);
});

test('the example catalogs build a glossary that stays within the limits', () => {
  const onts = [...exampleOntologies(), ...extraExampleOntologies()];
  const out = buildGlossary(onts, exampleGovernance());
  assert.ok(out.entries.length > 0 && out.entries.length <= MAX_TERMS);
  for (const e of out.entries) { assert.ok(e.phrases.length <= MAX_PHRASES && e.definition.length <= MAX_DEFINITION && e.status !== 'draft'); }
});
