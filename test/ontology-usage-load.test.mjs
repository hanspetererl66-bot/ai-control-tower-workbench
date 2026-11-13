import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SKILL_TEXTS, MAX_SPACE_PAGES, htmlToText, loadUsageSources } from '../src/ontology-usage-load.ts';
import { emptyGovernance } from '../src/ontology-manager.ts';
import { decisionsOf, setUsageDecision } from '../src/ontology-usage.ts';
import { normalizeGovernance } from '../electron/ontology-store.mjs';

const item = (id, name, over = {}) => ({ id, type: 'agent', name, owner: 'Lena', archived: false, card: null, ...over });

test('htmlToText: page text without scripts, styles and markup, plus the strings of the embedded JSON', () => {
  const html = `<html><head><style>.a{color:red}</style></head><body><h1>Revenue &amp; Recognition</h1><!-- hidden -->
    <p>The <b>contract&nbsp;asset</b> grows.</p><script>var secret = 'not text';</script>
    <script type="application/json" id="data">{"rows":[{"name":"Unbilled revenue","n":12,"x":["ab","Deferred revenue schedule"]}]}</script>
    <script type="application/json">{broken</script></body></html>`;
  const text = htmlToText(html);
  assert.match(text, /Revenue & Recognition/);
  assert.match(text, /contract asset grows/);
  assert.match(text, /Unbilled revenue/);
  assert.match(text, /Deferred revenue schedule/);
  assert.doesNotMatch(text, /secret|color:red|hidden|broken|<|>/);
  assert.doesNotMatch(text, /\bab\b/, 'strings shorter than three characters are left out');
  assert.equal(htmlToText(''), '');
});

test('all three sources are read; the notes say how many', async () => {
  const out = await loadUsageSources({
    registry: async () => [item('i1', 'Closer'), item('i2', 'Old', { archived: true })],
    skills: async () => [{ name: 'board-briefing', description: 'A briefing', dir: 'd1' }],
    readSkill: async (dir) => `text of ${dir}`,
    spaces: async () => [{ slug: 'rr', title: 'Revenue Recognition', description: '', insights: [] }],
    readSpaceHtml: async () => '<p>Contract asset</p>',
  });
  assert.deepEqual(out.sources.map((s) => `${s.kind}:${s.ref}`), ['agent:i1', 'skill:d1', 'space:rr']);
  assert.deepEqual(out.notes.map((n) => `${n.source}:${n.status}:${n.read}/${n.of}`), ['registry:ok:2/2', 'skills:ok:1/1', 'spaces:ok:1/1']);
  assert.ok(out.sources[1].fields.some((f) => f.field === 'body' && f.text === 'text of d1'));
  assert.ok(out.sources[2].fields.some((f) => f.field === 'body' && f.text === 'Contract asset'));
});

test('a source that is not there or fails is named and never hides the others', async () => {
  const none = await loadUsageSources({});
  assert.deepEqual(none.sources, []);
  assert.deepEqual(none.notes.map((n) => `${n.source}:${n.status}`), ['registry:missing', 'skills:missing', 'spaces:missing']);
  assert.match(none.notes[0].detail, /No connection to the shared database/);
  const out = await loadUsageSources({
    registry: async () => { throw new Error('database down'); },
    skills: async () => { throw new Error('ipc closed'); },
    spaces: async () => [{ slug: 'a', title: 'A', description: '', insights: [] }],
  });
  assert.deepEqual(out.notes.map((n) => n.status), ['failed', 'failed', 'ok']);
  assert.match(out.notes[0].detail, /database down/);
  assert.match(out.notes[1].detail, /ipc closed/);
  assert.deepEqual(out.sources.map((s) => s.ref), ['a'], 'the working source still delivers');
});

test('a page or skill text that cannot be read makes the source partial, the rest still counts', async () => {
  const out = await loadUsageSources({
    skills: async () => [{ name: 'a', description: '', dir: 'a' }, { name: 'b', description: '', dir: 'b' }],
    readSkill: async (dir) => { if (dir === 'b') throw new Error('no file'); return 'ok'; },
    spaces: async () => [{ slug: 'x', title: 'X', description: '', insights: [] }, { slug: 'y', title: 'Y', description: '', insights: [] }],
    readSpaceHtml: async (slug) => { if (slug === 'y') throw new Error('404'); return '<p>text</p>'; },
  });
  const [, skills, spaces] = out.notes;
  assert.equal(skills.status, 'partial');
  assert.equal(skills.read, 1);
  assert.equal(skills.of, 2);
  assert.match(skills.detail, /1 skill texts could not be read \(no file\)/);
  assert.equal(spaces.status, 'partial');
  assert.match(spaces.detail, /1 pages could not be read \(404\)/);
  assert.equal(out.sources.length, 4, 'every skill and space is still a source, by name and description');
});

test('the number of texts read is capped and the note says so', async () => {
  let skillReads = 0, pageReads = 0;
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const out = await loadUsageSources({
    skills: async () => many(MAX_SKILL_TEXTS + 20, (i) => ({ name: `s${i}`, description: '', dir: `s${i}` })),
    readSkill: async () => { skillReads++; return 'x'; },
    spaces: async () => many(MAX_SPACE_PAGES + 5, (i) => ({ slug: `p${i}`, title: `P${i}`, description: '', insights: [] })),
    readSpaceHtml: async () => { pageReads++; return '<p>x</p>'; },
  });
  assert.equal(skillReads, MAX_SKILL_TEXTS);
  assert.equal(pageReads, MAX_SPACE_PAGES);
  assert.match(out.notes[1].detail, new RegExp(`first ${MAX_SKILL_TEXTS} skills`));
  assert.match(out.notes[2].detail, new RegExp(`first ${MAX_SPACE_PAGES} Spaces`));
  assert.equal(out.sources.length, MAX_SKILL_TEXTS + 20 + MAX_SPACE_PAGES + 5, 'the capped ones still count by name and description');
});

test('decisions live in governance.json: set, take back, round trip through the store, and an older file has none', () => {
  const key = 'fin|CA|agent:a1';
  let gov = setUsageDecision(emptyGovernance(), key, 'confirmed', ' lena@example.com ', Date.UTC(2026, 10, 13));
  assert.equal(decisionsOf(gov)[key].decision, 'confirmed');
  assert.equal(decisionsOf(gov)[key].by, 'lena@example.com');
  const stored = normalizeGovernance(JSON.parse(JSON.stringify(gov)));
  assert.deepEqual(stored.usageDecisions, gov.usageDecisions, 'the store keeps a valid decision unchanged');
  assert.deepEqual(decisionsOf(setUsageDecision(gov, key, 'confirmed', 'x', 0)), {}, 'the same decision again takes it back');
  assert.equal(decisionsOf(setUsageDecision(gov, key, 'dismissed', 'lena', 1))[key].decision, 'dismissed', 'a person may change their mind');
  assert.deepEqual(normalizeGovernance({ version: 1, ontologies: {}, bindings: [] }).usageDecisions, {}, 'an older file has none');
  assert.deepEqual(decisionsOf({ ...emptyGovernance(), usageDecisions: undefined }), {}, 'and a governance without the field does not crash');
});

test('the store drops invalid decisions and limits what it keeps', () => {
  const bad = {
    'fin|CA|agent:a1': { decision: 'confirmed', by: 'x'.repeat(500), at: '2026-11-13T00:00:00.000Z' },
    'fin|CA|alien:a1': { decision: 'confirmed', by: 'x', at: '' },
    'not a slug|CA|agent:a1': { decision: 'confirmed', by: 'x', at: '' },
    'fin||agent:a1': { decision: 'confirmed', by: 'x', at: '' },
    'fin|CA|agent:a2': { decision: 'maybe', by: 'x', at: '' },
    'fin|CA|space:a3': null,
  };
  const g = normalizeGovernance({ version: 1, usageDecisions: bad });
  assert.deepEqual(Object.keys(g.usageDecisions), ['fin|CA|agent:a1']);
  assert.equal(g.usageDecisions['fin|CA|agent:a1'].by.length, 120);
  const huge = Object.fromEntries(Array.from({ length: 2500 }, (_, i) => [`fin|T${i}|agent:a`, { decision: 'dismissed', by: 'x', at: '' }]));
  assert.equal(Object.keys(normalizeGovernance({ usageDecisions: huge }).usageDecisions).length, 2000);
  assert.deepEqual(normalizeGovernance({ usageDecisions: 'nope' }).usageDecisions, {});
});

test('the Ontology Manager shows the probable users in the term details and passes the actor down; the styles use tokens only', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.match(read('src/ui/OntologyDetails.tsx'), /<OntologyUsers gov=\{gov\} onGovernance=\{onGovernance\} actor=\{actor\} usage=\{usage\} \/>/);
  const view = read('src/ui/OntologyManagerView.tsx');
  assert.match(view, /ontologies=\{ontologies\} actor=\{actor\}/);
  assert.match(view, /<Catalog [^>]*actor=\{actor\}/);
  assert.match(read('src/App.tsx'), /<OntologyManagerView [\s\S]*?actor=\{identity\?\.email \?\? ''\} \/>/);
  const users = read('src/ui/OntologyUsers.tsx');
  assert.match(users, /Find users/);
  assert.doesNotMatch(users, /\bfetch\(|localStorage/, 'the component reads through the loader, not by itself');
  const css = read('src/theme.css');
  const block = css.slice(css.indexOf('/* Ontology Manager: probable users'));
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, 'tokens only');
});

test('decision 010 (the decision log itself) is decided', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../docs/decisions/', import.meta.url);
  const f = readdirSync(dir).find((n) => n.startsWith('010-'));
  assert.match(readFileSync(new URL(f, dir), 'utf8'), /\*\*Status:\*\* entschieden/);
});

test('the plan shows the approval block: only approvePlan sets "approved", the old free status button is gone, the map reads the cache', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const details = read('src/ui/OntologyDetails.tsx');
  assert.match(details, /approvePlan\(gov, planId,/);
  assert.match(details, /\(\['asked', 'rejected'\] as PlanStatus\[\]\)/, 'the free status buttons no longer offer "approved"');
  assert.doesNotMatch(details, /setPlanStatus\(gov, p\.id, 'approved'\)/);
  assert.match(details, /Approval blocked: \{check\.reason\}/);
  assert.match(details, /<ChangePlan [^\n]*usage=\{usage\} actor=\{actor\}/);
  assert.match(read('src/ui/OntologyMap.tsx'), /cachedSuspected\(ontologies, gov\)/);
  const css = read('src/theme.css');
  const block = css.slice(css.indexOf('/* Ontology Manager: the plan shows what it reaches'));
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, 'tokens only');
});
