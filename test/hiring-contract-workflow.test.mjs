import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = join(import.meta.dirname, '..');
const wf = JSON.parse(readFileSync(join(ROOT, 'examples/n8n-workflows/12-hiring-contract-signature.json'), 'utf8'));
const migration = readFileSync(join(ROOT, 'supabase/migrations/20261108_033_hire_contracts.sql'), 'utf8');
const byName = (n) => wf.nodes.find((x) => x.name === n);
const plain = (v) => JSON.parse(JSON.stringify(v));
const run = async (name, items, ctx = {}) => {
  const js = byName(name).parameters.jsCode;
  return plain(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items, first: () => items[0] }, Date, Math, Number, String, Object, Array, Buffer, ...ctx })());
};
const wrap = (list) => list.map((json) => ({ json }));

test('the workflow is importable, every node is reachable from a trigger and it holds no credentials', () => {
  const names = wf.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, names.length);
  for (const n of wf.nodes) { assert.match(n.type, /^n8n-nodes-base\./); assert.equal(n.credentials, undefined, n.name); }
  const seen = new Set(wf.nodes.filter((n) => /(Trigger|webhook)$/.test(n.type)).map((n) => n.name));
  assert.deepEqual([...seen].sort(), ['Every 15 minutes', 'Run now', 'Signature webhook']);
  for (let grew = true; grew;) {
    grew = false;
    for (const [from, outputs] of Object.entries(wf.connections)) if (seen.has(from)) for (const o of outputs.main) for (const t of o) { assert.ok(names.includes(t.node), t.node); if (!seen.has(t.node)) { seen.add(t.node); grew = true; } }
  }
  for (const n of wf.nodes.filter((x) => !/stickyNote$/.test(x.type))) assert.ok(seen.has(n.name), `${n.name} is reachable`);
  assert.equal(wf.active, false);
  assert.equal(byName('Signature webhook').parameters.httpMethod, 'POST');
  for (const n of ['Send to the e-signature service', 'Send the message', 'Record the answer']) assert.equal(byName(n).onError, 'continueErrorOutput', n);
  assert.equal(wf.connections['Which step?'].main.length, 4, 'prepare, send, expire, tell (ask goes to tell)');
  assert.match(byName('Which step?').parameters.output, /ask: 3/);
});

test('the workflow only calls the contract functions: no decision, no request, no key, addresses from the environment', () => {
  const text = JSON.stringify(wf);
  const rpcs = [...new Set([...text.matchAll(/rpc\/([a-z_]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(rpcs, ['recruiting_hire_contract_due', 'recruiting_hire_contract_notice_record', 'recruiting_hire_contract_prepare', 'recruiting_hire_contract_result', 'recruiting_hire_contract_sent']);
  assert.doesNotMatch(text, /recruiting_hire_decide|recruiting_hire_request_create|recruiting_hire_notice_record|eyJ|sb_secret_/);
  for (const fn of rpcs) { assert.match(migration, new RegExp(`function public\\.${fn}\\(`)); assert.match(migration, new RegExp(`grant execute on function[\\s\\S]*public\\.${fn}\\([\\s\\S]*to service_role`)); }
  const params = {
    'Prepare the contract text': ['p_id'], 'Record: contract sent': ['p_id', 'p_provider', 'p_ref', 'p_valid_days'],
    'Record the answer': ['p_id', 'p_ref', 'p_result', 'p_signed_at', 'p_document', 'p_sha256', 'p_receipt'], 'Record the notice': ['p_id', 'p_to', 'p_channel'],
  };
  for (const [node, list] of Object.entries(params)) for (const p of list) { assert.ok(byName(node).parameters.jsonBody.includes(p), `${node} sends ${p}`); assert.match(migration, new RegExp(`${p} (bigint|text|integer|timestamptz|jsonb)`), `${p} is a real parameter`); }
  for (const n of wf.nodes.filter((x) => /httpRequest$/.test(x.type))) assert.match(n.parameters.url, /^=\{\{ \$env\.[A-Z_]+ \}\}/, `${n.name}: addresses come from the environment`);
});

test('the shipment to the e-signature service holds the text, its hash and the pseudonym, never a name or an address', async () => {
  const due = { kind: 'send', id: 12, requisition: 'REQ-2203', title: 'Supply Chain Analyst', dept: 'Planning', candidate: 'C-4204', startOn: '2027-01-04', body: 'EMPLOYMENT CONTRACT ...', bodySha256: 'a'.repeat(64), template: 'employment-v1' };
  const out = await run('Prepare the shipment', wrap([due]), { $env: { ESIGN_CALLBACK_URL: 'https://n8n.example/webhook/hiring-contract-signature' } });
  assert.deepEqual(out[0].json.payload, { reference: 'HIRE-12', candidate: 'C-4204', title: 'Supply Chain Analyst', document: 'EMPLOYMENT CONTRACT ...', sha256: 'a'.repeat(64), start_on: '2027-01-04', callback_url: 'https://n8n.example/webhook/hiring-contract-signature' });
  assert.doesNotMatch(JSON.stringify(out), /@/);
  const answer = await run('Read the service answer', wrap([{ envelope: 'ENV-7', reference: 'HIRE-12' }, { reference: 'HIRE-13' }, { envelope: 'X' }]), { $env: { ESIGN_PROVIDER: 'DocuSign' } });
  assert.deepEqual(answer, [{ json: { id: 12, envelope: 'ENV-7', provider: 'DocuSign' } }], 'an answer without envelope or reference is dropped, the contract stays prepared');
  assert.deepEqual(await run('Simulate sending', wrap([{ id: 5 }])), [{ json: { id: 5, envelope: 'SIM-5', provider: 'simulation' } }]);
});

test('the callback: only a sender with the token is accepted; the answer is mapped to the parameters of the database function', async () => {
  const env = { ESIGN_WEBHOOK_TOKEN: 'secret-token' };
  const hook = (body, token) => ({ json: { headers: token === undefined ? {} : { 'x-esign-token': token }, body } });
  const signed = { request: 'HIRE-12', envelope: 'ENV-7', event: 'signed', signed_at: '2026-12-01T10:00:00Z', document_base64: 'JVBERi0=', sha256: 'b'.repeat(64), method: 'qualified e-signature', reference: 'CERT-1', name: 'Jane Doe' };
  const [ok] = await run('Read the signature answer', [hook(signed, 'secret-token')], { $env: env });
  assert.deepEqual(ok.json, { authorised: true, p_id: 12, p_ref: 'ENV-7', p_result: 'signed', p_signed_at: '2026-12-01T10:00:00Z', p_document: 'JVBERi0=', p_sha256: 'b'.repeat(64), p_receipt: { method: 'qualified e-signature', reference: 'CERT-1' } });
  assert.ok(!JSON.stringify(ok).includes('Jane'), 'fields the database does not take are not passed on');
  for (const bad of [hook(signed, 'wrong'), hook(signed), hook(signed, '')]) assert.deepEqual((await run('Read the signature answer', [bad], { $env: env }))[0].json, { authorised: false, reason: 'sender not recognised' });
  assert.equal((await run('Read the signature answer', [hook(signed, '')], { $env: {} }))[0].json.authorised, false, 'no token configured: nobody is accepted');
  assert.equal((await run('Read the signature answer', [hook({ ...signed, event: 'approved' }, 'secret-token')], { $env: env }))[0].json.reason, 'answer not readable');
  assert.equal((await run('Read the signature answer', [hook({ ...signed, request: 'abc' }, 'secret-token')], { $env: env }))[0].json.reason, 'answer not readable');
  const [declined] = await run('Read the signature answer', [hook({ request: 'HIRE-3', envelope: 'E', event: 'declined' }, 'secret-token')], { $env: env });
  assert.deepEqual(declined.json, { authorised: true, p_id: 3, p_ref: 'E', p_result: 'declined', p_signed_at: null, p_document: null, p_sha256: null, p_receipt: {} });
  const route = byName('Accepted sender?').parameters.output;
  assert.match(route, /authorised \? 0 : 1/);
});

test('simulation: without a service the signed answer is built by the workflow itself and says so', async () => {
  const shipped = wrap([{ id: 12, payload: { document: 'EMPLOYMENT CONTRACT body' } }]);
  const $ = () => ({ all: () => shipped });
  const out = await run('Simulate the candidate signing', wrap([{ id: 12, status: 'sent', created: true }, { id: 99, status: 'sent', created: true }, { id: 12, status: 'sent', created: false }]), { $ });
  assert.equal(out.length, 1, 'only a freshly sent contract of this run is simulated');
  const a = out[0].json;
  assert.equal(a.simulated, true); assert.equal(a.envelope, 'SIM-12'); assert.equal(a.request, 'HIRE-12'); assert.equal(a.event, 'signed'); assert.equal(a.method, 'simulation');
  const text = Buffer.from(a.document_base64, 'base64').toString('utf8');
  assert.match(text, /^SIMULATED SIGNATURE - no e-signature service is connected\. Not a legal signature\./);
  assert.match(text, /EMPLOYMENT CONTRACT body/);
  const [mapped] = await run('Read the signature answer', wrap([a]), { $env: {} });
  assert.equal(mapped.json.authorised, true, 'the simulation needs no token');
  assert.equal(mapped.json.p_receipt.method, 'simulation');
  assert.match(byName('Service connected?').parameters.output, /ESIGN_SEND_URL \? 0 : 1/);
  assert.match(byName('Simulation?').parameters.output, /ESIGN_SEND_URL \? 1 : 0/);
});

test('expiry and messages: the database named the contract and the recipient, the workflow words it', async () => {
  const [exp] = await run('Read the expiry', wrap([{ kind: 'expire', id: 4, envelope: 'ENV-4', provider: 'x', expiresAt: '2026-12-01T00:00:00Z' }]));
  assert.deepEqual(exp.json, { authorised: true, p_id: 4, p_ref: 'ENV-4', p_result: 'expired', p_signed_at: null, p_document: null, p_sha256: null, p_receipt: {} });
  const base = { kind: 'tell', id: 4, to: 'hr@x.com', role: 'hr', requisition: 'REQ-2203', title: 'Supply Chain Analyst', dept: 'Planning', candidate: 'C-4204' };
  const msgs = await run('Write the message', wrap(['signed', 'declined', 'expired'].map((outcome) => ({ ...base, outcome }))));
  assert.match(msgs[0].json.text, /C-4204 for Supply Chain Analyst \(REQ-2203, Planning\) is signed/);
  assert.match(msgs[1].json.text, /declined the contract.*not a new approval/);
  assert.match(msgs[2].json.text, /expired without a signature/);
  assert.ok(msgs.every((m) => Object.keys(m.json).sort().join() === 'id,text,to' && m.json.to === 'hr@x.com'));
  const [asked] = await run('Write the message', wrap([{ ...base, kind: 'ask' }]));
  assert.match(asked.json.text, /ready for your release.*nothing is sent to the candidate before that/);
  assert.equal(asked.json.to, 'hr@x.com');
  assert.deepEqual(await run('Write the message', []), []);
  const failed = await run('Not sent', wrap([{ error: { message: 'timeout' } }]));
  assert.deepEqual(failed[0].json, { failed: 1, items: ['timeout'] });
  assert.equal((await run('Answer refused', wrap([{ error: { message: 'this answer names another envelope than the one the contract was sent in' } }])))[0].json.accepted, false);
});
