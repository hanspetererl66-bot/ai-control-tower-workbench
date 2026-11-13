#!/usr/bin/env node
/**
 * A test bed with a known answer for "Requirement collection": a few invented requirements, voiced several times in
 * Slack and Jira, plus chatter. After it ran, load Slack and Jira in the app and compare with the expected table.
 *
 *   node scripts/sources-testbed.mjs --expect                          the expected answer
 *   node scripts/sources-testbed.mjs --project TB --channel testbed    show what would be created (changes nothing)
 *   JIRA_SITE=https://firma.atlassian.net JIRA_EMAIL=you@firma.com JIRA_API_TOKEN=... SLACK_BOT_TOKEN=xoxb-... \
 *     node scripts/sources-testbed.mjs --project TB --channel testbed --create
 *
 * --only jira | slack limits it to one side. Use a test Jira project and a test Slack channel (the bot must be in it).
 * Nothing is deleted by this script. Jira issues carry the label werkbank-testbed, Slack messages end with [testbed].
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const loadDataset = () => JSON.parse(readFileSync(join(ROOT, 'examples/sources-testbed/dataset.json'), 'utf8'));
export const LABEL = 'werkbank-testbed';
export const MARK = ' [testbed]';
const KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function expectedTable(d) {
  const lines = ['Theme'.padEnd(52) + 'Slack  Jira  Total  Class'];
  for (const t of d.themes) lines.push(t.title.padEnd(52) + String(t.expect.slack).padEnd(7) + String(t.expect.jira).padEnd(6) + String(t.expect.slack + t.expect.jira).padEnd(7) + t.expectClass.join(' or '));
  const slackNoise = d.slack.filter((m) => !m.theme).length + d.slack.flatMap((m) => m.replies ?? []).filter((m) => !m.theme).length;
  lines.push('', `Chatter that must NOT become a requirement: ${slackNoise} Slack messages. Counting rule: ${d.note}`);
  return lines.join('\n');
}

/** What would be sent, without sending it. */
export function plan(d, { only } = {}) {
  const out = [];
  if (only !== 'jira') for (const m of d.slack) { out.push({ where: 'slack', text: m.text + MARK }); for (const r of m.replies ?? []) out.push({ where: 'slack', thread: true, text: r.text + MARK }); }
  if (only !== 'slack') for (const i of d.jira) out.push({ where: 'jira', text: i.summary });
  return out;
}

const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

export async function createJira(d, { site, email, token, project, fetchImpl = fetch }) {
  if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/i.test(site ?? '')) throw new Error('JIRA_SITE must look like https://yourfirm.atlassian.net');
  if (!KEY.test(project ?? '')) throw new Error('--project must be the project key (capital letters), for example TB.');
  if (!email || !token) throw new Error('JIRA_EMAIL and JIRA_API_TOKEN are needed.');
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  const made = [];
  for (const i of d.jira) {
    const res = await fetchImpl(`${site}/rest/api/3/issue`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ fields: { project: { key: project }, issuetype: { name: 'Task' }, summary: i.summary, description: adf(i.description), labels: [LABEL] } }) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Jira ${res.status}: ${text.replace(token, '***').slice(0, 300)}`);
    made.push(JSON.parse(text).key);
  }
  return made;
}

export async function createSlack(d, { token, channel, fetchImpl = fetch, pause = 1100 }) {
  if (!/^xoxb-/.test(token ?? '')) throw new Error('SLACK_BOT_TOKEN (xoxb-…) is needed.');
  if (!channel) throw new Error('--channel is needed (a channel name or id).');
  const call = async (method, body) => {
    const res = await fetchImpl(`https://slack.com/api/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error === 'not_in_channel' ? 'The bot is not in that channel: invite it first (/invite @appname).' : j.error === 'channel_not_found' ? 'Slack does not know that channel. Use the channel id (C…), or invite the bot to a private channel.' : `Slack: ${j.error}`);
    return j;
  };
  let id = channel.replace(/^#/, '');
  if (!/^[CG][A-Z0-9]{8,}$/.test(id)) {
    const list = await (await fetchImpl('https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=500', { headers: { Authorization: `Bearer ${token}` } })).json();
    const hit = (list.channels ?? []).find((c) => c.name === id);
    if (!hit) throw new Error(`No channel called "${id}" that the bot can see. Create it, invite the bot, or pass the channel id.`);
    id = hit.id;
  }
  let n = 0;
  for (const m of d.slack) {
    const root = await call('chat.postMessage', { channel: id, text: m.text + MARK }); n++; await sleep(pause);
    for (const r of m.replies ?? []) { await call('chat.postMessage', { channel: id, thread_ts: root.ts, text: r.text + MARK }); n++; await sleep(pause); }
  }
  return n;
}

async function main() {
  const a = process.argv.slice(2);
  const get = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  const d = loadDataset();
  if (a.includes('--expect')) { console.log(expectedTable(d)); return; }
  const only = get('--only');
  const p = plan(d, { only });
  if (!a.includes('--create')) {
    console.log(`Dry run: nothing is created. Would send ${p.filter((x) => x.where === 'jira').length} Jira issues and ${p.filter((x) => x.where === 'slack').length} Slack messages:\n`);
    for (const x of p) console.log(`  ${x.where.padEnd(5)} ${x.thread ? '  ↳ ' : ''}${x.text.slice(0, 90)}`);
    console.log('\nAdd --create (with the variables from the header) to send them. --expect shows the answer to compare with.');
    return;
  }
  if (only !== 'slack') console.log('Jira issues:', (await createJira(d, { site: process.env.JIRA_SITE, email: process.env.JIRA_EMAIL, token: process.env.JIRA_API_TOKEN, project: get('--project') })).join(', '));
  if (only !== 'jira') console.log('Slack messages sent:', await createSlack(d, { token: process.env.SLACK_BOT_TOKEN, channel: get('--channel') }));
  console.log('\nNow load both in the app (Develop, Requirement collection) and compare with:\n\n' + expectedTable(d));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(`Stopped: ${e.message}`); process.exit(1); });
