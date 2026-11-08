import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as M from '../connectors/_lib/server/job-postings.mjs';
import { makeLogic } from '../connectors/_lib/server/recruiting-logic.mjs';

const ROOT = join(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(join(ROOT, 'examples/recruiting-workbench/data.json'), 'utf8'));
const templates = data.posting.templates.map((t, i) => ({ ...t, id: i + 1, kind: t.kind || 'saved', shared: true, uses: 0, lastUsed: null }));
const context = { company: data.company, applyBase: data.posting.apply, channels: data.posting.channels, templates };
const std = templates.find((t) => t.kind === 'standard');

const fake = (stored = []) => {
  const calls = [];
  const rpc = async (fn, body) => {
    calls.push({ fn, body });
    if (fn === 'recruiting_posting_context') return context;
    if (fn === 'recruiting_snapshot') return data;
    if (fn === 'recruiting_posting_create') { stored.push({ id: 7, status: 'draft', requisition: body.p_requisition, template: body.p_template, sections: body.p_sections }); return { id: 7, status: 'draft' }; }
    if (fn === 'recruiting_postings_list') return stored;
    return { ok: true };
  };
  return { calls, rpc, stored };
};

test('the agent can draft, edit, preview and send for review, but there is no release, publish or withdraw tool', () => {
  const names = M.POSTING_TOOL_DEFINITIONS.map((t) => t.name);
  assert.equal(names.length, 7);
  assert.ok(names.every((n) => n.startsWith('recruiting_')));
  assert.ok(!names.some((n) => /release|publish|withdraw|delete|send_back/.test(n)));
  const h = M.createPostingHandlers(null);
  assert.deepEqual(Object.keys(h).sort(), [...names].sort());
});

test('a draft fills the requisition fields, keeps the locked sections and never invents role or pay', async () => {
  const f = fake();
  const job = data.jobs[0].id;
  const out = await M.createPostingHandlers(f.rpc).recruiting_draft_job_posting({ actor: 'Anna@Example.com', requisition: job });
  assert.equal(out.status, 'draft');
  const create = f.calls.find((c) => c.fn === 'recruiting_posting_create');
  assert.equal(create.body.p_actor, 'anna@example.com');
  assert.equal(create.body.p_template, std.id);
  assert.equal(out.readyForReview, false, 'no role text: the check blocks');
  assert.ok(out.check.some((c) => c.level === 'error' && /role/i.test(c.section + c.message)));
  const locked = std.sections.filter((s) => s.locked);
  assert.ok(locked.length);
  for (const s of locked) assert.equal(out.sections.find((x) => x.key === s.key).text, s.text.replace(/\{\{company\}\}/g, data.company.replace(' (fictional)', '')));
  assert.ok(!out.sections.some((s) => /\d\s?€|EUR/.test(s.text) && s.key === 'pay'));
});

test('a draft with a role from the hiring manager has no errors; unknown requisition and template are refused', async () => {
  const f = fake();
  const h = M.createPostingHandlers(f.rpc);
  const out = await h.recruiting_draft_job_posting({ actor: 'a@b.co', requisition: data.jobs[0].id, role: 'You plan and steer our regional freight network.', pay: '60,000 to 75,000 EUR' });
  assert.ok(!out.check.some((c) => c.level === 'error'), JSON.stringify(out.check));
  await assert.rejects(h.recruiting_draft_job_posting({ actor: 'a@b.co', requisition: 'REQ-0000' }), /unknown requisition/);
  await assert.rejects(h.recruiting_draft_job_posting({ actor: 'a@b.co', requisition: data.jobs[0].id, template: 999 }), /unknown template/);
  await assert.rejects(h.recruiting_draft_job_posting({ actor: 'a@b.co', requisition: 'x y' }), /requisition/);
});

test('update refuses locked sections, unknown sections and non-drafts', async () => {
  const f = fake();
  const h = M.createPostingHandlers(f.rpc);
  await h.recruiting_draft_job_posting({ actor: 'a@b.co', requisition: data.jobs[0].id });
  const lockedKey = std.sections.find((s) => s.locked).key;
  await assert.rejects(h.recruiting_update_job_posting({ actor: 'a@b.co', posting: 7, sections: [{ key: lockedKey, text: 'x' }] }), /locked/);
  await assert.rejects(h.recruiting_update_job_posting({ actor: 'a@b.co', posting: 7, sections: [{ key: 'nope', text: 'x' }] }), /no section/);
  const ok = await h.recruiting_update_job_posting({ actor: 'a@b.co', posting: 7, sections: [{ key: 'role', text: 'You steer the freight network.' }] });
  assert.equal(ok.status, 'draft');
  f.stored[0].status = 'released';
  await assert.rejects(h.recruiting_update_job_posting({ actor: 'a@b.co', posting: 7, sections: [{ key: 'role', text: 'y' }] }), /only a draft/);
});

test('saving a template adds the locked company sections and the call names the actor', async () => {
  const f = fake();
  await M.createPostingHandlers(f.rpc).recruiting_save_posting_template({ actor: 'a@b.co', name: ' My ops template ', sections: [{ key: 'title', text: '{{title}} (m/f/d)' }, { key: 'role', text: '{{role}}' }] });
  const b = f.calls.find((c) => c.fn === 'recruiting_posting_template_save').body;
  assert.equal(b.p_name, 'My ops template');
  assert.equal(b.p_shared, false);
  for (const s of std.sections.filter((x) => x.locked)) assert.ok(b.p_sections.some((x) => x.key === s.key && x.locked && x.text === s.text));
});

test('preview gives one package per channel within its limit and counts the source', async () => {
  const f = fake();
  const h = M.createPostingHandlers(f.rpc);
  await h.recruiting_draft_job_posting({ actor: 'a@b.co', requisition: data.jobs[0].id, role: 'Short role text.' });
  const out = await h.recruiting_preview_posting_channels({ actor: 'a@b.co', posting: 7 });
  assert.equal(out.channels.length, data.posting.channels.length);
  for (const c of out.channels) { assert.ok(c.link.includes('src='), c.channel); assert.equal(c.fits, c.length <= c.limit); }
});

test('the main-process writers call the database with the actor and publish builds the lengths itself', async () => {
  const f = fake();
  const job = data.jobs[0].id;
  await M.createPostingHandlers(f.rpc).recruiting_draft_job_posting({ actor: 'a@b.co', requisition: job, role: 'Short role text.' });
  await M.releasePosting(f.rpc, 'Boss@X.com', 7, 'ok');
  assert.deepEqual(f.calls.at(-1), { fn: 'recruiting_posting_release', body: { p_actor: 'boss@x.com', p_id: 7, p_note: 'ok' } });
  await M.publishPostingMock(f.rpc, 'boss@x.com', 7, ['sap-portal', data.posting.channels[1].id]);
  const pub = f.calls.at(-1);
  assert.equal(pub.fn, 'recruiting_posting_publish');
  const L = makeLogic({ ...data, company: context.company, posting: { templates, channels: context.channels, apply: context.applyBase, briefs: {} } });
  const want = L.channelPackage({ sections: f.stored[0].sections }, context.channels[0], job).length;
  assert.equal(pub.body.p_packages[0].chars, want);
  await assert.rejects(M.publishPostingMock(f.rpc, 'boss@x.com', 7, ['nope']), /unknown channel/);
  await assert.rejects(M.publishPostingMock(f.rpc, 'boss@x.com', 7, []), /at least one/);
  await assert.rejects(M.releasePosting(f.rpc, 'b@x.com', 0), /whole number/);
});

test('without a database every tool says what to set up', async () => {
  await assert.rejects(M.createPostingHandlers(null).recruiting_list_posting_templates({ actor: 'a@b.co' }), /not set up/);
});
