import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createRecruitingHandlers, decideProposal, RECRUITING_TOOL_DEFINITIONS } from '../connectors/_lib/server/recruiting.mjs';
import { describeAction } from '../src/approval.ts';

const data = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'examples/recruiting-workbench/data.json'), 'utf8'));
const ACTOR = 'manager@example.com';

function fake() {
  const calls = [];
  const rpc = async (fn, body) => {
    calls.push({ fn, body });
    if (fn === 'recruiting_snapshot') return structuredClone(data);
    if (fn === 'recruiting_proposal_create') return { id: 1, status: 'proposed', created: true };
    if (fn === 'recruiting_proposals_list') return [];
    if (fn === 'recruiting_proposal_decide') return { id: body.p_id, status: body.p_decision };
    throw new Error(`unexpected ${fn}`);
  };
  return { calls, h: createRecruitingHandlers(rpc) };
}

test('recruiting tools: four tools, three read, one proposal writer, no decide or reject tool', () => {
  const names = RECRUITING_TOOL_DEFINITIONS.map((t) => t.name);
  assert.deepEqual(names, ['recruiting_get_pipeline', 'recruiting_get_shortlist', 'recruiting_list_proposals', 'recruiting_create_proposal']);
  assert.ok(!names.some((n) => /decide|reject|release|decline/.test(n)));
});

test('recruiting tools need an e-mail identity and a configured database', async () => {
  const { h } = fake();
  await assert.rejects(() => h.recruiting_get_pipeline({}), /actor/);
  const none = createRecruitingHandlers(null);
  await assert.rejects(() => none.recruiting_get_pipeline({ actor: ACTOR }), /not set up/);
});

test('recruiting_get_pipeline reports the same statuses as the Space', async () => {
  const { h, calls } = fake();
  const out = await h.recruiting_get_pipeline({ actor: ACTOR });
  assert.equal(calls[0].body.p_with_cv, false, 'the pipeline never asks for CV text');
  assert.deepEqual(Object.fromEntries(out.requisitions.map((r) => [r.id, r.status])), {
    'REQ-2201': 'late', 'REQ-2202': 'offer', 'REQ-2203': 'offer', 'REQ-2204': 'late', 'REQ-2205': 'watch', 'REQ-2206': 'ok',
  });
  assert.equal(out.candidatesPastTarget, 10);
});

test('recruiting_get_shortlist groups by criteria, with proof, and holds no personal fields', async () => {
  const { h } = fake();
  const out = await h.recruiting_get_shortlist({ actor: ACTOR, requisition: 'REQ-2201' });
  assert.deepEqual(out.candidates.filter((c) => c.group === 'A').map((c) => c.candidate), ['C-4101', 'C-4102']);
  assert.ok(out.candidates.find((c) => c.candidate === 'C-4106').group === 'C');
  assert.ok(out.candidates[0].criteria.every((c) => c.evidence));
  assert.match(JSON.stringify(out), /orderRule/);
  assert.doesNotMatch(JSON.stringify(out), /@|\bphone\b/i);
  await assert.rejects(() => h.recruiting_get_shortlist({ actor: ACTOR, requisition: 'REQ-9999' }), /unknown requisition/);
  await assert.rejects(() => h.recruiting_get_shortlist({ actor: ACTOR, requisition: 'REQ-2202' }), /no criteria/);
});

test('recruiting_create_proposal writes only a proposal the criteria support, with system wording', async () => {
  const { h, calls } = fake();
  const L = (await import('../connectors/_lib/server/recruiting-logic.mjs')).makeLogic(data);
  const p = L.proposals()[0];
  const out = await h.recruiting_create_proposal({ actor: ACTOR, requisition: p.job, candidate: p.cand, kind: p.type });
  const w = calls.find((c) => c.fn === 'recruiting_proposal_create');
  assert.equal(w.body.p_body, p.text);
  assert.equal(w.body.p_tool, 'recruiting_create_proposal');
  assert.equal(out.status, 'proposed');
  // a candidate who does not meet the criteria gets no proposal, whatever the agent asks
  await assert.rejects(() => h.recruiting_create_proposal({ actor: ACTOR, requisition: 'REQ-2201', candidate: 'C-4106', kind: 'move' }), /does not meet the criteria/);
  await assert.rejects(() => h.recruiting_create_proposal({ actor: ACTOR, requisition: 'REQ-2201', candidate: 'C-4106', kind: 'reject' }), /kind must be/);
  await assert.rejects(() => h.recruiting_create_proposal({ actor: ACTOR, requisition: 'REQ-2201', candidate: 'not-an-id', kind: 'move' }), /pseudonym/);
});

test('recruiting_list_proposals validates its arguments', async () => {
  const { h } = fake();
  assert.deepEqual(await h.recruiting_list_proposals({ actor: ACTOR }), { count: 0, proposals: [] });
  await assert.rejects(() => h.recruiting_list_proposals({ actor: ACTOR, status: 'rejected' }), /status/);
  await assert.rejects(() => h.recruiting_list_proposals({ actor: ACTOR, limit: 0 }), /limit/);
});

test('decideProposal is a main-process function, not a tool, and checks its input', async () => {
  const { calls } = fake();
  const rpc = async (fn, body) => { calls.push({ fn, body }); return { ok: true }; };
  await decideProposal(rpc, ACTOR, 3, 'released', 'ok  ');
  assert.deepEqual(calls.at(-1), { fn: 'recruiting_proposal_decide', body: { p_actor: ACTOR, p_id: 3, p_decision: 'released', p_note: 'ok' } });
  await assert.rejects(() => decideProposal(rpc, ACTOR, 3, 'rejected'), /decision/);
  await assert.rejects(() => decideProposal(rpc, 'nobody', 3, 'declined'), /e-mail/);
});

test('the approval rules show reads as reads and the proposal writer as a change', () => {
  const risk = (t) => describeAction({ toolName: `werkbank-workspace__${t}`, rawInput: {} }).risk;
  for (const t of ['recruiting_get_pipeline', 'recruiting_get_shortlist', 'recruiting_list_proposals']) assert.equal(risk(t), 'reads', t);
  assert.equal(risk('recruiting_create_proposal'), 'changes');
});
