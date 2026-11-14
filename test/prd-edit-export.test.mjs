import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { addSection, buildPrd, deleteSection, moveSection, prdFacts, renumber, sections, toggleBold, toggleLines } from '../examples/prd-builder/prd-model.mjs';
import { bodyOf, docxFileName, markdownToDocx, MAX_MARKDOWN } from '../electron/docx.mjs';
import { readZip } from '../electron/skill-package.mjs';
import { handlePrdMessage } from '../src/prd-bridge.ts';
import { fromLinear, fromNotion, fromSlack } from '../src/prd-sources.ts';

const ROOT = join(import.meta.dirname, '..');
const page = readFileSync(join(ROOT, 'examples/prd-builder/index.html'), 'utf8');
const demo = JSON.parse(readFileSync(join(ROOT, 'examples/prd-builder/demo-sources.json'), 'utf8'));
const doc = '# T\n\nintro\n\n## 1. A\n\n- a\n\n## 2. B\n\nb\n\n## 3. C\n\nc\n';

test('editing: lines get a heading, bullet, number or quote and lose it again; bold wraps and unwraps', () => {
  assert.deepEqual(toggleLines('x\ny', 0, 3, 'bullet'), { text: '- x\n- y', start: 0, end: 7 });
  assert.equal(toggleLines('- x\n- y', 0, 7, 'bullet').text, 'x\ny', 'again takes it off');
  assert.equal(toggleLines('x\n\ny', 0, 4, 'number').text, '1. x\n\n2. y', 'numbers count the lines with text');
  assert.equal(toggleLines('- x', 0, 3, 'h2').text, '## x', 'another kind replaces the old mark');
  assert.equal(toggleLines('## x', 0, 4, 'h3').text, '### x');
  assert.equal(toggleLines('a\nb\nc', 2, 3, 'quote').text, 'a\n> b\nc', 'only the lines the selection touches');
  assert.equal(toggleLines('a\nb', 0, 2, 'quote').text, '> a\nb', 'a selection that ends at a line start does not take the next line');
  assert.deepEqual(toggleBold('hello world', 6, 11), { text: 'hello **world**', start: 8, end: 13 });
  assert.equal(toggleBold('hello **world**', 8, 13).text, 'hello world');
  assert.equal(toggleBold('', 0, 0).text, '**bold text**');
  assert.equal(toggleLines('x', 0, 1, 'unknown').text, 'x');
});

test('sections: move, delete and add keep the numbering and the text before the first section', () => {
  const s = sections(doc);
  assert.deepEqual(s.list.map((h) => h.title), ['A', 'B', 'C']);
  assert.equal(s.pre, '# T\n\nintro\n\n');
  assert.equal(moveSection(doc, 0, 1), '# T\n\nintro\n\n## 1. B\n\nb\n\n## 2. A\n\n- a\n\n## 3. C\n\nc\n');
  assert.equal(moveSection(doc, 0, -1), doc, 'the first one cannot move up');
  assert.equal(moveSection(doc, 2, 1), doc, 'the last one cannot move down');
  assert.equal(deleteSection(doc, 1), '# T\n\nintro\n\n## 1. A\n\n- a\n\n## 2. C\n\nc\n');
  assert.match(addSection(doc, 'risks'), /## 4\. Risks\n\n- To be defined\.\n$/);
  assert.equal(addSection(doc, 'nope'), doc);
  assert.equal(renumber('## 5. X\n\n### 1. not a section\n\n## 9. Y\n## Plain'), '## 1. X\n\n### 1. not a section\n\n## 2. Y\n## Plain');
  assert.equal(sections('no sections at all').list.length, 0);
  // a generated PRD survives a round of moves: nothing is lost
  const md = buildPrd({ project: 'P', issues: [{ key: 'A-1', type: 'Story', summary: 's', description: 'As a seller I want x.\nAcceptance criteria\n- y', priority: 'High', parentKey: null }], selectedKeys: ['A-1'], today: '2026-11-14' });
  const moved = moveSection(moveSection(md, 3, 1), 4, -1);
  assert.equal(moved.split('\n').sort().join('\n'), md.split('\n').sort().join('\n'));
});

test('facts before confirming: title, requirements, notes, sources, open questions and length', () => {
  const issues = [...fromLinear(demo.linear), ...fromSlack(demo.slack.messages, 'sales-feedback'), ...fromNotion(demo.notion)];
  const md = buildPrd({ project: 'Mixed', issues, selectedKeys: issues.map((i) => i.key), today: '2026-11-14' });
  const f = prdFacts(md);
  assert.equal(f.title, 'Mixed');
  assert.equal(f.requirements, 10); assert.equal(f.notes, 6);
  assert.equal(f.sources, 14);
  assert.ok(f.open.length >= 6 && f.open.every((q) => typeof q === 'string'));
  assert.ok(f.words > 200 && f.sections === 7);
  assert.deepEqual(prdFacts('').open, []);
  assert.equal(prdFacts(buildPrd({ project: 'A', issues: [], selectedKeys: [], today: 'd' })).open.length, 0);
});

test('docx: a valid package of the right parts with the text in it', () => {
  const md = '# Product requirements: A & B\n\nIntro with **bold** and *italic* and <tags> & "quotes".\n\n## 1. Goals\n\n- first\n- second\n\n### Detail\n\n1. one\n2. two\n\ntext\n\n1. restart\n\n> a quote\n';
  const buf = markdownToDocx(md, { title: 'PRD – A & B', now: new Date('2026-11-14T10:00:00Z') });
  const files = readZip(buf);
  assert.deepEqual(files.map((f) => f.path), ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml']);
  const { window } = new JSDOM('');
  for (const f of files) {
    const parsed = new window.DOMParser().parseFromString(f.data.toString('utf8'), 'application/xml');
    assert.equal(parsed.getElementsByTagName('parsererror').length, 0, `${f.path} is well-formed XML`);
  }
  const text = (p) => files.find((f) => f.path === p).data.toString('utf8');
  const d = text('word/document.xml');
  assert.match(d, /<w:pStyle w:val="Title"\/>/); assert.match(d, /<w:pStyle w:val="Heading1"\/>/); assert.match(d, /<w:pStyle w:val="Heading2"\/>/);
  assert.equal((d.match(/w:val="ListBullet"/g) || []).length, 2);
  assert.equal((d.match(/w:val="ListNumber"/g) || []).length, 3);
  assert.match(d, /<w:b\/><\/w:rPr><w:t xml:space="preserve">bold<\/w:t>/); assert.match(d, /<w:i\/><\/w:rPr><w:t xml:space="preserve">italic<\/w:t>/);
  assert.match(d, /&lt;tags&gt; &amp; &quot;quotes&quot;/); assert.doesNotMatch(d, /<tags>/);
  assert.match(d, /w:numId w:val="101"[\s\S]*w:numId w:val="101"[\s\S]*w:numId w:val="102"/, 'the second numbered list restarts');
  assert.match(text('word/numbering.xml'), /w:numId="101"[\s\S]*w:numId="102"/);
  assert.match(text('docProps/core.xml'), /<dc:title>PRD – A &amp; B<\/dc:title>/); assert.match(text('docProps/core.xml'), /<dc:creator>Werkbank<\/dc:creator>/);
  assert.match(d, /<w:sectPr>/);
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
});

test('docx: control characters are dropped, an empty text still gives a document, a huge text is refused, file names are safe', () => {
  assert.doesNotMatch(bodyOf('a\u0000b\u0007c').xml, /[\u0000-\u0008]/);
  assert.equal(readZip(markdownToDocx('')).length, 7);
  assert.throws(() => markdownToDocx('x'.repeat(MAX_MARKDOWN + 1)), /too long/);
  assert.equal(docxFileName('Product requirements: Linear SAL + Slack #sales-feedback'), 'Product-requirements-Linear-SAL-Slack-sales-feedback.docx');
  assert.equal(docxFileName('../../etc/passwd'), 'etc-passwd.docx');
  assert.equal(docxFileName('Übersicht Größe'), 'Ubersicht-Gro-e.docx');
  assert.equal(docxFileName(''), 'document.docx');
  assert.ok(docxFileName('x'.repeat(300)).length <= 85);
});

test('bridge: saving as Word needs the host, the confirmation and a text of sensible size; the person decides in the dialog', async () => {
  const got = [];
  const host = { exportDocx: async (p) => { got.push(p); return { ok: true, path: '/tmp/x.docx', bytes: 4096 }; } };
  const ask = (data, h = host) => handlePrdMessage({ type: 'prd:export-docx', title: 'T', markdown: '# T\n', confirmed: true, ...data }, undefined, h);
  assert.deepEqual(await ask({}), { type: 'prd:exported', ok: true, path: '/tmp/x.docx', bytes: 4096, detail: '' });
  assert.deepEqual(got, [{ title: 'T', markdown: '# T\n' }]);
  assert.match((await ask({ confirmed: false })).detail, /Confirm the document first/);
  assert.match((await ask({ confirmed: undefined })).detail, /Confirm the document first/);
  assert.match((await ask({ markdown: '   ' })).detail, /nothing to save/);
  assert.match((await ask({ markdown: 'x'.repeat(100_001) })).detail, /too long/);
  assert.match((await ask({}, null)).detail, /works in the Werkbank app/);
  assert.equal(got.length, 1, 'the host was only asked once');
  assert.deepEqual(await ask({}, { exportDocx: async () => ({ ok: false, canceled: true }) }), { type: 'prd:exported', ok: false, canceled: true });
  assert.equal((await ask({}, { exportDocx: async () => ({ ok: false, detail: 'disk full' }) })).detail, 'disk full');
  assert.match((await ask({}, { exportDocx: async () => { throw new Error('boom'); } })).detail, /boom/);
});

function open() {
  const sent = [], errors = [];
  const dom = new JSDOM(page, { runScripts: 'dangerously', beforeParse(w) { Object.defineProperty(w, 'parent', { value: { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } }); w.addEventListener('error', (e) => errors.push(e.message)); } });
  const w = dom.window, d = w.document;
  const reply = (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w.parent }));
  const click = (sel) => { const el = d.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); };
  const ta = d.querySelector('#prd');
  const select = (a, b) => { ta.focus(); ta.setSelectionRange(a, b); };
  const type = (v) => { ta.value = v; ta.dispatchEvent(new w.Event('input', { bubbles: true })); };
  return { w, d, sent, errors, reply, click, ta, select, type };
}

test('the page: toolbar, undo and redo, outline with move, delete and add', () => {
  const p = open(); const { d, ta } = p;
  p.click('#demo');
  const first = ta.value;
  assert.ok(d.querySelectorAll('#outline li').length >= 7, 'one row per section');
  assert.equal(d.querySelector('#undo').disabled, true);
  // toolbar: a sub heading on the first line, bold on a word
  p.select(0, 0); p.click('[data-ed=h3]');
  assert.match(ta.value, /^### Product requirements/);
  assert.equal(d.querySelector('#undo').disabled, false);
  p.click('#undo'); assert.equal(ta.value, first); assert.equal(d.querySelector('#redo').disabled, false);
  p.click('#redo'); assert.match(ta.value, /^### Product/);
  p.click('#undo');
  p.select(2, 9); p.click('[data-ed=bold]'); assert.match(ta.value, /^# \*\*Product\*\*/);
  p.click('#undo');
  // keyboard
  p.select(0, 0);
  ta.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.match(ta.value, /\*\*bold text\*\*/);
  ta.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(ta.value, first);
  // typing is one undo step after a short pause (the stack takes the text as it is)
  p.type(first + 'extra');
  // outline: move section 2 down, then undo; delete; add
  const titles = () => [...d.querySelectorAll('#outline .olink')].map((b) => b.textContent);
  const before = titles();
  p.click('#undo'); p.click('#undo');
  p.type(first);
  p.click('#outline [data-mv="1"][data-i="1"]');
  assert.deepEqual(titles().slice(0, 3), [before[0], before[2], before[1]]);
  assert.match(ta.value, /## 2\. Goals|## 2\. Users|## 2\. /);
  p.click('#undo'); assert.deepEqual(titles(), before);
  p.click(`#outline [data-del="0"]`);
  assert.equal(titles().length, before.length - 1);
  assert.match(d.querySelector('#status').textContent, /Undo brings it back/);
  p.click('#undo'); assert.equal(titles().length, before.length);
  const sel = d.querySelector('#addsec'); sel.value = 'risks'; sel.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  assert.equal(titles().at(-1), 'Risks'); assert.equal(sel.value, '');
  p.click('#outline [data-go="0"]');
  assert.equal(ta.selectionStart, ta.value.indexOf('## 1.'));
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('the page: confirm the PRD (with a warning for open questions), then save it as Word; a change takes the confirmation back', () => {
  const p = open(); const { d, ta } = p;
  assert.equal(d.querySelector('#word').disabled, true);
  p.click('#confirmBtn');
  assert.equal(d.querySelector('#cfwrap').hidden, true, 'no document, no dialog');
  p.click('#demoMulti');
  assert.equal(d.querySelector('#word').disabled, true);
  p.click('#confirmBtn');
  assert.equal(d.querySelector('#cfwrap').hidden, false);
  assert.match(d.querySelector('#cffacts').textContent, /Requirements10.*Open questions\d+/s);
  assert.match(d.querySelector('#cfopen').textContent, /open questions are still in the document/);
  assert.match(d.querySelector('#cfchecktext').textContent, /confirm the document anyway/);
  assert.equal(d.querySelector('#cfyes').disabled, true, 'nothing happens without the check mark');
  d.querySelector('#cfyes').click(); assert.equal(d.querySelector('#word').disabled, true);
  p.click('#cfno'); assert.equal(d.querySelector('#cfwrap').hidden, true); assert.equal(d.querySelector('#word').disabled, true);
  p.click('#confirmBtn'); p.click('#cfcheck'); assert.equal(d.querySelector('#cfyes').disabled, false);
  p.click('#cfyes');
  assert.equal(d.querySelector('#cfwrap').hidden, true); assert.equal(d.querySelector('#word').disabled, false);
  assert.match(d.querySelector('#confirmnote').textContent, /^Confirmed /);
  const confirmedText = ta.value;
  p.click('#word');
  const msg = p.sent.at(-1);
  assert.equal(msg.type, 'prd:export-docx'); assert.equal(msg.confirmed, true); assert.equal(msg.markdown, confirmedText); assert.match(msg.title, /Linear SAL/);
  p.reply({ type: 'prd:exported', ok: true, path: '/Users/x/Downloads/PRD.docx', bytes: 5300 });
  assert.match(d.querySelector('#status').textContent, /Saved as Word: \/Users\/x\/Downloads\/PRD\.docx \(5 KB\)/);
  p.reply({ type: 'prd:exported', ok: false, canceled: true });
  assert.match(d.querySelector('#status').textContent, /cancelled/);
  p.reply({ type: 'prd:exported', ok: false, detail: 'disk full' });
  assert.match(d.querySelector('#status').textContent, /disk full/);
  // a change takes the confirmation back; the file always holds the confirmed version
  p.type(ta.value + '\nOne more line.');
  assert.equal(d.querySelector('#word').disabled, true);
  assert.match(d.querySelector('#confirmnote').textContent, /Changed after the confirmation/);
  p.click('#undo'); p.click('#undo');
  assert.equal(ta.value, confirmedText);
  assert.equal(d.querySelector('#word').disabled, true, 'coming back to the same text does not confirm again by itself');
  // no open questions: a plain confirmation
  p.type('# T\n\n## 1. Open questions\n\n- None found from the tickets alone.\n');
  p.click('#confirmBtn');
  assert.equal(d.querySelector('#cfopen').textContent, ''); assert.match(d.querySelector('#cfchecktext').textContent, /I have read the document/);
  p.click('#cfno');
  assert.deepEqual(p.errors, []);
  p.w.close();
});
