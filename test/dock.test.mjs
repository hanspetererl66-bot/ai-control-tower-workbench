import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../src/dock.ts';
import * as p from '../src/agent-project.ts';

test('yes, confirm is a command, other text is not', () => {
  for (const t of ['yes', 'Yes, confirm', 'confirm', 'Ja', 'passt']) assert.ok(d.isConfirmCommand(t), t);
  for (const t of ['yes but add risks', 'confirm the budget section is wrong', '']) assert.ok(!d.isConfirmCommand(t), t);
});
test('the last markdown block is the proposal', () => {
  const reply = 'Here:\n```markdown\n# A\nfirst version of the text here\n```\nand\n```md\n# B\nsecond version of the text here\n```';
  assert.equal(d.extractDocument(reply), '# B\nsecond version of the text here');
  assert.equal(d.extractDocument('no block'), null);
  assert.equal(d.extractDocument('```js\nconsole.log(1)\n```'), null);
});
test('document note carries the text and the rule', () => {
  let proj = p.newProject('Check renewals', 1);
  proj = { ...proj, docs: { prd: '# PRD\nhello' } };
  const n = d.documentNote(proj, 'prd');
  assert.match(n, /DOCUMENT ON SCREEN/);
  assert.match(n, /# PRD\nhello/);
  assert.match(n, /COMPLETE updated document/);
});
