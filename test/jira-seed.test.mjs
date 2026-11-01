import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBacklog, toCsv, storyDescription, createAll } from '../scripts/jira-seed.mjs';

const b = loadBacklog();

test('the sample backlog has 3-4 epics and 10-15 stories, each linked to an epic and with acceptance criteria', () => {
  assert.ok(b.epics.length >= 3 && b.epics.length <= 4);
  assert.ok(b.stories.length >= 10 && b.stories.length <= 15);
  const refs = new Set(b.epics.map((e) => e.ref));
  for (const s of b.stories) {
    assert.ok(refs.has(s.epic), s.summary);
    assert.ok(s.criteria.length >= 3 && /^As an? /.test(s.story), s.summary);
    assert.ok([2, 3, 5, 8].includes(s.points), s.summary);
  }
  for (const e of b.epics) assert.ok(b.stories.some((s) => s.epic === e.ref), e.summary);
});

test('the CSV has one row per issue and points stories at their epic', () => {
  const csv = toCsv(b);
  const rows = csv.match(/^"\d+","(Epic|Story)"/gm);
  assert.equal(rows.length, b.epics.length + b.stories.length);
  assert.equal(rows.filter((r) => r.includes('Epic')).length, b.epics.length);
  assert.match(csv, /"Story",[^\n]*"Kanban view of the pipeline by stage"/);
  assert.match(csv, /,"2"\n"6","Story"|"Story"[\s\S]*?,"\d+","1"\n/);
});

test('story descriptions are valid Atlassian document format', () => {
  const d = storyDescription(b.stories[0]);
  assert.equal(d.type, 'doc'); assert.equal(d.content[2].type, 'bulletList'); assert.equal(d.content[2].content.length, b.stories[0].criteria.length);
});

test('createAll creates epics first, then stories under the returned epic keys (fake Jira)', async () => {
  const calls = []; let n = 0; const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (init.method !== 'POST') return { ok: true, text: async () => JSON.stringify({ values: [{ key: 'DEMO', name: 'My Demo Project' }] }) }; const body = JSON.parse(init.body); calls.push(body.fields); return { ok: true, text: async () => JSON.stringify({ key: `DEMO-${++n}` }) }; };
  const log = console.log; console.log = () => {};
  try { await createAll(b, { site: 'https://x.atlassian.net', email: 'a@b.c', token: 't', project: 'My Demo Project' }); } finally { globalThis.fetch = real; console.log = log; }
  assert.equal(calls.length, b.epics.length + b.stories.length);
  assert.ok(calls.slice(0, b.epics.length).every((f) => f.issuetype.name === 'Epic'));
  assert.equal(calls[b.epics.length].parent.key, 'DEMO-1');
  assert.ok(calls.slice(b.epics.length).every((f) => f.issuetype.name === 'Story' && /^DEMO-[1-4]$/.test(f.parent.key)));
});

test('an unknown project name lists the keys that exist', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ values: [{ key: 'ABC', name: 'Alpha' }] }) });
  try { await assert.rejects(() => createAll(b, { site: 'https://x', email: 'a', token: 't', project: 'Nope' }), /ABC \(Alpha\)/); } finally { globalThis.fetch = real; }
});
