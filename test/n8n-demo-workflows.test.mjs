import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const dir = join(import.meta.dirname, '..', 'examples/n8n-workflows');
const load = (file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const FILES = ['01-simple-contract-notice-check.json', '02-complex-communication-digest.json', '03-sales-pipeline-digest.json'];

for (const file of FILES) {
  test(`${file} is a valid importable n8n workflow without credentials`, () => {
    const wf = load(file);
    assert.ok(wf.name && Array.isArray(wf.nodes) && wf.connections && wf.settings);
    const names = wf.nodes.map((n) => n.name);
    assert.equal(new Set(names).size, names.length, 'unique node names');
    assert.equal(new Set(wf.nodes.map((n) => n.id)).size, names.length, 'unique node ids');
    for (const n of wf.nodes) {
      assert.match(n.type, /^n8n-nodes-base\./);
      assert.ok(Number.isFinite(n.typeVersion) && n.position.length === 2, n.name);
      assert.equal(n.credentials, undefined, `${n.name} needs no credentials`);
    }
    for (const [from, outputs] of Object.entries(wf.connections)) {
      assert.ok(names.includes(from), from);
      for (const output of outputs.main) for (const t of output) assert.ok(names.includes(t.node), `${from} -> ${t.node}`);
    }
    // every non-note node is reachable from a trigger
    const triggers = wf.nodes.filter((n) => /Trigger$/.test(n.type)).map((n) => n.name);
    assert.ok(triggers.length > 0);
    const seen = new Set(triggers);
    for (let grew = true; grew;) {
      grew = false;
      for (const [from, outputs] of Object.entries(wf.connections)) if (seen.has(from)) for (const o of outputs.main) for (const t of o) if (!seen.has(t.node)) { seen.add(t.node); grew = true; }
    }
    for (const n of wf.nodes.filter((x) => !/stickyNote$/.test(x.type))) assert.ok(seen.has(n.name), `${n.name} is reachable`);
    assert.doesNotMatch(JSON.stringify(wf), /\b(fetch|require)\(|httpRequest|child_process/);
  });
}

test('simple workflow: the notice deadline logic gives the expected alerts', async () => {
  const wf = load(FILES[0]);
  const js = wf.nodes.find((n) => n.name === 'Sample contracts').parameters.jsCode;
  const items = [...(await vm.runInNewContext(`(async()=>{${js}})`)())];
  const days = Object.fromEntries(items.map(({ json: c }) => [c.id, Math.round((Date.parse(c.end) - c.noticeDays * 864e5 - Date.parse(c.asOf)) / 864e5)]));
  assert.deepEqual(days, { 'C-2023-0390': 14, 'C-2025-0041': -17, 'C-2026-0012': 13, 'C-2024-0233': 73, 'C-2024-0187': 624 });
});

test('complex workflow: guardrail quarantines the injected mail, target and overdue checks, digest', async () => {
  const wf = load(FILES[1]);
  const run = async (name, items) => {
    const js = wf.nodes.find((n) => n.name === name).parameters.jsCode;
    return [...(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items } })())];
  };
  const data = await run('Sample data', []);
  const mails = data.filter((i) => i.json.kind === 'mail');
  const actions = data.filter((i) => i.json.kind === 'action');
  const guarded = await run('Guardrail: untrusted mail text', mails);
  const flagged = guarded.filter((i) => i.json.flagged);
  assert.deepEqual(flagged.map((i) => i.json.id), ['T-104']);
  assert.equal(flagged[0].json.body, '[withheld: untrusted content]', 'untrusted text is not passed on');
  assert.match(flagged[0].json.flagReason, /external-audit\.example/);
  const classified = await run('Classify and check target', guarded.filter((i) => !i.json.flagged));
  assert.deepEqual(classified.filter((i) => i.json.pastSla).map((i) => i.json.id), ['T-101', 'T-102']);
  assert.equal(classified.find((i) => i.json.id === 'T-103').json.intent, 'Escalation');
  const quarantined = flagged.map((i) => ({ json: { ...i.json, intent: 'Quarantined', attention: true } }));
  const prioritised = actions.map((i) => ({ json: { ...i.json, priority: i.json.status !== 'done' && i.json.due < '2026-10-19' ? 'overdue' : 'other' } }));
  const [digest] = await run('Build digest', [...quarantined, ...classified, ...prioritised]);
  assert.equal(digest.json.mails, 4);
  assert.equal(digest.json.overdue, 2);
  assert.equal(digest.json.quarantined, 1);
  assert.equal(digest.json.attention, true);
});

test('sales workflow: injected text is quarantined, scores are transparent, routes and digest add up', async () => {
  const wf = load(FILES[2]);
  const run = async (name, items) => {
    const js = wf.nodes.find((n) => n.name === name).parameters.jsCode;
    return [...(await vm.runInNewContext(`(async()=>{${js}})`, { $input: { all: () => items } })())];
  };
  const signals = await run('Sample signals', []);
  assert.equal(signals.length, 6);
  const guarded = await run('Guardrail: untrusted text', signals);
  const flagged = guarded.filter((i) => i.json.flagged);
  assert.deepEqual(flagged.map((i) => i.json.id), ['INT-206']);
  assert.equal(flagged[0].json.text, '[withheld: untrusted content]', 'untrusted text is not passed on');
  const scored = await run('Score lead', guarded.filter((i) => !i.json.flagged));
  for (const { json } of scored) assert.equal(json.score, Object.values(json.parts).reduce((a, b) => a + b, 0), `${json.id}: the score is the sum of its parts`);
  const score = Object.fromEntries(scored.map((i) => [i.json.id, i.json.score]));
  assert.ok(score['INT-203'] >= 70 && score['INT-204'] >= 70, 'Muster expansion and Nordwind are opportunities');
  assert.ok(score['INT-201'] >= 40 && score['INT-201'] < 70, 'Kranich is nurtured');
  assert.ok(score['INT-202'] < 40 && score['INT-205'] < 40, 'weak signals are only watched');
  const route = (r) => (r >= 70 ? 'Opportunity: plan it' : r >= 40 ? 'Nurture: ask two questions' : 'Watch: no time yet');
  const routed = scored.map((i) => ({ json: { ...i.json, route: route(i.json.score) } }));
  const quarantined = flagged.map((i) => ({ json: { ...i.json, route: 'Quarantined', score: 0 } }));
  const [digest] = await run('Build digest', [...routed, ...quarantined]);
  assert.equal(digest.json.total, 6);
  assert.equal(digest.json.opportunity + digest.json.nurture + digest.json.watch + digest.json.quarantined, 6);
  assert.equal(digest.json.quarantined, 1);
  assert.equal(digest.json.topAccount, 'Muster Industrie AG');
  assert.match(digest.json.digest, /nothing is sent/i);
  // the Switch thresholds in the workflow match the routes used here
  const rules = wf.nodes.find((n) => n.name === 'Route by score').parameters.rules.values;
  assert.deepEqual(rules.map((r) => [r.outputKey, r.conditions.conditions[0].operator.operation, r.conditions.conditions[0].rightValue]), [['opportunity', 'gte', 70], ['nurture', 'gte', 40], ['watch', 'lt', 40]]);
});
