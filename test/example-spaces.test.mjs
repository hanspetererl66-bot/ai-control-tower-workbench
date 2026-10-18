import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EXAMPLE_SPACES, installExampleSpace } from '../scripts/install-example-space.mjs';
import { parseSpaceMetadata } from '../shared/space-metadata.mjs';

const ROOT = join(import.meta.dirname, '..');

for (const [name, slug] of Object.entries(EXAMPLE_SPACES)) {
  test(`example space "${name}" installs and is valid`, () => {
    const spacesDir = mkdtempSync(join(tmpdir(), 'werkbank-spaces-'));
    try {
      const dest = installExampleSpace(name, { root: ROOT, spacesDir });
      assert.equal(dest, join(spacesDir, slug));

      const html = readFileSync(join(dest, 'index.html'), 'utf8');
      const meta = parseSpaceMetadata(readFileSync(join(dest, 'space.json'), 'utf8'));
      assert.equal(typeof meta.title, 'string');
      assert.ok(Array.isArray(meta.insights));

      // Spaces render in a sandboxed iframe without network: nothing may load remotely.
      assert.doesNotMatch(html, /@import\s+url\(\s*['"]?https?:/i);
      assert.doesNotMatch(html, /<(?:script|img|link|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']https?:/i);
      assert.doesNotMatch(html, /url\(\s*['"]?https?:/i);

      // The desktop counts elements with class "card".
      assert.match(html, /class\s*=\s*["'][^"']*\bcard\b/);
    } finally {
      rmSync(spacesDir, { recursive: true, force: true });
    }
  });
}

test('installing an unknown example space fails clearly', () => {
  assert.throws(() => installExampleSpace('nope'), /unknown example space/);
});

test('sub4me sample data is internally consistent', () => {
  const html = readFileSync(join(ROOT, 'examples/sub4me/index.html'), 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="s4m-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const used = data.aiUnits.monthly.reduce((a, b) => a + b, 0);
  assert.equal(data.products.reduce((a, p) => a + p.consumed, 0), used);
  assert.equal(data.products.reduce((a, p) => a + p.allotment, 0), data.aiUnits.allotment);
  assert.equal(new Set(data.tickets.map((t) => t.id)).size, data.tickets.length);
  assert.match(html, /not affiliated/i);
  assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|localStorage/);
});

test('sub4me never relies on a native form submit (Spaces are sandboxed without allow-forms)', () => {
  const html = readFileSync(join(ROOT, 'examples/sub4me/index.html'), 'utf8');
  assert.doesNotMatch(html, /type="submit"|addEventListener\('submit'/);
});
