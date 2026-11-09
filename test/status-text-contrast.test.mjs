import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('examples/shared/design-system.css');

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(rgb(a)); const y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('the status text colours (-ink tokens) reach 4.5:1 on the light grounds, and exist in all three theme blocks', () => {
  for (const name of ['green', 'purple', 'amber', 'blue', 'red']) {
    assert.equal(css.split(`--${name}-ink:`).length - 1, 3, `--${name}-ink in light, system-dark and pinned dark`);
  }
  for (const name of ['green', 'purple', 'amber', 'blue']) {
    const value = new RegExp(`--${name}-ink:(#[0-9a-fA-F]{6});`).exec(css)?.[1];
    assert.ok(value, `${name} light value`);
    for (const ground of ['#ffffff', '#f6f5f8', '#f1f0f5', '#faf9fc']) assert.ok(ratio(value, ground) >= 4.5, `${name} ${value} on ${ground}: ${ratio(value, ground).toFixed(2)}`);
  }
});

test('Control Tower text uses the -ink tokens, not the fill colours', () => {
  const html = read('examples/control-tower/index.html');
  assert.equal([...html.matchAll(/(?<![-\w])color:var\(--(?:green|purple|amber|blue)\)/g)].length, 0);
  assert.match(html, /color:var\(--'\+color\+'-ink\)/); // risk tiles built in the script
  assert.doesNotMatch(html, /\.cs\{[^}]*color:#999/);
});
