import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpacePackage, packageFileName, parseSpacePackage, uniqueSlug } from '../shared/space-package.mjs';

const files = { 'index.html': '<html><body><div class="card">Hi</div></body></html>', 'space.json': JSON.stringify({ title: 'My Space' }) };

test('a Space survives export and import unchanged', () => {
  const text = JSON.stringify(buildSpacePackage({ slug: 'my-space', title: 'My Space', files }));
  const back = parseSpacePackage(text);
  assert.equal(back.slug, 'my-space');
  assert.equal(back.title, 'My Space');
  assert.deepEqual(back.files, files);
  assert.equal(packageFileName('my-space'), 'my-space.werkbank-space.json');
});

test('invalid or hostile packages are refused with a readable reason', () => {
  const ok = buildSpacePackage({ slug: 'a', title: 'A', files });
  const bad = (change) => JSON.stringify({ ...ok, ...change });
  assert.throws(() => parseSpacePackage('not json'), /not a Werkbank Space/);
  assert.throws(() => parseSpacePackage(bad({ format: 'other' })), /not a Werkbank Space/);
  assert.throws(() => parseSpacePackage(bad({ version: 99 })), /newer/);
  assert.throws(() => parseSpacePackage(bad({ slug: '../etc' })), /not valid/);
  assert.throws(() => parseSpacePackage(bad({ files: { 'index.html': '<p>x</p>', 'evil.js': 'x' } })), /Unexpected file/);
  assert.throws(() => parseSpacePackage(bad({ files: { 'index.html': '' } })), /no Space page/);
  assert.throws(() => parseSpacePackage(bad({ files: { 'index.html': '<script src="https://evil.example/x.js"></script>' } })), /internet/);
  assert.throws(() => parseSpacePackage(bad({ files: { 'index.html': '<iframe src="//evil.example"></iframe>' } })), /internet/);
  assert.throws(() => parseSpacePackage(bad({ files: { 'index.html': '<p>x</p>', 'space.json': '{broken' } })), /space.json/);
  assert.throws(() => parseSpacePackage('x'.repeat(5 * 1024 * 1024 + 1)), /too large/);
  assert.doesNotThrow(() => parseSpacePackage(bad({ files: { 'index.html': '<script>const a = 1</script><a href="https://sap.com">link</a>' } })), 'inline scripts and plain links are fine');
});

test('a taken name becomes a numbered copy', () => {
  assert.equal(uniqueSlug('sales', ['finance']), 'sales');
  assert.equal(uniqueSlug('sales', ['sales']), 'sales-2');
  assert.equal(uniqueSlug('sales', ['sales', 'sales-2']), 'sales-3');
});

test('every bundled example Space can be packaged and read back', async () => {
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  const root = new URL('../examples/', import.meta.url);
  for (const name of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const dir = new URL(`${name.name}/`, root);
    if (!existsSync(new URL('space.json', dir)) || !existsSync(new URL('index.html', dir))) continue;
    const pkg = buildSpacePackage({ slug: name.name, title: name.name, files: { 'index.html': readFileSync(new URL('index.html', dir), 'utf8'), 'space.json': readFileSync(new URL('space.json', dir), 'utf8') } });
    assert.doesNotThrow(() => parseSpacePackage(JSON.stringify(pkg)), name.name);
  }
});
