import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { countPostings, openChannels, postingError, readPostings, sortPostings } from '../src/hiring-postings.ts';
import { createWorkStore } from '../electron/work-store.mjs';

const ROOT = join(import.meta.dirname, '..');
const row = (id, status, extra = {}) => ({ id, requisition: 'REQ-2203', title: `T${id} (m/f/d)`, status, sections: [{ key: 'title', label: 'Job title', text: 'x', locked: false }], createdBy: 'a@b.de', updatedAt: `2026-11-0${id}T10:00:00Z`, releasedBy: null, releasedAt: null, publications: [], ...extra });

test('rows are read strictly, bad rows are dropped, never repaired', () => {
  const { postings, channels } = readPostings({ postings: [row(1, 'draft'), { id: 'x' }, row(2, 'bogus'), null, row(3, 'released')], channels: [{ id: 'xing', name: 'Xing', limit: 6000 }, { name: 'no id' }] });
  assert.deepEqual(postings.map((p) => p.id), [1, 3]);
  assert.deepEqual(channels, [{ id: 'xing', name: 'Xing', limit: 6000 }]);
  assert.deepEqual(readPostings(null), { postings: [], channels: [] });
});

test('waiting postings come first, counts add up, finished channels are not offered again', () => {
  const list = [row(1, 'draft'), row(2, 'released', { publications: [{ channel: 'xing', mode: 'mock', status: 'simulated', at: '' }] }), row(3, 'in_review'), row(4, 'withdrawn')];
  assert.deepEqual(sortPostings(readPostings({ postings: list }).postings).map((p) => p.status), ['in_review', 'released', 'draft', 'withdrawn']);
  assert.deepEqual(countPostings(readPostings({ postings: list }).postings), { draft: 1, in_review: 1, released: 1, withdrawn: 1 });
  const p = readPostings({ postings: list }).postings.find((x) => x.id === 2);
  assert.deepEqual(openChannels(p, [{ id: 'xing', name: 'Xing', limit: 1 }, { id: 'linkedin', name: 'LinkedIn', limit: 1 }]).map((c) => c.id), ['linkedin']);
});

test('database messages are shown in plain words', () => {
  assert.match(postingError('only the hiring manager of this requisition can release a posting'), /Only the hiring manager/);
  assert.match(postingError('"Pay range" still has an empty field'), /needs a change first/);
});

test('the steps run only as the stored e-mail, only the three steps exist, and nothing is a tool', async () => {
  const calls = [];
  const store = createWorkStore({ file: '/nonexistent/x.json', defaultEmail: 'mgr@x.de', readConnector: () => ({ url: 'https://x.supabase.co', key: 'k' }) });
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await store.postingStep('release', 5, 'ok');
    await store.postingStep('send_back', 5, 'more detail');
    await store.postingStep('withdraw', 5, 'role filled');
    await assert.rejects(() => store.postingStep('delete', 5, ''), /not allowed/);
    assert.deepEqual(calls.map((c) => c.url.split('/rpc/')[1]), ['recruiting_posting_release', 'recruiting_posting_send_back', 'recruiting_posting_withdraw']);
    assert.ok(calls.every((c) => c.body.p_actor === 'mgr@x.de'));
  } finally { globalThis.fetch = orig; }
});

test('the wiring: three IPC channels, three preload entries, the view and no agent tool', () => {
  const main = readFileSync(join(ROOT, 'electron/main.mjs'), 'utf8');
  for (const c of ['recruiting-postings', 'recruiting-posting-step', 'recruiting-posting-publish']) assert.ok(main.includes(`'${c}'`), c);
  const pre = readFileSync(join(ROOT, 'electron/preload.cjs'), 'utf8');
  for (const c of ['recruitingPostings', 'recruitingPostingStep', 'recruitingPostingPublish']) assert.ok(pre.includes(c), c);
  assert.match(readFileSync(join(ROOT, 'src/ui/HiringApprovals.tsx'), 'utf8'), /HiringPostings/);
  const names = JSON.parse(readFileSync(join(ROOT, 'connectors/werkbank-workspace/manifest.json'), 'utf8')).tools.map((t) => t.name);
  assert.equal(names.some((n) => /posting_(release|publish|withdraw|send_back)/.test(n)), false, 'no release, publish or withdraw tool');
});
