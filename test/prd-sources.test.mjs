import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { fromLinear, fromNotion, fromSlack, notionChoices, notionId, slackPlain } from '../src/prd-sources.ts';
import { handlePrdMessage, prdExtensionFor } from '../src/prd-bridge.ts';
import { buildPrd, groupByEpic, openQuestions } from '../examples/prd-builder/prd-model.mjs';
import { embedPrdBuilder, demoMulti } from '../scripts/sync-prd-builder.mjs';

const ROOT = join(import.meta.dirname, '..');
const demo = JSON.parse(readFileSync(join(ROOT, 'examples/prd-builder/demo-sources.json'), 'utf8'));
const page = readFileSync(join(ROOT, 'examples/prd-builder/index.html'), 'utf8');

test('Linear: issues become stories under their project; priority is mapped; no project means no epic', () => {
  const l = fromLinear(demo.linear);
  assert.deepEqual(l.filter((i) => i.type === 'Epic').map((i) => i.summary).sort(), ['Mobile', 'Pipeline view']);
  const s41 = l.find((i) => i.key === 'SAL-41');
  assert.equal(s41.type, 'Story'); assert.equal(s41.source, 'linear'); assert.equal(s41.priority, 'High'); assert.equal(s41.parentSummary, 'Pipeline view');
  assert.equal(l.find((i) => i.key === 'SAL-51').parentKey, null);
  assert.equal(fromLinear([{ id: 'X-1', title: 't', priority: 'Urgent' }])[0].priority, 'Highest');
  assert.deepEqual(fromLinear('nope'), []);
  assert.equal(fromLinear(Array.from({ length: 300 }, (_, i) => ({ id: `A-${i}`, title: 't' }))).length, 100, 'at most 100 issues');
});

test('Slack: top-level messages with some substance become notes under the channel; mentions and links are readable', () => {
  const l = fromSlack(demo.slack.messages, '#sales-feedback');
  const notes = l.filter((i) => i.type === 'Note');
  assert.equal(notes.length, 3, 'the one-word message and the thread reply are left out');
  assert.equal(l[0].type, 'Epic'); assert.equal(l[0].summary, 'Slack #sales-feedback');
  assert.ok(notes.every((n) => n.source === 'slack' && n.parentKey === l[0].key && n.key.startsWith('SLACK-')));
  assert.match(notes.find((n) => n.description.includes('quarterly forecast')).description, /@U01SELLER and I/);
  assert.match(notes.find((n) => n.description.includes('Offline')).description, /SAL-47 \(https:\/\/linear\.example\/SAL-47\)/);
  assert.deepEqual(fromSlack([{ ts: 'x', text: 'a long enough message here' }], 'c'), [], 'a bad timestamp is dropped');
  assert.equal(slackPlain('Hi <!channel> &amp; <#C12345678|dev> <@U1|anna>'), 'Hi @channel & #dev @anna');
});

test('Notion: a page becomes one note per section with text; short sections are left out', () => {
  const l = fromNotion(demo.notion);
  assert.equal(l[0].type, 'Epic'); assert.equal(l[0].summary, 'Quarterly planning: Sales Companion');
  assert.deepEqual(l.slice(1).map((n) => n.summary), ['Goals', 'Customer requests', 'Risks']);
  assert.ok(l.slice(1).every((n) => n.source === 'notion' && n.type === 'Note' && n.url.startsWith('https://notion.example/')));
  assert.deepEqual(fromNotion(null), []);
  assert.deepEqual(fromNotion({ id: '0f5c1d2e3a4b4c5d8e9f0a1b2c3d4e5f', title: 'x', text: '# Short\nok' }), []);
  assert.equal(fromNotion({ title: 'Plain', text: 'A paragraph without any heading but long enough to count.' })[1].summary, 'Plain');
});

test('Notion ids: a bare id, an id with dashes or a notion.so link; other links and text are refused', () => {
  const id = '0f5c1d2e3a4b4c5d8e9f0a1b2c3d4e5f';
  assert.equal(notionId(id), id);
  assert.equal(notionId('0f5c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f'), id);
  assert.equal(notionId(`https://www.notion.so/team/Quarterly-planning-${id}?pvs=4`), id);
  assert.equal(notionId(`https://evil.example/${id}`), null);
  assert.equal(notionId('quarterly planning'), null);
  assert.equal(notionId(42), null);
  assert.deepEqual(notionChoices({ results: [{ id, type: 'page', title: 'A', url: 'u' }, { id, type: 'database', title: 'D' }, { id: 'bad', type: 'page' }] }), [{ id, title: 'A', url: 'u' }]);
});

test('the PRD of notes and tickets together: notes are quoted and raise one open question each; sources are named; Jira-only PRDs read as before', () => {
  const issues = [...fromLinear(demo.linear), ...fromSlack(demo.slack.messages, 'sales-feedback'), ...fromNotion(demo.notion)];
  const md = buildPrd({ project: 'Linear SAL + Slack #sales-feedback + Notion', issues, selectedKeys: issues.map((i) => i.key), today: '2026-11-14' });
  assert.match(md, /^# Product requirements: Linear SAL/);
  assert.match(md, /Draft from Linear, Slack, Notion, 2026-11-14\. 4 requirements and 6 notes from 14 items/);
  assert.match(md, /> Three customers this week asked/);
  assert.match(md, /note from Slack\)/);
  assert.match(md, /## 7\. Sources\n/);
  assert.match(md, /· Note · Notion · - · - · Goals · https:\/\/notion\.example\//);
  const q = md.slice(md.indexOf('## 6.'), md.indexOf('## 7.'));
  assert.equal((q.match(/a note from (Slack|Notion), not yet a requirement/g) || []).length, 6);
  const users = md.slice(md.indexOf('## 3.'), md.indexOf('## 4.'));
  assert.ok(!/SLACK-|NOTION-/.test(users), 'notes name no user role');
  assert.match(users, /\*\*unnamed role\*\*: SAL-47/, 'a ticket without a role still shows as before');
  const goals = md.slice(md.indexOf('## 2.'), md.indexOf('## 3.'));
  assert.ok(goals.includes('Pipeline view') && !goals.includes('Slack #sales-feedback'), 'a channel is not a goal');
  assert.equal(openQuestions([{ key: 'N-1', type: 'Note', source: 'slack', description: 'x' }], [], new Set(['N-1'])).length, 1);
  const jiraOnly = buildPrd({ project: 'A', issues: [{ key: 'A-1', type: 'Story', summary: 's', description: 'As a seller I want x.\nAcceptance criteria\n- y', priority: 'High', parentKey: null }], selectedKeys: ['A-1'], today: '2026-11-14' });
  assert.match(jiraOnly, /Draft from Jira, 2026-11-14\. 1 requirements from 1 tickets of project A\./);
  assert.match(jiraOnly, /## 7\. Source tickets/);
  assert.equal(groupByEpic(issues).length, 5, 'four groups and the ticket without a project');
});

test('the bridge: Linear, Slack and Notion only through read-only tools, with checked inputs', async () => {
  const calls = [];
  const answer = (tool, args) => {
    if (tool === 'linear_list_teams') return { teams: [{ key: 'SAL', name: 'Sales' }, { key: 'bad key', name: 'x' }] };
    if (tool === 'linear_read_backlog') return { issues: demo.linear };
    if (tool === 'slack_list_channels') return { channels: [{ id: 'C0123456789', name: 'sales-feedback', member: true }, { id: 'C0999999999', name: 'secret', member: false }] };
    if (tool === 'slack_read_channel') return { messages: demo.slack.messages };
    if (tool === 'notion_search') return { results: [{ id: demo.notion.id, type: 'page', title: 'Quarterly planning', url: 'u' }] };
    if (tool === 'notion_read_page') return demo.notion;
    throw new Error(`unexpected ${tool}`);
  };
  const call = async (tool, args) => { calls.push([tool, args]); return { content: [{ type: 'text', text: JSON.stringify(answer(tool, args)) }] }; };
  assert.deepEqual((await handlePrdMessage({ type: 'prd:linear-teams-request' }, call)).teams, [{ key: 'SAL', name: 'Sales' }]);
  assert.deepEqual((await handlePrdMessage({ type: 'prd:slack-channels-request' }, call)).channels, [{ id: 'C0123456789', name: 'sales-feedback' }], 'only channels the app is a member of');
  const lin = await handlePrdMessage({ type: 'prd:source-request', source: 'linear', team: 'sal' }, call);
  assert.equal(lin.type, 'prd:backlog'); assert.equal(lin.source, 'linear'); assert.equal(calls.at(-1)[1].team, 'SAL'); assert.ok(lin.issues.some((i) => i.key === 'SAL-41'));
  const byName = await handlePrdMessage({ type: 'prd:source-request', source: 'slack', channel: '#sales-feedback' }, call);
  assert.equal(byName.type, 'prd:backlog'); assert.equal(byName.project, 'Slack #sales-feedback');
  assert.deepEqual(calls.filter((c) => c[0] === 'slack_read_channel').at(-1)[1], { channel: 'C0123456789', limit: 50 });
  assert.equal((await handlePrdMessage({ type: 'prd:source-request', source: 'slack', channel: 'nothere' }, call)).type, 'prd:error');
  const choices = await handlePrdMessage({ type: 'prd:source-request', source: 'notion', query: 'quarterly planning' }, call);
  assert.equal(choices.type, 'prd:notion-choices'); assert.equal(choices.choices[0].id, demo.notion.id);
  const nd = await handlePrdMessage({ type: 'prd:source-request', source: 'notion', query: demo.notion.id }, call);
  assert.equal(nd.type, 'prd:backlog'); assert.equal(nd.source, 'notion'); assert.ok(nd.issues.length >= 4);
  for (const bad of [{ source: 'linear', team: 'x; drop' }, { source: 'slack', channel: '../etc' }, { source: 'notion', query: '' }, { source: 'jira' }, { source: 'teams' }])
    assert.equal((await handlePrdMessage({ type: 'prd:source-request', ...bad }, call)).type, 'prd:error', JSON.stringify(bad));
  for (const src of ['linear', 'slack', 'notion']) assert.match((await handlePrdMessage({ type: 'prd:source-request', source: src, team: 'SAL', channel: 'general', query: 'x' }, undefined)).message, /not connected/);
  const allowed = ['linear_list_teams', 'linear_read_backlog', 'slack_list_channels', 'slack_read_channel', 'notion_search', 'notion_read_page'];
  assert.deepEqual([...new Set(calls.map((c) => c[0]))].filter((t) => !allowed.includes(t)), [], 'nothing that writes is ever called');
  assert.equal(prdExtensionFor('slack_read_channel', ['jira', 'slack-prod', 'linear']), 'slack-prod');
  assert.equal(prdExtensionFor('notion_search', ['jira']), 'notion');
  assert.equal(prdExtensionFor('jira_read_backlog', []), 'jira');
});

test('the page embeds the demo answers of the three sources and is in sync', () => {
  assert.equal(embedPrdBuilder(page, JSON.parse(/id="prd-demo">\n([\s\S]*?)\n<\/script>/.exec(page)[1]), undefined, /<style id="design-system">([\s\S]*?)<\/style>/.exec(page)[1].length ? readFileSync(join(ROOT, 'examples/shared/design-system.css'), 'utf8') : '', demoMulti()).length > 0, true);
  const multi = JSON.parse(/id="prd-demo-multi">\n([\s\S]*?)\n<\/script>/.exec(page)[1]);
  assert.deepEqual(Object.keys(multi).sort(), ['linear', 'notion', 'slack']);
  assert.deepEqual(multi, JSON.parse(JSON.stringify(demoMulti())));
  assert.doesNotMatch(page, /\bfetch\(|XMLHttpRequest|localStorage/, 'Spaces have no network and no localStorage');
});

function open() {
  const sent = [], errors = [];
  const dom = new JSDOM(page, {
    runScripts: 'dangerously',
    beforeParse(w) { Object.defineProperty(w, 'parent', { value: { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } }); w.addEventListener('error', (e) => errors.push(e.message)); },
  });
  const w = dom.window, d = w.document;
  const reply = (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w.parent }));
  const click = (sel) => { const el = d.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); };
  return { w, d, sent, errors, reply, click };
}

test('the page: pick a source, load it, combine sources, take a source out again, demo of all three', () => {
  const p = open();
  const { d } = p;
  assert.equal(d.querySelectorAll('.srcs button').length, 4);
  assert.equal(d.querySelector('.srcs [aria-pressed=true]').dataset.src, 'jira');
  // Linear
  p.click('.srcs [data-src=linear]');
  assert.equal(d.querySelector('#load').textContent, 'Load from Linear');
  assert.equal(d.querySelector('#proj').getAttribute('list'), 'teams');
  assert.ok(p.sent.some((m) => m.type === 'prd:linear-teams-request'));
  d.querySelector('#proj').value = 'SAL'; p.click('#load');
  assert.deepEqual(p.sent.at(-1), { type: 'prd:source-request', source: 'linear', team: 'SAL' });
  p.reply({ type: 'prd:backlog', source: 'linear', project: 'Linear SAL', issues: fromLinear(demo.linear) });
  assert.equal(d.querySelectorAll('.parts .part').length, 1);
  assert.match(d.querySelector('#prd').value, /Draft from Linear/);
  // Slack, added to it
  p.click('.srcs [data-src=slack]');
  assert.ok(p.sent.some((m) => m.type === 'prd:slack-channels-request'));
  d.querySelector('#proj').value = 'sales-feedback'; p.click('#load');
  assert.deepEqual(p.sent.at(-1), { type: 'prd:source-request', source: 'slack', channel: 'sales-feedback' });
  p.reply({ type: 'prd:backlog', source: 'slack', project: 'Slack #sales-feedback', issues: fromSlack(demo.slack.messages, 'sales-feedback') });
  assert.equal(d.querySelectorAll('.parts .part').length, 2);
  assert.match(d.querySelector('#prd').value, /Draft from Linear, Slack/);
  assert.ok(d.querySelector('#tree').textContent.includes('note · Slack'));
  // Notion: search first, then choose
  p.click('.srcs [data-src=notion]');
  assert.equal(d.querySelector('#proj').hasAttribute('list'), false);
  d.querySelector('#proj').value = 'planning'; p.click('#load');
  p.reply({ type: 'prd:notion-choices', choices: [{ id: demo.notion.id, title: 'Quarterly planning', url: 'u' }] });
  assert.equal(d.querySelector('#choices').hidden, false);
  p.click('#choices [data-id]');
  assert.deepEqual(p.sent.at(-1), { type: 'prd:source-request', source: 'notion', query: demo.notion.id });
  p.reply({ type: 'prd:backlog', source: 'notion', project: 'Notion Quarterly planning', issues: fromNotion(demo.notion) });
  assert.equal(d.querySelector('#choices').hidden, true);
  assert.equal(d.querySelectorAll('.parts .part').length, 3);
  // the selection decides what is in the document; a note quotes its source
  const box = d.querySelector('#tree input[data-k^="SLACK-"]'); box.checked = false; box.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  assert.match(d.querySelector('#prd').value, /note from Notion\)/);
  // take a source out again
  p.click('.parts [data-rm=slack]');
  assert.equal(d.querySelectorAll('.parts .part').length, 2);
  assert.ok(!d.querySelector('#prd').value.includes('SLACK-'));
  // loading the same source again replaces its part
  p.reply({ type: 'prd:backlog', source: 'linear', project: 'Linear SAL', issues: fromLinear(demo.linear).slice(0, 2) });
  assert.equal(d.querySelectorAll('.parts .part').length, 2);
  // errors show in the status line
  p.reply({ type: 'prd:error', message: 'The Slack connector is not connected yet.' });
  assert.match(d.querySelector('#status').textContent, /Slack connector/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('the page: the demo of Linear, Slack and Notion loads without any connector; the Jira demo still works and mixes with it', () => {
  const p = open();
  p.click('#demoMulti');
  assert.equal(p.d.querySelectorAll('.parts .part').length, 3);
  assert.match(p.d.querySelector('#status').textContent, /Demo: \d+ items from Linear, Slack and Notion/);
  assert.match(p.d.querySelector('#prd').value, /note from Slack\)/);
  p.click('#demo');
  assert.equal(p.d.querySelectorAll('.parts .part').length, 4);
  assert.match(p.d.querySelector('#prd').value, /Draft from Linear, Slack, Notion, Jira/);
  assert.match(p.d.querySelector('#count').textContent, /\d+ of \d+ requirements selected/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});
