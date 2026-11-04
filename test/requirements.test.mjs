import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAN_HAND_OVER, CLASSES, MAX_ITEMS, clusterPrompt, commentOf, dismissSuggestion, fetchPrompt, handover, jqlOf, mergeRequirements, moveRequirement,
  overrideClass, parseClusters, parseRequirements, sanitizeExtends, sanitizeRefs, setTarget, sourcesOf,
} from '../src/requirements.ts';

const R = (key, title, extra = {}) => ({ id: `jira:${key}`, source: 'jira', key, title, text: '', url: '', author: '', date: '', ...extra });
const sel = [R('A-1', 'Weekly renewal report'), R('A-2', 'Remind owners of renewals'), R('A-3', 'New column in the contract list')];
const oth = [R('A-9', 'Renewal dashboard')];
const reg = [{ id: 'w1', kind: 'workflow', name: 'Contract upload' }, { id: 'a1', kind: 'agent', name: 'Renewal watcher' }, { id: 'f1', kind: 'feature', name: 'Some feature' }];
const fence = (o) => '```json\n' + JSON.stringify(o) + '\n```';

test('jqlOf: a project key, JQL and free text', () => {
  assert.equal(jqlOf(''), '');
  assert.equal(jqlOf('ABC'), 'project = ABC AND statusCategory != Done ORDER BY updated DESC');
  assert.equal(jqlOf('project = ABC AND labels = joule'), 'project = ABC AND labels = joule');
  assert.equal(jqlOf('status in (Open, Blocked)'), 'status in (Open, Blocked)');
  assert.equal(jqlOf('renewal "reminder"'), 'text ~ "renewal  reminder " ORDER BY updated DESC');
});

test('fetchPrompt: names the tools, stays read only and asks for JSON', () => {
  const j = fetchPrompt('jira', 'ABC');
  assert.match(j, /jira_search_issues/);
  assert.match(j, /project = ABC/);
  assert.match(j, /never create, change, comment on or post/);
  assert.match(fetchPrompt('slack', '#req'), /slack_read_channel/);
  assert.match(fetchPrompt('notion', 'Requirements DB'), /notion_read_page/);
  assert.match(fetchPrompt('notion', 'x'), /"error"/);
});

test('parseRequirements: fenced JSON, normalising, de-duplicating and limits', () => {
  const r = parseRequirements(fence({ items: [
    { key: 'A-1', title: 'One', text: 'x'.repeat(900), url: 'https://j/browse/A-1', author: 'Ann', date: '2026-11-01' },
    { key: 'A-1', title: 'Duplicate' },
    { title: 'No key', url: 'javascript:alert(1)' },
    { key: 'A-3' },
    'junk',
  ] }), 'jira');
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].id, 'jira:A-1');
  assert.equal(r.items[0].text.length, 600);
  assert.equal(r.items[0].url, 'https://j/browse/A-1');
  assert.equal(r.items[1].key, 'n3');
  assert.equal(r.items[1].url, '', 'only http(s) links');
  assert.deepEqual(parseRequirements('[{"key":"B-1","title":"Bare list"}]', 'slack').items.map((i) => i.id), ['slack:B-1']);
  const many = parseRequirements(JSON.stringify({ items: Array.from({ length: 80 }, (_, i) => ({ key: `K${i}`, title: `t${i}` })) }), 'jira');
  assert.equal(many.items.length, MAX_ITEMS);
});

test('parseRequirements: an error answer is valid, unreadable text is not', () => {
  assert.deepEqual(parseRequirements(fence({ items: [], error: 'No Notion tool is installed.' }), 'notion'), { items: [], error: 'No Notion tool is installed.' });
  assert.equal(parseRequirements('Sorry, I could not do that.', 'jira'), null);
  assert.equal(parseRequirements('{"nothing":1}', 'jira'), null);
});

test('mergeRequirements: same source and key replace the older entry', () => {
  const m = mergeRequirements([R('A-1', 'Old'), R('A-2', 'Keep')], [R('A-1', 'New'), R('A-5', 'Added')]);
  assert.deepEqual(m.map((r) => r.title), ['New', 'Keep', 'Added']);
});

test('sanitizeRefs and sanitizeExtends keep only what is valid', () => {
  assert.deepEqual(sanitizeRefs([{ source: 'jira', key: 'A-1', title: 't', url: 'https://x/y' }, { source: 'jira', key: 'A-1' }, { source: 'mail', key: 'x' }, { source: 'slack' }, null]),
    [{ source: 'jira', key: 'A-1', title: 't', url: 'https://x/y' }]);
  assert.deepEqual(sanitizeRefs('no'), []);
  assert.deepEqual(sanitizeExtends({ id: 'w1', name: 'Flow' }), { id: 'w1', name: 'Flow' });
  assert.equal(sanitizeExtends({ id: 'w1' }), undefined);
  assert.deepEqual(sourcesOf({}), {});
  assert.deepEqual(sourcesOf({ sources: [{ source: 'jira', key: 'A-1', title: '', url: '' }], extends: { id: 'w1', name: 'F' } }).extends, { id: 'w1', name: 'F' });
});

test('clusterPrompt: classes, registry, both lists and the rules', () => {
  const p = clusterPrompt(sel, oth, reg);
  for (const c of CLASSES) assert.ok(p.includes(`- ${c}:`), c);
  assert.match(p, /w1 \| workflow \| Contract upload/);
  assert.doesNotMatch(p, /Some feature/, 'features are no extension targets');
  assert.match(p, /jira:A-9 \| Renewal dashboard/);
  assert.match(p, /Never put it in requirements/);
});

const good = {
  clusters: [
    { title: 'Renewal reminders', summary: 'Remind owners.', requirements: ['jira:A-1', 'jira:A-2'], also_consider: [{ id: 'jira:A-9', reason: 'Same renewals' }, { id: 'jira:A-1', reason: 'already selected' }, { id: 'jira:zz', reason: 'unknown' }], class: 'agent-extension', confidence: 0.82, reason: 'Adds knowledge to an existing agent.', target_id: 'a1' },
    { title: 'Contract list', summary: 'Add a column.', requirements: ['jira:A-3'], class: 'feature', confidence: 1.7, reason: 'A screen change.' },
  ],
};

test('parseClusters: a valid answer is taken over, checked against the lists', () => {
  const { clusters, warnings } = parseClusters(fence(good), sel, oth, reg);
  assert.equal(clusters.length, 2);
  assert.deepEqual(warnings, []);
  assert.deepEqual(clusters[0].reqIds, ['jira:A-1', 'jira:A-2']);
  assert.deepEqual(clusters[0].suggestions, [{ reqId: 'jira:A-9', reason: 'Same renewals' }], 'only not selected, known requirements');
  assert.deepEqual(clusters[0].target, { id: 'a1', name: 'Renewal watcher' });
  assert.equal(clusters[1].confidence, 1, 'confidence is clamped');
});

test('parseClusters: every selected requirement ends in exactly one cluster', () => {
  const twice = { clusters: [
    { title: 'X', requirements: ['jira:A-1', 'jira:nope'], class: 'agent', confidence: 0.6 },
    { title: 'Y', requirements: ['jira:A-1', 'jira:A-2'], class: 'workflow', confidence: 0.6 },
  ] };
  const { clusters, warnings } = parseClusters(fence(twice), sel, oth, reg);
  assert.deepEqual(clusters[0].reqIds, ['jira:A-1']);
  assert.deepEqual(clusters[1].reqIds, ['jira:A-2'], 'a requirement already placed is not placed twice');
  const left = clusters[2];
  assert.equal(left.title, 'Not placed');
  assert.deepEqual(left.reqIds, ['jira:A-3']);
  assert.equal(left.cls, 'feature');
  assert.match(warnings[0], /not placed/);
  assert.equal(parseClusters('{"clusters":[]}', sel, oth, reg), null);
  assert.equal(parseClusters('nonsense', sel, oth, reg), null);
});

test('parseClusters: invalid class and extensions without a real target are flagged', () => {
  const bad = { clusters: [
    { title: 'Odd', requirements: ['jira:A-1'], class: 'robot', confidence: 0.9 },
    { title: 'Ext1', requirements: ['jira:A-2'], class: 'workflow-extension', confidence: 0.7, target_id: 'a1' },
    { title: 'Ext2', requirements: ['jira:A-3'], class: 'agent-extension', confidence: 0.7, target_id: 'missing' },
  ] };
  const { clusters, warnings } = parseClusters(fence(bad), sel, oth, reg);
  assert.equal(clusters[0].cls, 'feature');
  assert.ok(clusters[0].confidence <= 0.2);
  assert.equal(clusters[1].target, null, 'an agent id does not fit a workflow extension');
  assert.equal(clusters[2].target, null);
  assert.equal(warnings.length, 3);
  assert.equal(CAN_HAND_OVER(clusters[1]), false);
  assert.equal(CAN_HAND_OVER(clusters[0]), true);
});

test('overrideClass keeps the first proposal visible and clears it when changed back', () => {
  const [c0] = parseClusters(fence(good), sel, oth, reg).clusters;
  const asAgent = overrideClass(c0, 'agent', reg);
  assert.equal(asAgent.cls, 'agent');
  assert.equal(asAgent.overriddenFrom, 'agent-extension');
  assert.equal(asAgent.target, null, 'a new agent has no target');
  const again = overrideClass(asAgent, 'workflow', reg);
  assert.equal(again.overriddenFrom, 'agent-extension', 'the agent proposal stays the reference');
  const back = overrideClass(again, 'agent-extension', reg);
  assert.equal('overriddenFrom' in back, false);
  assert.match(back.warning, /Choose the existing agent/, 'the target was dropped on the way');
  assert.equal(overrideClass(c0, 'agent-extension', reg), c0, 'same class: unchanged');
  const wf = overrideClass(c0, 'workflow-extension', reg);
  assert.match(wf.warning, /workflow/);
  assert.equal(setTarget(wf, { id: 'w1', name: 'Contract upload' }).warning, undefined);
});

test('moveRequirement and dismissSuggestion', () => {
  const { clusters } = parseClusters(fence(good), sel, oth, reg);
  const moved = moveRequirement(clusters, 'jira:A-2', 'c2');
  assert.deepEqual(moved[0].reqIds, ['jira:A-1']);
  assert.deepEqual(moved[1].reqIds, ['jira:A-3', 'jira:A-2']);
  const added = moveRequirement(moved, 'jira:A-9', 'c1');
  assert.deepEqual(added[0].reqIds, ['jira:A-1', 'jira:A-9']);
  assert.deepEqual(added[0].suggestions, [], 'the suggestion is used up');
  const empty = moveRequirement(moved, 'jira:A-1', 'c2');
  assert.equal(empty.length, 1, 'a cluster without requirements disappears');
  assert.equal(moveRequirement(clusters, 'jira:A-1', 'nope'), clusters);
  assert.deepEqual(dismissSuggestion(clusters, 'c1', 'jira:A-9')[0].suggestions, []);
});

test('commentOf: class, confidence, reason, target and a change by the person', () => {
  const [c0] = parseClusters(fence(good), sel, oth, reg).clusters;
  const text = commentOf(c0);
  assert.match(text, /Class: Agent extension · Confidence 82 % · Extends: Renewal watcher/);
  assert.match(text, /Why: Adds knowledge/);
  assert.match(commentOf(overrideClass(c0, 'agent', reg)), /Changed by you from Agent extension/);
});

test('handover: goal within 400 characters, links, extension and brief', () => {
  const { clusters } = parseClusters(fence(good), sel, oth, reg);
  const reqs = [...sel, ...oth].map((r) => (r.key === 'A-1' ? { ...r, text: 'Every Monday.', url: 'https://j/A-1' } : r));
  const h = handover(clusters[0], reqs);
  assert.equal(h.base, 'agent');
  assert.deepEqual(h.extends, { id: 'a1', name: 'Renewal watcher' });
  assert.match(h.goal, /^Extend "Renewal watcher": Remind owners\./);
  assert.deepEqual(h.refs.map((r) => r.key), ['A-1', 'A-2']);
  assert.match(h.brief, /\*\*A-1\*\* \(jira\) Weekly renewal report: Every Monday\. https:\/\/j\/A-1/);
  assert.match(h.brief, /Class: Agent extension/);
  const f = handover(clusters[1], reqs);
  assert.equal(f.base, 'feature');
  assert.equal(f.extends, undefined);
  const long = handover({ ...clusters[1], summary: 'word '.repeat(200) }, reqs);
  assert.ok(long.goal.length <= 400);
  assert.equal(handover({ ...clusters[0], cls: 'workflow-extension' }, reqs).base, 'workflow');
});
