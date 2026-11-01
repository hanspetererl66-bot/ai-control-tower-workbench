#!/usr/bin/env node
/**
 * Creates the sample backlog (epics and stories) in a Jira Cloud project, or writes it as a CSV for Jira's importer.
 *
 *   node scripts/jira-seed.mjs --csv                      write examples/jira-demo/sales-app-backlog.csv
 *   node scripts/jira-seed.mjs --projects                 list the project keys the account can see (needs the three JIRA_ variables)
 *   node scripts/jira-seed.mjs --project ABC              show what would be created (nothing is changed)
 *   JIRA_SITE=https://firma.atlassian.net JIRA_EMAIL=you@firma.com JIRA_API_TOKEN=... \
 *     node scripts/jira-seed.mjs --project ABC --create   create the issues for real
 *
 * Stories are linked to their epic through the parent field (Jira Cloud). Use a test project.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BACKLOG_FILE = join(ROOT, 'examples/jira-demo/sales-app-backlog.json');
export const loadBacklog = () => JSON.parse(readFileSync(BACKLOG_FILE, 'utf8'));

/** Atlassian Document Format: the description as paragraphs and a bullet list. */
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
export function storyDescription(s) {
  return { type: 'doc', version: 1, content: [para(s.story), para('Acceptance criteria'), { type: 'bulletList', content: s.criteria.map((c) => ({ type: 'listItem', content: [para(c)] })) }] };
}
export const epicDescription = (e) => ({ type: 'doc', version: 1, content: [para(e.description)] });

const plainStory = (s) => `${s.story}\n\nAcceptance criteria:\n${s.criteria.map((c) => `* ${c}`).join('\n')}`;
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** CSV for Jira's importer (Settings > System > External system import > CSV). Map "Parent" to the parent field. */
export function toCsv(b) {
  const head = ['Issue Id', 'Issue Type', 'Summary', 'Description', 'Priority', 'Labels', 'Story Points', 'Parent'];
  const rows = [head];
  b.epics.forEach((e, i) => rows.push([i + 1, 'Epic', e.summary, e.description, e.priority, e.labels.join(' '), '', '']));
  b.stories.forEach((s, i) => rows.push([b.epics.length + i + 1, 'Story', s.summary, plainStory(s), s.priority, s.labels.join(' '), s.points, b.epics.findIndex((e) => e.ref === s.epic) + 1]));
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** The project key for what the person typed: the key itself, or the project name (a name like "My Project" is not a key). */
export async function resolveProject(site, auth, typed) {
  const res = await fetch(`${site}/rest/api/3/project/search?maxResults=100`, { headers: { Authorization: auth, Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ${res.status}: ${text.slice(0, 300)}`);
  const projects = (JSON.parse(text).values ?? []).map((p) => ({ key: p.key, name: p.name }));
  const t = typed.trim().toLowerCase();
  const hit = projects.find((p) => p.key.toLowerCase() === t) ?? projects.find((p) => p.name.toLowerCase() === t);
  return { key: hit?.key, projects };
}

async function jira(site, auth, path, body) {
  const res = await fetch(`${site}/rest/api/3/${path}`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function createAll(b, { site, email, token, project }) {
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  const found = await resolveProject(site, auth, project);
  if (!found.key) throw new Error(`No project "${project}" for this account. Projects it can see: ${found.projects.map((p) => `${p.key} (${p.name})`).join(', ') || 'none'}. Use the key (the short code) with --project.`);
  if (found.key !== project) console.log(`"${project}" is the project ${found.key}.`);
  project = found.key;
  const keys = {};
  for (const e of b.epics) {
    const r = await jira(site, auth, 'issue', { fields: { project: { key: project }, issuetype: { name: 'Epic' }, summary: e.summary, description: epicDescription(e), labels: e.labels } });
    keys[e.ref] = r.key; console.log(`Epic  ${r.key}  ${e.summary}`);
  }
  for (const s of b.stories) {
    const r = await jira(site, auth, 'issue', { fields: { project: { key: project }, issuetype: { name: 'Story' }, summary: s.summary, description: storyDescription(s), labels: s.labels, parent: { key: keys[s.epic] } } });
    console.log(`Story ${r.key}  ${s.summary}  (in ${keys[s.epic]})`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const b = loadBacklog();
  if (args.includes('--csv')) {
    const out = join(ROOT, 'examples/jira-demo/sales-app-backlog.csv');
    writeFileSync(out, toCsv(b)); console.log(`Wrote ${out}`);
  } else {
    const project = opt('--project');
    if (args.includes('--projects')) {
      const { JIRA_SITE: site, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = process.env;
      if (!site || !email || !token) { console.error('Set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN first.'); process.exit(1); }
      const found = await resolveProject(site.replace(/\/$/, ''), `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`, '');
      console.log(found.projects.length ? found.projects.map((p) => `${p.key}\t${p.name}`).join('\n') : 'This account sees no projects.');
      process.exit(0);
    }
    if (!project) { console.error('Give the project key: --project ABC (or --csv).'); process.exit(1); }
    if (!args.includes('--create')) {
      console.log(`Would create in ${project}: ${b.epics.length} epics, ${b.stories.length} stories. Nothing was changed. Add --create to do it.`);
      for (const e of b.epics) { console.log(`\nEpic: ${e.summary}`); b.stories.filter((s) => s.epic === e.ref).forEach((s) => console.log(`  - ${s.summary} (${s.points} SP, ${s.priority})`)); }
    } else {
      const { JIRA_SITE: site, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = process.env;
      if (!site || !email || !token) { console.error('Set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN first.'); process.exit(1); }
      await createAll(b, { site: site.replace(/\/$/, ''), email, token, project });
    }
  }
}
