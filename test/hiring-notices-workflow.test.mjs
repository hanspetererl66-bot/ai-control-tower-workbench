import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = join(import.meta.dirname, '..');
const wf = JSON.parse(readFileSync(join(ROOT, 'examples/n8n-workflows/11-hiring-approval-notices.json'), 'utf8'));
const migration = readFileSync(join(ROOT, 'supabase/migrations/20261107_032_hire_notices.sql'), 'utf8');
const byName = (n) => wf.nodes.find((x) => x.name === n);
const run = async (name, items, ctx = {}) => {
  const js = byName(name).parameters.jsCode;
  return [...(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items }, Date, Math, Number, ...ctx })())];
};

test('the workflow is importable, reachable from a trigger and holds no credentials', () => {
  const names = wf.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, names.length);
  for (const n of wf.nodes) { assert.match(n.type, /^n8n-nodes-base\./); assert.equal(n.credentials, undefined, n.name); }
  const seen = new Set(wf.nodes.filter((n) => /Trigger$/.test(n.type)).map((n) => n.name));
  assert.deepEqual([...seen].sort(), ['Every 15 minutes', 'Run now']);
  for (let grew = true; grew;) {
    grew = false;
    for (const [from, outputs] of Object.entries(wf.connections)) if (seen.has(from)) for (const o of outputs.main) for (const t of o) { assert.ok(names.includes(t.node)); if (!seen.has(t.node)) { seen.add(t.node); grew = true; } }
  }
  for (const n of wf.nodes.filter((x) => !/stickyNote$/.test(x.type))) assert.ok(seen.has(n.name), `${n.name} is reachable`);
  assert.equal(byName('Send the message').onError, 'continueErrorOutput');
  assert.equal(wf.connections['Send the message'].main.length, 2, 'a failed send goes to its own branch and is not recorded');
  assert.equal(wf.connections['Send the message'].main[0][0].node, 'Record the notice');
  assert.equal(wf.active, false);
});

test('the workflow can only read what is due and record a notice: it never calls a decision function and holds no key', () => {
  const text = JSON.stringify(wf);
  const rpcs = [...text.matchAll(/rpc\/([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(rpcs)].sort(), ['recruiting_hire_due', 'recruiting_hire_notice_record']);
  assert.doesNotMatch(text, /recruiting_hire_decide|recruiting_hire_request_create|eyJ|sb_secret_/);
  for (const fn of ['recruiting_hire_due', 'recruiting_hire_notice_record']) assert.match(migration, new RegExp(`function public\\.${fn}\\(`));
  // the body keys are real parameter names of the functions
  const due = byName('What is due?').parameters.jsonBody;
  for (const p of ['p_remind_days', 'p_escalate_days']) { assert.ok(due.includes(p)); assert.match(migration, new RegExp(`${p} integer`)); }
  const rec = byName('Record the notice').parameters.jsonBody;
  for (const p of ['p_id', 'p_kind', 'p_to', 'p_channel']) { assert.ok(rec.includes(p)); assert.match(migration, new RegExp(`${p} (bigint|text)`)); }
  assert.match(migration, /grant execute on function public\.recruiting_hire_due[\s\S]*to service_role/);
  for (const n of wf.nodes.filter((x) => /httpRequest$/.test(x.type))) assert.match(n.parameters.url, /^=\{\{ \$env\.[A-Z_]+ \}\}/, `${n.name}: addresses come from the environment`);
});

test('messages: one per due item, worded by kind, with the pseudonym only and the recipient the database named', async () => {
  const base = { id: 7, to: 'hr@x.com', role: 'hr', step: 2, steps: 3, requisition: 'REQ-2203', title: 'Supply Chain Analyst', dept: 'Planning', candidate: 'C-4204', since: new Date(Date.now() - 3 * 864e5).toISOString(), approver: 'hr@x.com' };
  const items = ['notify', 'remind', 'escalate'].map((kind) => ({ json: { ...base, kind } }))
    .concat({ json: { ...base, kind: 'inform', status: 'approved', role: 'hiring_manager' } }, { json: { ...base, kind: 'inform', status: 'declined' } });
  const out = await run('Write the message', items);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((o) => o.json.kind), ['notify', 'remind', 'escalate', 'inform', 'inform']);
  assert.ok(out.every((o) => o.json.to === 'hr@x.com' && o.json.id === 7));
  assert.match(out[0].json.text, /waiting for you: C-4204 for Supply Chain Analyst \(REQ-2203, Planning\)\. Your turn: step 2 of 3, HR/);
  assert.match(out[1].json.text, /waited 3 days/);
  assert.match(out[2].json.text, /open 3 days at step 2 of 3, HR \(hr@x\.com\)/);
  assert.match(out[3].json.text, /approved.*chain is complete/);
  assert.match(out[4].json.text, /declined.*a changed request is a new request/);
  assert.ok(out.every((o) => Object.keys(o.json).sort().join() === 'id,kind,text,to'), 'nothing else is passed on');
  assert.deepEqual(await run('Write the message', []), [], 'nothing due, nothing sent');
});

test('the run report counts recorded notices and the failure branch lists what was not sent', async () => {
  const rep = await run('Run report', [{ json: { created: true } }, { json: { created: false } }, { json: { created: true } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(rep[0].json)), { recorded: 2, alreadyRecorded: 1 });
  const $ = () => ({ item: { json: { id: 9, kind: 'remind' } } });
  const fail = await run('Not sent', [{ json: { error: { message: 'timeout' } } }], { $ });
  assert.deepEqual(JSON.parse(JSON.stringify(fail[0].json)), { failed: 1, items: [{ id: 9, kind: 'remind', error: 'timeout' }] });
});
