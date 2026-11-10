import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkTriggers, evaluateTriggers, lexicalChoose } from '../shared/skill-triggers.mjs';
import { loadSkills, modelChoose, report } from '../scripts/skill-trigger-eval.mjs';
import { installExampleSkills } from '../scripts/install-example-skills.mjs';
import { publishSkills } from '../scripts/skills-registry.mjs';

const ok = { should: ['Bitte den Vertrag prüfen', 'Check the contract terms'], shouldNot: ['Wer bekommt den Lead?', 'Show the pipeline'] };

test('checkTriggers wants at least two good, distinct examples per list', () => {
  assert.deepEqual(checkTriggers(ok), []);
  assert.deepEqual(checkTriggers({ ...ok, shouldNotLive: ['A near miss only a model can judge'] }), []);
  assert.match(checkTriggers({ should: ['only one example here'], shouldNot: ok.shouldNot }).join(' '), /at least 2/);
  assert.match(checkTriggers({ should: ['short', 'tiny one'], shouldNot: ok.shouldNot }).join(' '), /sentence of 8/);
  assert.match(checkTriggers({ should: [ok.should[0], ok.should[0].toUpperCase()], shouldNot: ok.shouldNot }).join(' '), /twice/);
  assert.match(checkTriggers({ should: ok.should }).join(' '), /shouldNot/);
  assert.equal(checkTriggers([]).length, 1);
});

test('every bundled skill has valid trigger examples', () => {
  const skills = loadSkills();
  assert.ok(skills.length >= 27);
  assert.deepEqual(skills.filter((s) => !s.triggers).map((s) => s.name), [], 'skills without triggers.json');
});

test('offline trigger test: each bundled skill is picked for its own requests and not for its near misses', async () => {
  const out = await evaluateTriggers(loadSkills(), lexicalChoose);
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.failures.map((f) => `${f.skill}: ${f.prompt} -> ${f.picked}`), []);
});

test('the test really fails when two descriptions overlap or a description lacks the words people use', async () => {
  const twins = [
    { name: 'invoice-check', description: 'Checks an invoice against the purchase order and lists differences.', triggers: { should: ['Check this invoice against the purchase order', 'Compare the invoice with the order'], shouldNot: ['Create a board briefing', 'Route the lead'] } },
    { name: 'invoice-review', description: 'Checks an invoice against the purchase order and lists differences in amount.', triggers: { should: ['Review the invoice against the purchase order', 'Differences of the invoice and order'], shouldNot: ['Create a board briefing', 'Route the lead'] } },
  ];
  const out = await evaluateTriggers(twins, lexicalChoose);
  assert.ok(out.failures.length > 0, 'overlapping skills are caught');
  const vague = [{ name: 'helper', description: 'Helps with things.', triggers: { should: ['Reconcile the intercompany balances', 'Close the books for March'], shouldNot: ['Hello there friend', 'Tell me a joke today'] } }];
  const v = await evaluateTriggers(vague, lexicalChoose);
  assert.equal(v.failures.filter((f) => f.expect === 'pick').length, 2, 'a description without the real words is never picked');
});

test('shouldNotLive cases run only in live mode', async () => {
  const skills = [{ name: 'a-skill', description: 'Documents a report.', triggers: { should: ['Document this report please', 'Please document the report'], shouldNot: ['Tell me a joke today', 'Hello there friend'], shouldNotLive: ['Write a new report for me'] } }];
  const offline = await evaluateTriggers(skills, () => 'a-skill', { live: false });
  const live = await evaluateTriggers(skills, () => 'a-skill', { live: true });
  assert.equal(offline.results[0].cases.length, 4);
  assert.equal(live.results[0].cases.length, 5);
  assert.equal(live.failures.length, 3, 'all three "should not" cases fail when the chooser always picks the skill');
  assert.equal(offline.failures.length, 2, 'offline the live-only case is not run');
});

test('the model chooser sends only names and descriptions and maps the answer to a skill name or none', async () => {
  const calls = [];
  const answers = ['contract-checker', '`pricing-guard`.', 'none', 'invented-name'];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), headers: init.headers }); return new Response(JSON.stringify({ content: [{ text: answers.shift() }] })); };
  const choose = modelChoose({ apiKey: 'test-key', fetchImpl });
  const skills = [{ name: 'contract-checker', description: 'Checks contracts.' }, { name: 'pricing-guard', description: 'Checks discounts.' }];
  assert.equal(await choose('Prüfe den Vertrag', skills), 'contract-checker');
  assert.equal(await choose('Rabatt prüfen', skills), 'pricing-guard');
  assert.equal(await choose('Wetter?', skills), null);
  assert.equal(await choose('Etwas', skills), null, 'an unknown name counts as none');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].headers['x-api-key'], 'test-key');
  assert.match(calls[0].body.messages[0].content, /contract-checker: Checks contracts\./);
  assert.doesNotMatch(JSON.stringify(calls[0].body), /Instructions|SKILL\.md/);
  await assert.rejects(modelChoose({ apiKey: 'k', fetchImpl: async () => new Response('no', { status: 500 }) })('x', skills), /500/);
});

test('report names the failing request and the skill without triggers', async () => {
  const text = report(await evaluateTriggers([{ name: 'a-skill', description: 'Documents reports.', triggers: { should: ['Hello there friend', 'Tell me a joke today'], shouldNot: ['Hello again my friend', 'Another harmless request'] } }, { name: 'b-skill', description: 'Other.' }], () => null));
  assert.match(text, /FAIL\s+a-skill/);
  assert.match(text, /should pick it, but got none: “Hello there friend”/);
  assert.match(text, /MISSING\s+b-skill/);
});

test('installing the example skills copies triggers.json, and publishing refuses a malformed one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trig-'));
  installExampleSkills({ skillsDir: join(dir, 'skills') });
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync(join(dir, 'skills/contract-checker/triggers.json')));
  const bad = join(dir, 'bad', 'contract-checker');
  mkdirSync(bad, { recursive: true });
  cpSync(join(dir, 'skills/contract-checker/SKILL.md'), join(bad, 'SKILL.md'));
  writeFileSync(join(bad, 'triggers.json'), JSON.stringify({ should: ['only one example'], shouldNot: [] }));
  await assert.rejects(publishSkills({ url: 'http://x', key: 'k', dirs: [bad], fetchImpl: async () => new Response('[]') }), /triggers\.json/);
});
