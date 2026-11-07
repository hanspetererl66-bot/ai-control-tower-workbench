import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  BLOCK_INFO, MAX_BLOCKS, addBlock, blockDefaults, cellNumber, duplicateBlock, emptyLayout, moveBlock, normalizeLayout, parseTable,
  pointBlockAt, removeBlock, setDataset, slugFromTitle, updateBlock,
} from '../src/space-layout.ts';
import { esc, fmtNumber, isDesignedPage, layoutFromHtml, renderSpacePage, richHtml } from '../src/space-layout-render.ts';
import { LAYOUT_TEMPLATES } from '../src/space-layout-templates.ts';
import { saveDesignedSpace } from '../src/space-designer-save.ts';
import { SCHEMA_HELP, diffLayouts, diffText, layoutPrompt, parseLayoutAnswer } from '../src/space-designer-ai.ts';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'examples/shared/design-system.css'), 'utf8');

/** A layout with every block type once. */
function everything() {
  let layout = emptyLayout();
  for (const info of BLOCK_INFO) layout = addBlock(layout, info.type).layout;
  return layout;
}

test('every block type can be added and survives a second check unchanged', () => {
  const layout = everything();
  assert.equal(layout.blocks.length, BLOCK_INFO.length);
  assert.deepEqual(normalizeLayout(layout), layout);
  assert.deepEqual(layout.blocks.map((b) => b.type), BLOCK_INFO.map((i) => i.type));
  // tables and charts bring their own sample data, the rest none
  assert.equal(layout.datasets.length, 2);
});

test('normalizeLayout drops unknown blocks, clamps sizes and repairs ids and dataset links', () => {
  const notes = [];
  const layout = normalizeLayout({
    datasets: [{ id: 'd1', columns: ['A', 'B'], rows: [['x', '1', 'extra'], ['y']] }],
    blocks: [
      { id: 'same', type: 'text', title: 'T', text: 'x'.repeat(9000) },
      { id: 'same', type: 'columns', count: 7, boxes: [{ title: 'only one', text: 'a' }] },
      { type: 'script', text: '<script>alert(1)</script>' },
      { id: 'c1', type: 'chart', kind: 'pie3d', dataset: 'missing' },
      { id: 't1', type: 'table', dataset: 'd1' },
    ],
  }, notes);
  assert.deepEqual(layout.blocks.map((b) => b.type), ['text', 'columns', 'chart', 'table']);
  assert.equal(new Set(layout.blocks.map((b) => b.id)).size, 4);
  assert.equal(layout.blocks[0].text.length, 4000);
  assert.equal(layout.blocks[1].count, 2); // an unknown count falls back to two boxes
  assert.equal(layout.blocks[1].boxes.length, 2);
  assert.equal(layout.blocks[2].kind, 'bar');
  assert.equal(layout.blocks[2].dataset, 'd1'); // a missing dataset falls back to the first
  assert.deepEqual(layout.datasets[0].rows, [['x', '1'], ['y', '']]); // rows are cut or padded to the columns
  assert.ok(notes.some((n) => /unknown type/.test(n)) && notes.some((n) => /missing data/.test(n)));
});

test('normalizeLayout limits the number of blocks and treats garbage as an empty page', () => {
  const many = { blocks: Array.from({ length: MAX_BLOCKS + 10 }, () => ({ type: 'divider' })) };
  assert.equal(normalizeLayout(many).blocks.length, MAX_BLOCKS);
  for (const junk of [null, 5, 'text', [], { blocks: 'x' }]) assert.deepEqual(normalizeLayout(junk).blocks, []);
});

test('editing: add after, move, duplicate with its own data, remove prunes data, update is checked', () => {
  let layout = emptyLayout();
  const a = addBlock(layout, 'heading'); layout = a.layout;
  const b = addBlock(layout, 'chart', a.id); layout = b.layout;
  const c = addBlock(layout, 'text', a.id); layout = c.layout;
  assert.deepEqual(layout.blocks.map((x) => x.id), [a.id, c.id, b.id]);

  layout = moveBlock(layout, b.id, 0);
  assert.equal(layout.blocks[0].id, b.id);
  assert.equal(moveBlock(layout, 'nope', 0), layout);

  const dup = duplicateBlock(layout, b.id);
  const copy = dup.layout.blocks.find((x) => x.id === dup.id);
  const original = dup.layout.blocks.find((x) => x.id === b.id);
  assert.notEqual(copy.dataset, original.dataset, 'a copy owns its data');
  assert.equal(dup.layout.datasets.length, 2);

  const removed = removeBlock(dup.layout, dup.id);
  assert.equal(removed.datasets.length, 1, 'data nobody shows is dropped');

  const bad = updateBlock(layout, b.id, { kind: 'nonsense', title: 'x'.repeat(500) });
  const chart = bad.blocks.find((x) => x.id === b.id);
  assert.equal(chart.kind, 'bar');
  assert.equal(chart.title.length, 120);
  assert.equal(updateBlock(layout, b.id, { type: 'divider' }).blocks.find((x) => x.id === b.id).type, 'chart', 'the type cannot be changed by an update');
});

test('two blocks can show the same dataset; pointing a block at new data creates it', () => {
  let layout = emptyLayout();
  const t = addBlock(layout, 'table'); layout = t.layout;
  const c = addBlock(layout, 'chart'); layout = c.layout;
  layout = pointBlockAt(layout, c.id, layout.blocks.find((b) => b.id === t.id).dataset);
  assert.equal(layout.datasets.length, 1, 'the chart now uses the table data and its own sample data is dropped');
  layout = pointBlockAt(layout, c.id, 'new');
  assert.equal(layout.datasets.length, 2);
  const ds = layout.datasets[0];
  layout = setDataset(layout, { ...ds, rows: [...ds.rows, ['Item four', 'Dee', '{ok} Done', '10']] });
  assert.equal(layout.datasets[0].rows.length, ds.rows.length + 1);
});

test('numbers in cells: thousands, decimals, signs, symbols, status marker', () => {
  assert.equal(cellNumber('1,234.5'), 1234.5);
  assert.equal(cellNumber('1.234,5'), 1234.5);
  assert.equal(cellNumber('12,5'), 12.5);
  assert.equal(cellNumber('1,234'), 1234);
  assert.equal(cellNumber('1.234.567'), 1234567);
  assert.equal(cellNumber('-3'), -3);
  assert.equal(cellNumber('12 %'), 12);
  assert.equal(cellNumber('€ 40'), 40);
  assert.equal(cellNumber('{ok} 40'), 40);
  assert.equal(cellNumber('abc'), null);
  assert.equal(cellNumber(''), null);
  assert.equal(cellNumber('12abc'), null);
});

test('pasted tables: tabs from a spreadsheet, semicolons, quoted commas', () => {
  assert.deepEqual(parseTable('Name\tQty\nA\t1\nB\t2'), { columns: ['Name', 'Qty'], rows: [['A', '1'], ['B', '2']] });
  assert.deepEqual(parseTable('Name;Qty\nA;1,5'), { columns: ['Name', 'Qty'], rows: [['A', '1,5']] });
  assert.deepEqual(parseTable('Name,Note\n"Smith, J","said ""hi"""'), { columns: ['Name', 'Note'], rows: [['Smith, J', 'said "hi"']] });
  assert.equal(parseTable('   \n  '), null);
});

test('slugFromTitle makes a safe folder name', () => {
  assert.equal(slugFromTitle('Größe & Übersicht 2026!'), 'grosse-ubersicht-2026');
  assert.equal(slugFromTitle('  ../../etc/passwd '), 'etc-passwd');
  assert.equal(slugFromTitle('???'), 'new-space');
  assert.ok(slugFromTitle('x'.repeat(200)).length <= 40);
});

/* ---------------------------------------------------------------- the page */

test('a rendered page follows the rules of every Space: no network, tokens only, cards, layout inside', () => {
  const layout = everything();
  const html = renderSpacePage({ title: 'All blocks', layout, css: CSS });
  assert.doesNotMatch(html, /@import\s+url\(\s*['"]?https?:/i);
  assert.doesNotMatch(html, /<(?:script|img|link|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /url\(\s*['"]?https?:/i);
  assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/);
  assert.doesNotMatch(html, /type="submit"/);
  assert.match(html, /class\s*=\s*["'][^"']*\bcard\b/);
  assert.match(html, /prefers-color-scheme:dark/);
  // surfaces are tokens: no literal white background outside the design system and the chart palette
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style id="design-system">[\s\S]*?<\/style>/, ''), /background:\s*#fff(?![0-9a-f])/i);
  assert.ok(isDesignedPage(html));
  assert.deepEqual(layoutFromHtml(html), layout, 'the page carries the layout it was made from');
});

test('every block type draws something and every chart kind has data, legend and a "Show data" table', () => {
  const layout = everything();
  const html = renderSpacePage({ title: 't', layout, css: CSS });
  for (const b of layout.blocks) assert.ok(html.includes(`data-wb-block="${b.id}"`), `${b.type} is in the page`);
  for (const kind of ['bar', 'stacked', 'line', 'area', 'donut']) {
    const l = normalizeLayout({
      datasets: [{ id: 'd1', name: 'x', columns: ['Month', 'Plan', 'Actual'], rows: [['Jan', '40', '36'], ['Feb', '44', '47'], ['Mar', '48', '-3']] }],
      blocks: [{ id: 'c1', type: 'chart', title: 'T', kind, dataset: 'd1' }],
    });
    const out = renderSpacePage({ title: 't', layout: l, css: CSS });
    assert.match(out, /<svg/, kind);
    assert.match(out, /Show data/, kind);
    assert.doesNotMatch(out, /NaN|undefined|Infinity/, kind);
    if (kind !== 'donut') assert.match(out, /<ul class="wb-legend">/, `${kind}: two series need a legend`);
    if (kind === 'bar' || kind === 'line' || kind === 'area' || kind === 'stacked') assert.match(out, /class="wb-hit"/, `${kind}: hover text per category`);
  }
});

test('charts with one series have no legend, and use the fixed colour order', () => {
  const l = normalizeLayout({
    datasets: [{ id: 'd1', columns: ['Q', 'Sales'], rows: [['Q1', '10'], ['Q2', '20']] }],
    blocks: [{ type: 'chart', kind: 'bar', dataset: 'd1' }],
  });
  const out = renderSpacePage({ title: 't', layout: l, css: CSS });
  assert.doesNotMatch(out, /<ul class="wb-legend">/);
  assert.match(out, /fill="var\(--wb-c1\)"/);
  const two = normalizeLayout({
    datasets: [{ id: 'd1', columns: ['Q', 'A', 'B', 'C'], rows: [['Q1', '1', '2', '3']] }],
    blocks: [{ type: 'chart', kind: 'bar', dataset: 'd1' }],
  });
  const o2 = renderSpacePage({ title: 't', layout: two, css: CSS });
  assert.ok(o2.indexOf('var(--wb-c1)') < o2.indexOf('var(--wb-c2)') && o2.includes('var(--wb-c3)'));
});

test('charts survive empty, single-point and text-only data', () => {
  const cases = [
    { columns: ['A'], rows: [] },
    { columns: ['A', 'B'], rows: [['x', 'text']] },
    { columns: ['A', 'B'], rows: [['x', '5']] },
    { columns: ['A', 'B'], rows: [['x', '0'], ['y', '0']] },
    { columns: ['A', 'B'], rows: [['x', '-5'], ['y', '-9']] },
  ];
  for (const kind of ['bar', 'stacked', 'line', 'area', 'donut']) {
    for (const data of cases) {
      const l = normalizeLayout({ datasets: [{ id: 'd1', ...data }], blocks: [{ type: 'chart', kind, dataset: 'd1' }] });
      const out = renderSpacePage({ title: 't', layout: l, css: CSS });
      assert.doesNotMatch(out, /NaN|undefined|Infinity/, `${kind} ${JSON.stringify(data)}`);
    }
  }
});

test('the donut folds more than eight slices into "Other" and shares of 100% draw one ring', () => {
  const rows = Array.from({ length: 12 }, (_, i) => [`S${i + 1}`, String(i + 1)]);
  const l = normalizeLayout({ datasets: [{ id: 'd1', columns: ['Name', 'V'], rows }], blocks: [{ type: 'chart', kind: 'donut', dataset: 'd1' }] });
  const out = renderSpacePage({ title: 't', layout: l, css: CSS });
  assert.match(out, /Other/);
  assert.equal((out.match(/<path d="M[^"]*" fill=/g) ?? []).length >= 8, true);
  const one = normalizeLayout({ datasets: [{ id: 'd1', columns: ['Name', 'V'], rows: [['Only', '5']] }], blocks: [{ type: 'chart', kind: 'donut', dataset: 'd1' }] });
  assert.match(renderSpacePage({ title: 't', layout: one, css: CSS }), /100%/);
});

test('tables: status markers become tags with the word, numbers align right, totals add up, sort script only when needed', () => {
  const l = normalizeLayout({
    datasets: [{ id: 'd1', columns: ['Name', 'Status', 'Amount'], rows: [['A', '{ok} Done', '1,200'], ['B', '{bad} Blocked', '300']] }],
    blocks: [{ type: 'table', dataset: 'd1', sortable: true, totals: true }],
  });
  const out = renderSpacePage({ title: 't', layout: l, css: CSS });
  assert.match(out, /<span class="wb-tag wb-tone-ok">Done<\/span>/);
  assert.match(out, /<span class="wb-tag wb-tone-bad">Blocked<\/span>/);
  assert.match(out, /<td class="num" data-n="1200">1,200<\/td>/);
  assert.match(out, /<tfoot><tr><td>Total<\/td><td><\/td><td class="num">1,500<\/td>/);
  assert.match(out, /class="wb-sortbtn"/);
  const plain = renderSpacePage({ title: 't', layout: normalizeLayout({ blocks: [{ type: 'text', text: 'hi' }] }), css: CSS });
  assert.doesNotMatch(plain, /class="wb-sortbtn"|data-wb-ask="|addEventListener\('click'/);
});

test('boxes side by side render parallel text in two, three or four cards', () => {
  for (const count of [2, 3, 4]) {
    const l = normalizeLayout({ blocks: [{ type: 'columns', count, boxes: Array.from({ length: count }, (_, i) => ({ title: `Box ${i + 1}`, text: `Text ${i + 1}` })) }] });
    const out = renderSpacePage({ title: 't', layout: l, css: CSS });
    assert.match(out, new RegExp(`class="wb-cols" style="--n:${count}"`));
    for (let i = 1; i <= count; i += 1) assert.match(out, new RegExp(`<h3>Box ${i}</h3><p>Text ${i}</p>`));
  }
});

test('user text is escaped everywhere: no markup, no script, no broken attribute or embedded layout', () => {
  const evil = '</script><script>alert(1)</script><img src=x onerror=alert(2)>"\'';
  const l = normalizeLayout({
    datasets: [{ id: 'd1', name: evil, columns: [evil, evil], rows: [[evil, evil]] }],
    blocks: [
      { type: 'heading', text: evil, sub: evil }, { type: 'text', title: evil, text: evil }, { type: 'quote', text: evil, by: evil },
      { type: 'callout', title: evil, text: evil }, { type: 'columns', title: evil, boxes: [{ title: evil, text: evil }] },
      { type: 'kpis', items: [{ label: evil, value: evil, delta: evil, trend: evil }] }, { type: 'table', title: evil, dataset: 'd1' },
      { type: 'chart', title: evil, sub: evil, dataset: 'd1' }, { type: 'progress', title: evil, items: [{ label: evil, value: 1, max: 2 }] },
      { type: 'steps', title: evil, items: [{ title: evil, text: evil }] }, { type: 'timeline', title: evil, items: [{ when: evil, title: evil, text: evil }] },
      { type: 'compare', title: evil, left: { title: evil, lines: evil }, right: { title: evil, lines: evil } },
      { type: 'matrix', title: evil, xLabel: evil, yLabel: evil, points: [{ label: evil, x: 1, y: 1 }] },
      { type: 'accordion', title: evil, items: [{ title: evil, text: evil }] }, { type: 'ask', label: evil, prompt: evil },
    ],
  });
  const out = renderSpacePage({ title: evil, layout: l, css: CSS });
  assert.equal((out.match(/<script/g) ?? []).length, 2, 'only the layout and the ask script');
  assert.doesNotMatch(out, /<img src=x/);
  assert.doesNotMatch(out, /<script>alert/);
  assert.deepEqual(layoutFromHtml(out), l, 'the embedded layout survives hostile text');
});

test('richHtml: paragraphs, bullets, bold, escaping; esc and fmtNumber', () => {
  assert.equal(richHtml('a **b** <i>\n\n- x\n- y'), '<p>a <strong>b</strong> &lt;i&gt;</p><ul><li>x</li><li>y</li></ul>');
  assert.equal(richHtml('   '), '');
  assert.equal(esc(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
  assert.equal(fmtNumber(1234), '1,234');
  assert.equal(fmtNumber(12900), '12.9K');
  assert.equal(fmtNumber(4_200_000), '4.2M');
  assert.equal(fmtNumber(0.456), '0.46');
});

test('KPI trends and limit meters carry words, not only colour', () => {
  const l = normalizeLayout({ blocks: [
    { type: 'kpis', items: [{ label: 'A', value: '1', delta: '+4%', tone: 'ok', trend: '1,2,3' }, { label: 'B', value: '2', delta: '-1', tone: 'bad', trend: '' }] },
    { type: 'progress', mode: 'limit', items: [{ label: 'Budget', value: 120, max: 100 }, { label: 'Seats', value: 90, max: 100 }, { label: 'Disk', value: 10, max: 100 }] },
  ] });
  const out = renderSpacePage({ title: 't', layout: l, css: CSS });
  assert.match(out, /▲ \+4%/);
  assert.match(out, /▼ -1/);
  assert.match(out, /Over limit/);
  assert.match(out, /Close to limit/);
  assert.match(out, /class="wb-spark"/);
});

test('the Ask Joule button posts only a prompt the host accepts (600 characters at most)', () => {
  const l = normalizeLayout({ blocks: [{ type: 'ask', label: 'Go', prompt: 'p'.repeat(1000) }] });
  assert.equal(l.blocks[0].prompt.length, 600);
  const out = renderSpacePage({ title: 't', layout: l, css: CSS });
  assert.match(out, /window\.parent\.postMessage\(\{type:'wb:ask'/);
});

test('the chart colours are the reference palette, in light and dark', () => {
  const out = renderSpacePage({ title: 't', layout: emptyLayout(), css: CSS });
  for (const hex of ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#3987e5', '#9085e9']) assert.ok(out.includes(hex), hex);
  assert.match(out, /:root\[data-theme="dark"\]\{--wb-c1:#3987e5/);
});

test('an empty layout still gives a page with a card', () => {
  const out = renderSpacePage({ title: 'Empty', layout: emptyLayout(), css: CSS });
  assert.match(out, /class="card wb-empty"/);
  assert.deepEqual(layoutFromHtml(out), emptyLayout());
});

test('layoutFromHtml returns null for pages the Designer did not make', () => {
  assert.equal(layoutFromHtml(readFileSync(join(ROOT, 'examples/design-study/index.html'), 'utf8')), null);
  assert.equal(layoutFromHtml('<html></html>'), null);
  assert.equal(layoutFromHtml('<script type="application/json" id="wb-layout">{broken</script>'), null);
});

test('every template is valid, renders, and uses only datasets it has', () => {
  assert.ok(LAYOUT_TEMPLATES.length >= 5);
  assert.equal(new Set(LAYOUT_TEMPLATES.map((t) => t.id)).size, LAYOUT_TEMPLATES.length);
  for (const t of LAYOUT_TEMPLATES) {
    assert.deepEqual(normalizeLayout(t.layout), t.layout, t.id);
    const out = renderSpacePage({ title: t.title, layout: t.layout, css: CSS });
    assert.doesNotMatch(out, /NaN|undefined/, t.id);
    for (const b of t.layout.blocks) if (b.type === 'table' || b.type === 'chart') assert.ok(t.layout.datasets.some((d) => d.id === b.dataset), `${t.id}: ${b.type} data`);
  }
  const three = LAYOUT_TEMPLATES.find((t) => t.id === 'three-boxes');
  assert.equal(three.layout.blocks.find((b) => b.type === 'columns').count, 3);
});

/* ---------------------------------------------------------------- saving */

function memory(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    slugs: () => [...new Set([...store.keys()].map((k) => k.split('/')[0]))],
    read: (slug, file) => store.get(`${slug}/${file}`) ?? null,
    write: (slug, file, content) => { store.set(`${slug}/${file}`, content); },
  };
}

test('saving a new Space writes page and metadata, picks a free folder, and keeps nothing it was not given', () => {
  const files = memory({ 'quarterly-overview/index.html': '<html>hand-built</html>' });
  const result = saveDesignedSpace(files, CSS, { title: 'Quarterly overview', layout: LAYOUT_TEMPLATES[1].layout, domain: 'Finance' });
  assert.equal(result.slug, 'quarterly-overview-2');
  assert.equal(result.created, true);
  assert.ok(isDesignedPage(files.read(result.slug, 'index.html')));
  const meta = JSON.parse(files.read(result.slug, 'space.json'));
  assert.equal(meta.title, 'Quarterly overview');
  assert.equal(meta.domain, 'Finance');
  assert.match(meta.description, /blocks:/);
  assert.deepEqual(meta.insights, []);
  assert.equal(files.read('quarterly-overview', 'index.html'), '<html>hand-built</html>', 'the other Space is untouched');
});

test('saving again updates the same Space and keeps domain, parent and insights; the layout is checked on the server side too', () => {
  const files = memory();
  const first = saveDesignedSpace(files, CSS, { title: 'A', layout: emptyLayout() });
  files.write(first.slug, 'space.json', JSON.stringify({ title: 'A', parent: 'ai-control-tower', domain: 'Sales', insights: ['one'], description: 'mine' }));
  const second = saveDesignedSpace(files, CSS, { slug: first.slug, title: 'A renamed', layout: { blocks: [{ type: 'script' }, { type: 'divider' }] } });
  assert.equal(second.slug, first.slug);
  assert.equal(second.created, false);
  assert.ok(second.notes.some((n) => /unknown type/.test(n)));
  const meta = JSON.parse(files.read(first.slug, 'space.json'));
  assert.deepEqual({ title: meta.title, parent: meta.parent, domain: meta.domain, insights: meta.insights, description: meta.description }, { title: 'A renamed', parent: 'ai-control-tower', domain: 'Sales', insights: ['one'], description: 'mine' });
  assert.equal(layoutFromHtml(files.read(first.slug, 'index.html')).blocks.length, 1);
});

test('the Designer never overwrites a Space it did not make, and refuses bad names', () => {
  const files = memory({ 'hand/index.html': '<html>hand-built</html>', 'hand/space.json': '{"title":"Hand"}' });
  assert.throws(() => saveDesignedSpace(files, CSS, { slug: 'hand', title: 'x', layout: emptyLayout() }), /not made in the Designer/);
  assert.equal(files.read('hand', 'index.html'), '<html>hand-built</html>');
  assert.throws(() => saveDesignedSpace(files, CSS, { slug: '../etc', title: 'x', layout: emptyLayout() }), /not valid/);
  assert.throws(() => saveDesignedSpace(files, CSS, { slug: 'gone', title: 'x', layout: emptyLayout() }), /does not exist/);
  const copy = saveDesignedSpace(files, CSS, { slug: 'hand', asNew: true, title: 'Hand', layout: emptyLayout() });
  assert.notEqual(copy.slug, 'hand');
  assert.equal(copy.created, true);
});

/* ---------------------------------------------------------------- Joule */

test('the prompt for Joule carries the layout, every block type and the rules', () => {
  const layout = everything();
  const prompt = layoutPrompt('My "Space"', layout, 'Make it three boxes');
  for (const info of BLOCK_INFO) assert.ok(SCHEMA_HELP.includes(`${info.type}`), `schema mentions ${info.type}`);
  assert.match(prompt, /Make it three boxes/);
  assert.match(prompt, /```json/);
  assert.ok(prompt.includes(JSON.stringify(layout.blocks[0])));
  assert.match(prompt, /Do not invent figures/);
  assert.doesNotMatch(prompt, /My "Space"/, 'quotes in the title cannot break the prompt');
});

test('an answer from Joule is read from the last json block, checked, and described', () => {
  const before = everything();
  const proposed = { ...before, blocks: [...before.blocks.slice(0, 3), { id: 'b99', type: 'divider' }, { ...before.blocks[3], tone: 'bad' }] };
  const answer = parseLayoutAnswer(`Here you go:\n\`\`\`json\n${JSON.stringify(proposed)}\n\`\`\`\nI added a divider and made the note red.`);
  assert.ok(answer);
  assert.match(answer.message, /I added a divider/);
  const diff = diffLayouts(before, answer.layout);
  assert.deepEqual(diff.added, ['divider']);
  assert.equal(diff.removed.length, before.blocks.length - 4);
  assert.ok(diff.changed.includes('note'));
  assert.match(diffText(diff), /^Adds divider; removes/);
  assert.equal(diffText(diffLayouts(before, before)), 'No change.');
  assert.equal(parseLayoutAnswer('I could not do that.'), null);
  assert.equal(parseLayoutAnswer('```json\n{"nothing":1}\n```'), null);
  assert.equal(parseLayoutAnswer('```json\n{broken\n```'), null);
  const bare = parseLayoutAnswer(JSON.stringify({ blocks: [{ type: 'text', text: 'x' }, { type: 'evil' }] }));
  assert.equal(bare.layout.blocks.length, 1);
  assert.ok(bare.notes.length > 0, 'what had to be dropped is reported');
});

test('a changed dataset counts as a change of the chart that shows it, and a new order is a change', () => {
  const before = everything();
  const chart = before.blocks.find((b) => b.type === 'chart');
  const after = setDataset(before, { ...before.datasets.find((d) => d.id === chart.dataset), rows: [['Jan', '1', '2']] });
  assert.deepEqual(diffLayouts(before, after).changed, ['chart']);
  assert.deepEqual(diffLayouts(before, moveBlock(before, before.blocks[0].id, 3)).changed, ['order of blocks']);
});

test('blockDefaults never returns an id or dataset id that is already taken', () => {
  let layout = emptyLayout();
  for (let i = 0; i < 5; i += 1) layout = addBlock(layout, i % 2 ? 'chart' : 'table').layout;
  const ids = layout.blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(layout.datasets.map((d) => d.id)).size, layout.datasets.length);
  const next = blockDefaults('table', layout);
  assert.ok(!ids.includes(next.block.id) && !layout.datasets.some((d) => d.id === next.dataset.id));
});
