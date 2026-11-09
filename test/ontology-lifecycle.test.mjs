import assert from 'node:assert/strict';
import test from 'node:test';
import { Parser } from 'n3';
import { normalizeGovernance } from '../electron/ontology-store.mjs';
import {
  addQuestion, addSynonym, checkQuestion, emptyGovernance, filterTerms, metaOf, qualityFindings, questionCoverage, removeQuestion, removeSynonym,
  resolveCatalog, setTermMeta, statusOf,
} from '../src/ontology-manager.ts';
import { exportText, toGlossaryCsv, toJsonLd, toTurtle } from '../src/ontology-export.ts';

const data = resolveCatalog(null);
const { ontologies, governance } = data;
const bySlug = (s) => ontologies.find((o) => o.slug === s);

test('the example set is broad and consistent: seven ontologies, every link, user, question and mapping points at something that exists', () => {
  assert.equal(ontologies.length, 7);
  assert.ok(ontologies.reduce((n, o) => n + o.terms.length, 0) >= 60, 'at least sixty terms');
  const slugs = new Set(ontologies.map((o) => o.slug));
  for (const o of ontologies) {
    const ids = new Set([...o.terms.map((t) => t.id), ...o.nodes.map((n) => n.id)]);
    assert.equal(new Set(o.terms.map((t) => t.id)).size, o.terms.length, `${o.slug}: term ids are unique`);
    for (const e of o.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${o.slug}: ${e.from} ${e.prop} ${e.to}`);
  }
  for (const b of governance.bindings) { const o = bySlug(b.slug); assert.ok(o?.terms.some((t) => t.id === b.term) || o?.nodes.some((n) => n.id === b.term), `binding ${b.slug}/${b.term}`); }
  for (const [key, meta] of Object.entries(governance.termMeta)) {
    const [slug, id] = key.split('|');
    assert.ok(bySlug(slug)?.terms.some((t) => t.id === id), `termMeta ${key}`);
    if (meta.replacedBy) assert.ok(bySlug(slug).terms.some((t) => t.id === meta.replacedBy), `${key} replaced by something that exists`);
  }
  for (const q of governance.questions) assert.ok(slugs.has(q.slug), q.id);
  for (const v of governance.views) for (const s of v.slugs) assert.ok(slugs.has(s), `view ${v.name}`);
});

test('lifecycle: a term of a published ontology counts as approved until somebody says otherwise; deprecated terms keep their replacement', () => {
  const hr = bySlug('werkbank_hr');
  const old = hr.terms.find((t) => t.id === 'TimeToHire');
  const fresh = hr.terms.find((t) => t.id === 'Stage');
  assert.equal(statusOf(hr, governance, fresh), 'approved');
  assert.equal(statusOf(hr, governance, old), 'deprecated');
  assert.equal(metaOf(governance, 'werkbank_hr', 'TimeToHire').replacedBy, 'TimeToFill');
  const draftOnto = bySlug('procurement_docs');
  assert.equal(statusOf(draftOnto, governance, draftOnto.terms[0]), 'draft');
  let g = setTermMeta(governance, 'werkbank_hr', 'Stage', { status: 'deprecated', replacedBy: 'Requisition' });
  assert.equal(metaOf(g, 'werkbank_hr', 'Stage').replacedBy, 'Requisition');
  g = setTermMeta(g, 'werkbank_hr', 'Stage', { status: 'approved' });
  assert.equal(metaOf(g, 'werkbank_hr', 'Stage').replacedBy, '', 'the replacement is dropped when the term is no longer deprecated');
  assert.equal(setTermMeta(emptyGovernance(), 'x', 'a', { status: '' }).termMeta['x|a'], undefined, 'an empty entry is not stored');
});

test('synonyms are cleaned, limited and found by the search; mappings are limited and need both parts', () => {
  let g = emptyGovernance();
  g = addSynonym(g, 'werkbank_hr', 'Stage', '  step   of the process ');
  g = addSynonym(g, 'werkbank_hr', 'Stage', 'STEP OF THE PROCESS');
  g = addSynonym(g, 'werkbank_hr', 'Stage', '');
  assert.deepEqual(metaOf(g, 'werkbank_hr', 'Stage').synonyms, ['step of the process']);
  for (let i = 0; i < 40; i++) g = addSynonym(g, 'werkbank_hr', 'Stage', `word ${i}`);
  assert.equal(metaOf(g, 'werkbank_hr', 'Stage').synonyms.length, 20);
  assert.equal(removeSynonym(g, 'werkbank_hr', 'Stage', 'word 1').termMeta['werkbank_hr|Stage'].synonyms.includes('word 1'), false);
  const m = setTermMeta(g, 'werkbank_hr', 'Stage', { mappings: [{ system: 'A', ref: '' }, { system: '', ref: 'b' }, { system: 'SAP', ref: 'X' }] });
  assert.deepEqual(metaOf(m, 'werkbank_hr', 'Stage').mappings, [{ system: 'SAP', ref: 'X' }]);
  const hr = bySlug('werkbank_hr');
  assert.deepEqual(filterTerms(hr, 'all', 'ttf', governance).map((t) => t.id), ['TimeToFill'], 'found by a synonym');
  assert.deepEqual(filterTerms(hr, 'all', 'ttf').map((t) => t.id), [], 'without governance only the term itself is searched');
  assert.deepEqual(filterTerms(hr, 'deprecated', '', governance).map((t) => t.id), ['TimeToHire']);
  assert.deepEqual(filterTerms(bySlug('werkbank_sales'), 'all', 'business partner', governance).map((t) => t.id), ['Customer'], 'found by a mapped name');
});

test('competency questions: missing terms block, undefined or deprecated terms make it partial', () => {
  const hr = bySlug('werkbank_hr');
  const q = (id) => governance.questions.find((x) => x.id === id);
  assert.equal(checkQuestion(hr, governance, q('q-hr-1')).state, 'answerable');
  assert.equal(checkQuestion(hr, governance, q('q-hr-5')).state, 'blocked', 'Forecast is not in the ontology');
  assert.match(checkQuestion(hr, governance, q('q-hr-5')).problems[0].message, /Forecast/);
  assert.equal(checkQuestion(hr, governance, q('q-hr-4')).state, 'partial', 'Selection rate is still a draft');
  const fin = bySlug('werkbank_fin');
  assert.equal(checkQuestion(fin, governance, q('q-fin-1')).state, 'answerable');
  assert.equal(checkQuestion(fin, governance, q('q-fin-3')).state, 'blocked');
  assert.equal(checkQuestion(fin, governance, q('q-fin-4')).state, 'partial', 'Invoice has no definition');
  const dep = { ...governance, questions: [{ id: 'x', slug: 'werkbank_hr', text: 'old', terms: ['TimeToHire'] }] };
  assert.match(checkQuestion(hr, dep, dep.questions[0]).problems[0].message, /deprecated, use TimeToFill/);
  const cover = questionCoverage(hr, governance);
  assert.deepEqual([cover.total, cover.answerable, cover.partial, cover.blocked], [5, 3, 1, 1]);
  assert.equal(questionCoverage(bySlug('procurement_docs'), governance).share, 1, 'no question means nothing is uncovered');
});

test('adding and removing questions: text and terms are needed, duplicates and empty ones are refused', () => {
  let g = emptyGovernance();
  assert.equal(addQuestion(g, 'a', 'text', []), g);
  assert.equal(addQuestion(g, 'a', '   ', ['X']), g);
  g = addQuestion(g, 'a', 'Which?', ['X', 'X', ' Y '], 1000);
  assert.deepEqual(g.questions[0].terms, ['X', 'Y']);
  assert.equal(addQuestion(g, 'a', 'which?', ['X']), g, 'the same text is not added twice');
  assert.equal(removeQuestion(g, g.questions[0].id).questions.length, 0);
});

test('quality rules know the lifecycle: deprecated but used, no replacement, ambiguous synonyms, blocked questions', () => {
  const f = qualityFindings(ontologies, governance);
  const by = (rule) => f.filter((x) => x.rule === rule);
  assert.equal(by('deprecated-used').length, 1);
  assert.equal(by('deprecated-used')[0].term, 'TimeToHire');
  assert.equal(by('deprecated-used')[0].severity, 'high');
  assert.match(by('deprecated-used')[0].message, /Move them to Time to fill/);
  assert.equal(by('no-replacement').length, 0);
  assert.ok(by('question-blocked').length >= 3);
  assert.equal(new Set(f.map((x) => x.id)).size, f.length, 'finding ids are unique');
  const hr = bySlug('werkbank_hr');
  let g = setTermMeta(governance, 'werkbank_hr', 'TimeToHire', { replacedBy: '' });
  assert.equal(qualityFindings([hr], g).filter((x) => x.rule === 'no-replacement').length, 1);
  g = addSynonym(governance, 'werkbank_hr', 'Candidate', 'Source');
  const clash = qualityFindings([hr], g).filter((x) => x.rule === 'synonym-clash');
  assert.equal(clash.length, 1);
  assert.equal(clash[0].term, 'Candidate');
});

test('governance.json keeps lifecycle, synonyms, mappings and questions, and drops what is malformed', () => {
  const kept = normalizeGovernance(governance);
  assert.deepEqual(kept.termMeta, governance.termMeta);
  assert.equal(kept.questions.length, governance.questions.length);
  const dirty = normalizeGovernance({
    termMeta: {
      'bad slug!|X': { status: 'approved' }, 'ok|': { status: 'approved' }, 'ok|T': { status: 'weird', replacedBy: 'Z', synonyms: ['a', 'A', ' ', 'b'], mappings: [{ system: 'S', ref: 'R' }, { system: '', ref: 'R' }] },
      'ok|Dead': { status: 'deprecated', replacedBy: 'T' }, 'ok|Empty': { status: '', synonyms: [] },
    },
    questions: [{ id: 'q1', slug: 'ok', text: 'Q', terms: ['T', 'T', ''] }, { id: 'q1', slug: 'ok', text: 'dup id', terms: ['T'] }, { id: 'q2', slug: 'ok', text: '', terms: ['T'] }, { id: 'q3', slug: 'ok', text: 'no terms', terms: [] }],
  });
  assert.deepEqual(Object.keys(dirty.termMeta).sort(), ['ok|Dead', 'ok|T']);
  assert.deepEqual(dirty.termMeta['ok|T'], { status: '', replacedBy: '', synonyms: ['a', 'b'], mappings: [{ system: 'S', ref: 'R' }] });
  assert.equal(dirty.termMeta['ok|Dead'].replacedBy, 'T');
  assert.deepEqual(dirty.questions.map((q) => [q.id, q.terms]), [['q1', ['T']]]);
  const old = normalizeGovernance({ version: 1, ontologies: {}, bindings: [], views: [], plans: [] });
  assert.deepEqual([old.termMeta, old.questions], [{}, []], 'a file from before this change still loads');
});

test('export: every example ontology becomes valid Turtle, with synonyms, status, replacement and mappings', () => {
  for (const o of ontologies) {
    const ttl = toTurtle(o, governance);
    const quads = new Parser({ format: 'text/turtle' }).parse(ttl);
    assert.ok(quads.length >= o.terms.length * 2, `${o.slug}: parses (${quads.length} triples)`);
  }
  const hr = bySlug('werkbank_hr');
  const quads = new Parser().parse(toTurtle(hr, governance));
  const has = (p, o) => quads.some((q) => q.predicate.value.endsWith(p) && (o === undefined || q.object.value === o || q.object.value.endsWith(o)));
  assert.ok(has('altLabel', 'days to fill'));
  assert.ok(has('deprecated', 'true'));
  assert.ok(has('isReplacedBy', 'TimeToFill'));
  assert.ok(has('reference', 'Recruiting: requisition cycle time'));
  assert.ok(quads.some((q) => q.subject.value.endsWith('#TimeToFill') && q.predicate.value.endsWith('derivedFrom') && q.object.value.endsWith('#ds_requisition')));
});

test('export: Turtle escapes quotes, backslashes and line breaks', () => {
  const o = { slug: 'x', title: 'A "quoted" title', status: 'draft', owner: '', domain: '', approver: '', properties: 0, openProposals: 0, example: true,
    terms: [{ id: '1st', label: 'Back\\slash', kind: 'class', definition: 'line one\nline "two"', formula: '', owner: '', members: [], membersKind: 'none' }], nodes: [], edges: [] };
  const quads = new Parser().parse(toTurtle(o, emptyGovernance()));
  assert.ok(quads.some((q) => q.object.value === 'line one\nline "two"'));
  assert.ok(quads.some((q) => q.object.value === 'Back\\slash'));
  assert.ok(quads.some((q) => q.subject.value.endsWith('#_1st')), 'an id that starts with a digit becomes a valid name');
});

test('export: JSON-LD has one node per term and per resource, and the glossary is safe to open in a spreadsheet', () => {
  const o = bySlug('werkbank_sales');
  const ld = JSON.parse(toJsonLd(o, governance));
  const resources = o.nodes.filter((n) => !o.terms.some((t) => t.id === n.id)).length;
  assert.equal(ld['@graph'].length, 1 + o.terms.length + resources);
  const customer = ld['@graph'].find((n) => n['@id'].endsWith('#Customer'));
  assert.deepEqual(customer['skos:altLabel'], ['account', 'client']);
  assert.equal(customer['wb:mappedTo'][0]['wb:system'], 'SAP S/4HANA');
  const evil = { ...o, terms: [{ ...o.terms[0], label: '=HYPERLINK("http://x")', definition: 'a, "b"\nc' }] };
  const csv = toGlossaryCsv(evil, emptyGovernance());
  const lines = csv.split('\r\n');
  assert.match(lines[0], /^Term,Id,Type,Status,Definition/);
  assert.ok(lines[1].startsWith('"\'=HYPERLINK(""http://x"")",'), 'a leading = gets an apostrophe');
  assert.match(csv, /"a, ""b""\nc"/);
  assert.equal(exportText(o, governance, 'csv').split('\r\n').length, o.terms.length + 2);
});
