import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildDemo, demoSpaces, galleryHtml } from '../scripts/build-demo.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';

test('the web demo publishes every bundled example Space as a static page', () => {
  const out = mkdtempSync(join(tmpdir(), 'demo-'));
  const spaces = buildDemo({ out });
  assert.equal(spaces.length, Object.keys(EXAMPLE_SPACES).length);
  for (const s of spaces) assert.ok(existsSync(join(out, 'spaces', s.slug, 'index.html')), s.slug);
  const gallery = readFileSync(join(out, 'index.html'), 'utf8');
  for (const s of spaces) assert.ok(gallery.includes(`data-slug="${s.slug}"`), s.slug);
});

test('the gallery sandboxes Spaces, escapes titles and loads nothing remote', () => {
  const html = galleryHtml([{ slug: 'x', title: '<img src=x onerror=alert(1)>' }]);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.ok(demoSpaces().every((s) => s.title.length > 0));
});

test('vercel.json builds without installing dependencies', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.outputDirectory, 'dist/demo');
  assert.match(config.buildCommand, /build-demo/);
  assert.doesNotMatch(config.installCommand, /npm (ci|install)/);
});
