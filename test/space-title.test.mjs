import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { SPACE_TITLE_ID, applySpaceTitle, brandCss, hasOwnTitle, headingOf, ownTitleKind, splitHeading, titleCss } from '../src/space-title.ts';

const ROOT = join(import.meta.dirname, '..');
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body class="b"><main><p>Hello</p></main></body></html>';

test('the heading: the Space gives its own words or the title is used; one line, at most 80 characters; the last word is the highlighted one', () => {
  assert.equal(headingOf({ title: 'Agent  Observability ' }), 'Agent Observability');
  assert.equal(headingOf({ title: 'E-Mail-Communication - Kunde: Muster Industrie AG', heading: 'Customer E-mails' }), 'Customer E-mails');
  assert.equal(headingOf({ title: 'x'.repeat(200) }).length, 80);
  assert.deepEqual(splitHeading('Agent Observability'), { lead: 'Agent', accent: 'Observability' });
  assert.deepEqual(splitHeading('Order-to-Cash Software'), { lead: 'Order-to-Cash', accent: 'Software' });
  assert.deepEqual(splitHeading('Collections'), { lead: '', accent: 'Collections' }, 'one word: the whole word is violet');
  assert.deepEqual(splitHeading('What-if Simulator'), { lead: 'What-if', accent: 'Simulator' });
});

test('a page without a title gets one as its first element: bold, the last word in a span, text escaped, the style in the head', () => {
  const out = applySpaceTitle(PAGE, { title: 'Agent <b>Network</b> & more' });
  const d = new JSDOM(out).window.document;
  const h = d.querySelector(`body > h1#${SPACE_TITLE_ID}`);
  assert.ok(h);
  assert.equal(d.body.firstElementChild, h, 'first in the body');
  assert.equal(h.textContent, 'Agent <b>Network</b> & more');
  assert.equal(h.querySelector('span').textContent, 'more');
  assert.equal(h.querySelectorAll('b').length, 0, 'no markup from the title gets through');
  assert.equal(d.head.querySelectorAll(`style#${SPACE_TITLE_ID}-style`).length, 1);
  assert.match(d.head.querySelector(`style#${SPACE_TITLE_ID}-style`).textContent, /font-weight:750/);
  assert.equal(applySpaceTitle(out, { title: 'Agent Network' }), out, 'a second time changes nothing');
});

test('a page that says its own name already gets none: a heading, a brand header that carries the title, the flag; scripts and styles do not count', () => {
  const t = { title: 'Sub4Me' };
  assert.equal(hasOwnTitle(PAGE, t), false);
  assert.equal(hasOwnTitle('<html><body><h1>Sales <b>Pipeline</b></h1></body></html>', { title: 'Sales' }), true);
  assert.equal(hasOwnTitle('<html><body><header><div class="logo">Skill <b>Marketplace</b></div></header><main>x</main></body></html>', { title: 'Skill Marketplace' }), true, 'the brand header says it');
  assert.equal(hasOwnTitle('<html><body><main>x</main><script>var s = "<h1>" + t + "</h1>";</script></body></html>', t), false, 'an h1 in a script is made later and says nothing about the Space');
  assert.equal(hasOwnTitle('<html><head><style>h1{color:red}</style></head><body><main>x</main></body></html>', t), false);
  assert.equal(hasOwnTitle(PAGE, { title: 'Sub4Me', ownTitle: true }), true);
  assert.equal(hasOwnTitle('no markup at all', t), true, 'nothing to put it in');
  assert.equal(applySpaceTitle('<html><body><h1>Own</h1></body></html>', { title: 'Own Space' }).includes(SPACE_TITLE_ID), false);
  assert.equal(ownTitleKind('<html><body><h1>Own</h1></body></html>', { title: 'Own Space' }), 'heading');
  assert.equal(ownTitleKind('<html><body><header><div class="logo">Skill <b>Marketplace</b></div></header></body></html>', { title: 'Skill Marketplace' }), 'brand');
  assert.equal(ownTitleKind(PAGE, { title: 'x', ownTitle: true }), 'flag');
  assert.equal(ownTitleKind(PAGE, { title: 'Hello World' }), null);
  assert.equal(applySpaceTitle(PAGE, { title: '' }), PAGE, 'no title, no heading');
});

test('a page whose header already carries the name keeps its header, and the name gets the look of the title: large, bold, last word violet (no second title)', () => {
  const page = '<!doctype html><html><head><title>x</title></head><body><header><div class="logo">Hiring <b>Approvals</b></div></header><main>x</main></body></html>';
  const out = applySpaceTitle(page, { title: 'Hiring Approvals' });
  const d = new JSDOM(out).window.document;
  assert.equal(d.querySelectorAll('h1').length, 0, 'no second title');
  assert.equal(d.querySelectorAll('.logo').length, 1);
  assert.match(d.head.querySelector(`style#${SPACE_TITLE_ID}-style`).textContent, /header \.logo\{font-size:28px;/);
  assert.equal(applySpaceTitle(out, { title: 'Hiring Approvals' }), out, 'a second time changes nothing');
  const css = brandCss();
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  assert.match(css, /header \.logo b\{color:var\(--purple,var\(--accent,inherit\)\)\}/);
  assert.match(css, /\.hdr \.hdr-title\{font-size:24px;/);
});

test('the style uses tokens only, follows light, dark and the accent, and shrinks on a narrow screen', () => {
  const css = titleCss();
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  assert.match(css, /\.wb-space-title span\{color:var\(--purple,var\(--accent,inherit\)\)\}/);
  assert.match(css, /font-size:28px/);
  assert.match(css, /@media \(max-width:640px\)/);
});

test('every Space of the examples ends up with exactly one title, in one look: the title the app puts in, a restyled header name, or a heading of its own (Sales is the model)', () => {
  const names = readdirSync(join(ROOT, 'examples'), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(ROOT, 'examples', e.name, 'index.html'))).map((e) => e.name);
  const kinds = { injected: [], brand: [], heading: [], flag: [] };
  for (const name of names) {
    const html = readFileSync(join(ROOT, 'examples', name, 'index.html'), 'utf8');
    const meta = JSON.parse(readFileSync(join(ROOT, 'examples', name, 'space.json'), 'utf8'));
    const space = { title: meta.title, heading: meta.heading, ownTitle: meta.ownTitle };
    const out = applySpaceTitle(html, space);
    const injected = (out.match(new RegExp(`id="${SPACE_TITLE_ID}"`, 'g')) ?? []).length;
    const kind = ownTitleKind(html, space);
    assert.ok(injected <= 1, `${name}: at most one injected title`);
    assert.equal(injected === 1, kind === null, `${name}: a title is put in exactly when the page has none`);
    if (kind === null) { kinds.injected.push(name); assert.ok(headingOf(space).length >= 3, `${name}: a heading`); } else kinds[kind].push(name);
    if (kind === 'brand') assert.ok(out.includes(`id="${SPACE_TITLE_ID}-style"`), `${name}: its header name is restyled`);
    if (kind === 'heading' || kind === 'flag') assert.equal(out, html, `${name}: untouched`);
  }
  assert.ok(kinds.injected.length >= 10, `${kinds.injected.length} Spaces get a title`);
  assert.ok(kinds.brand.length >= 15, `${kinds.brand.length} Spaces restyle the name in their header`);
  assert.ok(kinds.heading.includes('sales'), 'Sales keeps its heading (it is the model)');
  assert.ok(kinds.brand.includes('sub4me') && kinds.brand.includes('hiring-approvals'));
  assert.equal(kinds.injected.length + kinds.brand.length + kinds.heading.length + kinds.flag.length, names.length);
});

test('space.json may carry a heading and the flag; the list passes them on, the viewer applies the title before the other changes', () => {
  assert.match(readFileSync(join(ROOT, 'vite.config.mts'), 'utf8'), /heading: typeof meta\.heading === 'string'[^\n]*slice\(0, 80\)[^\n]*\n\s*ownTitle: meta\.ownTitle === true \? true : undefined/);
  assert.match(readFileSync(join(ROOT, 'src/spaces.ts'), 'utf8'), /heading\?: string;[\s\S]*ownTitle\?: boolean;/);
  assert.match(readFileSync(join(ROOT, 'src/ui/SpaceViewer.tsx'), 'utf8'), /applySpaceTheme\(applySpaceTitle\(html \?\? '', space\), theme\)/);
  const long = JSON.parse(readFileSync(join(ROOT, 'examples/customer-emails/space.json'), 'utf8'));
  assert.equal(long.heading, 'Customer E-mails');
});
