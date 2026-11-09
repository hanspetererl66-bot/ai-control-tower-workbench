import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Control Tower grids use minmax(0,1fr) so one column cannot grow to its content and scroll the page sideways', () => {
  const html = read('examples/control-tower/index.html');
  assert.match(html, /\.g2\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:12px\}/);
  assert.match(html, /@media\(max-width:640px\)\{\.g2,\.g3,\.g4\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.doesNotMatch(html, /\.g2\{[^}]*grid-template-columns:1fr 1fr/);
});

test('at phone width the Control Tower header grows with its content instead of cutting title and date off', () => {
  const html = read('examples/control-tower/index.html');
  assert.match(html, /@media\(max-width:640px\)\{\.ct header\.hdr\{height:auto;min-height:60px;[^}]*flex-wrap:wrap/);
});

test('the subspaces carry the same fixes and their back button does not wrap', () => {
  for (const dir of ['agent-registry', 'agent-compliance']) {
    const html = read(`examples/${dir}/index.html`);
    assert.match(html, /repeat\(2,minmax\(0,1fr\)\)/, dir);
    assert.match(html, /\.ct header\.hdr\{height:auto/, dir);
    assert.match(html, /\.hub-back\{white-space:nowrap/, dir);
  }
});
