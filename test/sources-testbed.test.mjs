import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset, plan, expectedTable, createJira, createSlack, LABEL, MARK } from '../scripts/sources-testbed.mjs';

const d = loadDataset();

test('expected counts match the dataset', () => {
  for (const t of d.themes) {
    const slack = d.slack.flatMap((m) => [m, ...(m.replies ?? [])]).filter((m) => m.theme === t.id).length;
    const jira = d.jira.filter((i) => i.theme === t.id).length;
    assert.equal(slack, t.expect.slack, t.id);
    assert.equal(jira, t.expect.jira, t.id);
  }
  assert.match(expectedTable(d), /Renewal reminders\s+5\s+1\s+6/);
});

test('dry run plan marks slack messages and respects --only', () => {
  assert.ok(plan(d).filter((x) => x.where === 'slack').every((x) => x.text.endsWith(MARK)));
  assert.equal(plan(d, { only: 'jira' }).every((x) => x.where === 'jira'), true);
  assert.equal(plan(d, { only: 'slack' }).some((x) => x.where === 'jira'), false);
});

test('createJira posts labelled issues and masks the token in errors', async () => {
  const calls = [];
  const ok = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, text: async () => JSON.stringify({ key: `TB-${calls.length}` }) }; };
  const keys = await createJira(d, { site: 'https://x.atlassian.net', email: 'a@b.c', token: 'SECRET', project: 'TB', fetchImpl: ok });
  assert.equal(keys.length, d.jira.length);
  assert.deepEqual(calls[0].body.fields.labels, [LABEL]);
  const bad = async () => ({ ok: false, status: 401, text: async () => 'bad SECRET' });
  await assert.rejects(createJira(d, { site: 'https://x.atlassian.net', email: 'a@b.c', token: 'SECRET', project: 'TB', fetchImpl: bad }), (e) => !e.message.includes('SECRET'));
  await assert.rejects(createJira(d, { site: 'http://evil', email: 'a', token: 'b', project: 'TB' }), /JIRA_SITE/);
  await assert.rejects(createJira(d, { site: 'https://x.atlassian.net', email: 'a', token: 'b', project: 'tb' }), /project key/);
});

test('createSlack threads replies under their root message', async () => {
  const sent = [];
  const f = async (url, o) => {
    if (url.includes('conversations.list')) return { json: async () => ({ ok: true, channels: [{ name: 'testbed', id: 'C0123456789' }] }) };
    const b = JSON.parse(o.body); sent.push(b);
    return { json: async () => ({ ok: true, ts: `1.${sent.length}` }) };
  };
  const n = await createSlack(d, { token: 'xoxb-1', channel: 'testbed', fetchImpl: f, pause: 0 });
  assert.equal(n, plan(d, { only: 'slack' }).length);
  assert.ok(sent.every((b) => b.channel === 'C0123456789'));
  assert.equal(sent.filter((b) => b.thread_ts).length, 2);
  await assert.rejects(createSlack(d, { token: 'nope', channel: 'x' }), /SLACK_BOT_TOKEN/);
});
