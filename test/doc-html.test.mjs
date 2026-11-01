import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { cleanStyle, htmlToMarkdown, markdownToHtml, safeHref, safeImageSrc, sanitizeHtml, textOfHtml, toHtml } = await import('../src/doc-html.ts');

test('scripts, handlers, frames and unknown wrappers are removed, text stays', () => {
  const out = sanitizeHtml('<p onclick="x()">Hi <script>alert(1)</script><b>there</b><iframe src="https://e"></iframe><custom-tag>kept</custom-tag></p><style>p{}</style>');
  assert.equal(out, '<p>Hi <strong>there</strong>kept</p>');
  assert.doesNotMatch(sanitizeHtml('<img src="x" onerror="alert(1)">'), /onerror|<img/);
});

test('links: only http(s) and mailto, always opened safely', () => {
  assert.equal(sanitizeHtml('<a href="https://sap.com/x?a=1&b=2">SAP</a>'), '<a href="https://sap.com/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">SAP</a>');
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">bad</a>'), 'bad');
  assert.equal(sanitizeHtml('<a href="data:text/html,x">bad</a>'), 'bad');
  assert.equal(safeHref('mailto:a@b.de'), 'mailto:a@b.de');
  assert.equal(safeHref(' javascript:x'), '');
});

test('images: small data images and https only', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.match(sanitizeHtml(`<img src="${png}" alt="Logo" width="300">`), /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="Logo" width="300">/);
  assert.match(sanitizeHtml('<img src="https://example.com/a.png">'), /<img src="https:\/\/example\.com\/a\.png" alt="">/);
  for (const bad of ['http://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'file:///etc/passwd', 'javascript:x']) assert.equal(sanitizeHtml(`<img src="${bad}">`), '', bad);
  assert.equal(safeImageSrc(`data:image/png;base64,${'A'.repeat(1_600_000)}`), '');
});

test('styles: only fonts, sizes, weight, slant, underline, alignment and colours, with checked values', () => {
  assert.equal(cleanStyle('font-size: 18px; font-family: Georgia, serif; font-weight: bold; font-style: italic; text-decoration: underline; color: #112233; text-align: center'),
    'font-size: 18px; font-family: Georgia, serif; font-weight: bold; font-style: italic; text-decoration: underline; color: #112233; text-align: center');
  assert.equal(cleanStyle('position: fixed; background: url(http://x); font-size: 500px; font-family: Evil; color: red; width: 100%'), '');
  assert.equal(cleanStyle('font-size: 12pt'), 'font-size: 16px');
  assert.equal(sanitizeHtml('<span style="font-size:20px;position:absolute">x</span>'), '<span style="font-size: 20px">x</span>');
  assert.equal(sanitizeHtml('<font face="Georgia">x</font>'), '<span style="font-family: Georgia, serif">x</span>');
});

test('Markdown from the agent becomes HTML with real tables, headings and lists', () => {
  const html = markdownToHtml('# PRD\n\n| ID | Requirement |\n|---|---|\n| REQ-01 | Warn owners |\n\n- one\n- **two**\n');
  assert.match(html, /<h1>PRD<\/h1>/);
  assert.match(html, /<table>.*<th>ID<\/th>.*<td>REQ-01<\/td>/s);
  assert.match(html, /<li><strong>two<\/strong><\/li>/);
});

test('toHtml keeps HTML (checked) and converts older Markdown', () => {
  assert.equal(toHtml('<p onclick="x">a</p>'), '<p>a</p>');
  assert.match(toHtml('## Title\n\ntext'), /<h2>Title<\/h2>/);
  assert.equal(toHtml('  '), '');
});

test('back to Markdown for prompts: structure and tables survive, pictures are named, not embedded', () => {
  const md = htmlToMarkdown('<h2>Scope</h2><p>Some <strong>bold</strong> and <em>slanted</em> <a href="https://sap.com">link</a>.</p><table><thead><tr><th>ID</th><th>Text</th></tr></thead><tbody><tr><td>REQ-01</td><td>Warn</td></tr></tbody></table><img src="data:image/png;base64,iVBORw0KGgo=" alt="Flow"><ul><li>a</li><li>b</li></ul>');
  assert.match(md, /^## Scope/);
  assert.match(md, /\*\*bold\*\* and \*slanted\* \[link\]\(https:\/\/sap\.com\)/);
  assert.match(md, /\| ID\s*\| Text\s*\|/);
  assert.match(md, /\[image: Flow\]/);
  assert.doesNotMatch(md, /base64/);
  assert.match(md, /^-\s+a$/m);
  assert.match(htmlToMarkdown('<img src="https://e.com/a.png" alt="x">', { images: 'keep' }), /!\[x\]\(https:\/\/e\.com\/a\.png\)/);
});

test('textOfHtml tells whether there is any text', () => {
  assert.equal(textOfHtml('<p> </p><p><br></p>'), '');
  assert.equal(textOfHtml('<h1>A</h1><p>b  c</p>'), 'A b c');
});

test('sanitising twice changes nothing (the editor must not fight the store)', () => {
  const html = markdownToHtml('# T\n\n| a | b |\n|---|---|\n| 1 | **2** |\n\n- x\n- y\n\n[l](https://sap.com)');
  assert.equal(sanitizeHtml(html), html);
  const rich = '<p><span style="font-size: 20px; font-family: Georgia, serif">x</span> <a href="https://a.de" target="_blank" rel="noopener noreferrer">l</a></p>';
  assert.equal(sanitizeHtml(rich), rich);
});
