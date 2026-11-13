import assert from 'node:assert/strict';
import test from 'node:test';
import { BLOCK_INFO, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_IMAGE_CHARS, addBlock, emptyLayout, normalizeLayout } from '../src/space-layout.ts';
import { renderSpacePage } from '../src/space-layout-render.ts';
import { IMAGE_KEPT, SCHEMA_HELP, layoutPrompt, parseLayoutAnswer, withoutPictures } from '../src/space-designer-ai.ts';
import { dataBytes, fitImage, sniffImage } from '../src/space-designer-image.ts';

const pic = (bytes) => `data:image/webp;base64,${Buffer.alloc(bytes, 7).toString('base64')}`;
const block = (o) => ({ id: 'b1', type: 'image', src: pic(1000), alt: 'A cat', caption: 'Our cat', width: 'medium', ...o });
const one = (o) => normalizeLayout({ blocks: [block(o)] }).blocks[0];

test('the image block is in the palette and in the schema help', () => {
  assert.ok(BLOCK_INFO.some((i) => i.type === 'image'));
  assert.match(SCHEMA_HELP, /- image: src/);
  const added = addBlock(emptyLayout(), 'image').layout.blocks[0];
  assert.deepEqual([added.src, added.width], ['', 'medium']);
});

test('only a small embedded webp, jpeg or png is kept; every other address is dropped', () => {
  assert.equal(one({}).src, pic(1000));
  assert.equal(one({ src: pic(1000).replace('webp', 'png') }).src.startsWith('data:image/png;base64,'), true);
  for (const bad of ['https://x.test/a.png', 'http://x.test/a.png', 'file:///etc/passwd', '//x.test/a.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'data:image/gif;base64,R0lGOD', 'data:image/webp;base64,', 'data:image/webp;base64,@@@@', `data:image/webp;base64,${'A'.repeat(MAX_IMAGE_CHARS)}`, 42, null]) {
    assert.equal(one({ src: bad }).src, '', String(bad).slice(0, 40));
  }
  assert.ok(Buffer.from(pic(MAX_IMAGE_BYTES).split(',')[1], 'base64').length <= MAX_IMAGE_BYTES);
  assert.equal(one({ src: pic(MAX_IMAGE_BYTES) }).src.length > 0, true, 'exactly the limit still fits');
});

test('a page holds at most four pictures; later ones are emptied and the person is told', () => {
  const notes = [];
  const l = normalizeLayout({ blocks: Array.from({ length: 6 }, (_, i) => block({ id: `b${i + 1}` })) }, notes);
  assert.deepEqual(l.blocks.map((b) => !!b.src), [true, true, true, true, false, false]);
  assert.equal(MAX_IMAGES, 4);
  assert.match(notes.join(' '), /Only 4 pictures/);
});

test('text fields are cut, the width is one of three', () => {
  const b = one({ alt: 'x'.repeat(500), caption: 'y\nz', width: 'huge' });
  assert.equal(b.alt.length, 200);
  assert.equal(b.caption, 'y z');
  assert.equal(b.width, 'medium');
  assert.equal(one({ width: 'full' }).width, 'full');
});

test('the page shows the picture with its description and caption, escapes texts, loads nothing from outside, and says so when empty', () => {
  const evil = '"><script>alert(1)</script>';
  const html = renderSpacePage({ title: 't', css: '', layout: normalizeLayout({ blocks: [block({ alt: evil, caption: evil, width: 'small' }), block({ id: 'b2', src: '' })] }) });
  assert.match(html, /<figure class="card wb-image wb-w-small"[^>]*><img src="data:image\/webp;base64,[A-Za-z0-9+/=]+" alt="&quot;&gt;&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /No image yet\./);
  assert.equal((html.match(/src="(?!data:image)/g) ?? []).length, 0, 'no src that points anywhere else');
  assert.equal(/https?:\/\//.test(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/, '')), false);
});

test('the agent gets a marker instead of the picture and cannot change it; a block with the same id keeps its picture', () => {
  const layout = normalizeLayout({ blocks: [block({ id: 'b1' }), { id: 'b2', type: 'text', title: 'T', text: 'x' }] });
  const stripped = withoutPictures(layout);
  assert.equal(stripped.blocks[0].src, IMAGE_KEPT);
  const prompt = layoutPrompt('t', layout, 'make it nicer');
  assert.ok(prompt.includes(IMAGE_KEPT));
  assert.ok(!prompt.includes('base64,'), 'no picture data in the request');
  assert.ok(prompt.length < 4000);
  const answer = (blocks) => '```json\n' + JSON.stringify({ version: 1, datasets: [], blocks }) + '\n```\nDone.';
  const kept = parseLayoutAnswer(answer([{ id: 'b1', type: 'image', src: IMAGE_KEPT, alt: 'New alt', caption: '', width: 'full' }]), layout);
  assert.equal(kept.layout.blocks[0].src, pic(1000));
  assert.equal(kept.layout.blocks[0].alt, 'New alt');
  const swapped = parseLayoutAnswer(answer([{ id: 'b1', type: 'image', src: 'https://evil.test/x.png', alt: 'a', caption: '', width: 'medium' }]), layout);
  assert.equal(swapped.layout.blocks[0].src, pic(1000), 'a foreign address is dropped and the old picture stays');
  const fresh = parseLayoutAnswer(answer([{ id: 'b9', type: 'image', src: IMAGE_KEPT, alt: 'a', caption: '', width: 'medium' }]), layout);
  assert.equal(fresh.layout.blocks[0].src, '', 'a new block cannot claim a picture');
});

test('shrinking: the biggest side and best quality that fit are used, never larger than the original, null when nothing fits', () => {
  const calls = [];
  const sizeFor = (w, q) => Math.round(w * q * 120);
  const encode = (w, h, q) => { calls.push([w, h, q]); return pic(sizeFor(w, q)); };
  const fit = fitImage(4000, 2000, encode);
  assert.ok(fit && fit.bytes <= MAX_IMAGE_BYTES);
  assert.deepEqual(calls[0], [1280, 640, 0.85], 'starts at the largest side and best quality');
  assert.equal(fit.width, Math.round(4000 * (fit.width / 4000)));
  const small = fitImage(300, 200, (w, h) => { assert.ok(w <= 300 && h <= 200); return pic(1000); });
  assert.deepEqual([small.width, small.height], [300, 200]);
  assert.equal(fitImage(4000, 4000, () => pic(MAX_IMAGE_BYTES + 5000)), null);
  assert.equal(fitImage(0, 10, () => pic(10)), null);
  assert.equal(fitImage(10, 10, () => 'data:image/svg+xml;base64,AAAA'), null, 'an encoder answer of the wrong kind is refused');
  assert.equal(dataBytes(pic(1234)), 1234);
});

test('the kind of a picture comes from its first bytes, not from its name', () => {
  assert.equal(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0])), 'png');
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'webp');
  assert.equal(sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39])), 'gif');
  assert.equal(sniffImage(Uint8Array.from([0x3c, 0x73, 0x76, 0x67])), null, 'svg text is not a picture here');
  assert.equal(sniffImage(new Uint8Array(0)), null);
});
