import test from 'node:test';
import assert from 'node:assert/strict';
import { copyTitle, copySlug, renameSkillMd, retitleSpaceJson } from '../shared/duplicate.mjs';

test('copyTitle counts up and never nests', () => {
  assert.equal(copyTitle('Report'), 'Report copy');
  assert.equal(copyTitle('Report', ['Report copy']), 'Report copy 2');
  assert.equal(copyTitle('Report copy', ['Report copy', 'Report']), 'Report copy 2');
  assert.equal(copyTitle('Report copy 2', ['Report copy', 'Report copy 2']), 'Report copy 3');
});
test('copySlug is valid, unique and at most 64 characters', () => {
  assert.equal(copySlug('my-skill'), 'my-skill-copy');
  assert.equal(copySlug('my-skill', ['my-skill-copy']), 'my-skill-copy-2');
  assert.equal(copySlug('my-skill-copy', ['my-skill-copy']), 'my-skill-copy-2');
  const long = copySlug('a'.repeat(64), ['a'.repeat(64)]);
  assert.ok(long.length <= 64 && long.endsWith('-copy'));
  assert.match(long, /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/);
});
test('renameSkillMd changes only the name', () => {
  const md = '---\nname: a\ndescription: Does x\n---\n# Body\nname: keep';
  assert.equal(renameSkillMd(md, 'a-copy'), '---\nname: a-copy\ndescription: Does x\n---\n# Body\nname: keep');
  assert.ok(renameSkillMd('# no front matter', 'b').startsWith('---\nname: b\n---'));
});
test('retitleSpaceJson keeps other fields', () => {
  const out = JSON.parse(retitleSpaceJson('{"title":"A","domain":"Finance"}', 'A copy'));
  assert.deepEqual(out, { title: 'A copy', domain: 'Finance' });
  assert.deepEqual(JSON.parse(retitleSpaceJson('nonsense', 'X')), { title: 'X' });
});
