import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Hält das Entscheidungsprotokoll (docs/decisions/) in sich stimmig:
// Übersicht in README.md und Einzelseiten dürfen nicht auseinanderlaufen.

const dir = new URL('../docs/decisions/', import.meta.url);
const STATUS = ['vorgeschlagen', 'entschieden', 'abgelöst'];

const files = readdirSync(dir).filter((f) => /^\d{3}-.+\.md$/.test(f)).sort();
const read = (f) => readFileSync(new URL(f, dir), 'utf8');

const rows = [...read('README.md').matchAll(/^\|\s*(\d{3})\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)]
  .map(([, nr, title, file, status, date, who]) => ({ nr, title, file, status, date, who }));

function page(f) {
  const text = read(f);
  const field = (name) => text.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, 'm'))?.[1].trim();
  return {
    text,
    heading: text.match(/^# (\d{3}) (.+)$/m),
    status: field('Status'),
    date: field('Datum'),
    who: field('Entscheider'),
  };
}

test('there are decision pages and the overview lists rows', () => {
  assert.ok(files.length > 0, 'no decision pages found');
  assert.ok(rows.length > 0, 'no table rows found in docs/decisions/README.md');
});

test('every decision page is listed in the overview, and every row points to a page', () => {
  assert.deepEqual(rows.map((r) => r.file).sort(), files,
    'README.md table and the files in docs/decisions/ differ (add the missing row or page)');
});

test('numbers are unique and run without gaps', () => {
  const nrs = files.map((f) => Number(f.slice(0, 3)));
  assert.equal(new Set(nrs).size, nrs.length, 'duplicate decision number');
  nrs.forEach((n, i) => assert.equal(n, i + 1, `numbers must run 001, 002, ... without gaps (found ${String(n).padStart(3, '0')} at position ${i + 1})`));
});

test('table rows match the number in their file name and the page heading', () => {
  for (const r of rows) {
    assert.equal(r.file.slice(0, 3), r.nr, `${r.file}: row number ${r.nr} differs from file name`);
    const p = page(r.file);
    assert.ok(p.heading, `${r.file}: first heading must read "# NNN Title"`);
    assert.equal(p.heading[1], r.nr, `${r.file}: heading number differs from file name`);
  }
});

test('status, date and decider on the page match the overview', () => {
  for (const r of rows) {
    const p = page(r.file);
    assert.ok(p.status, `${r.file}: line "- **Status:**" missing`);
    assert.ok(p.date, `${r.file}: line "- **Datum:**" missing`);
    assert.ok(p.who, `${r.file}: line "- **Entscheider:**" missing`);
    assert.equal(p.status, r.status, `${r.file}: status differs from README.md`);
    assert.equal(p.date, r.date, `${r.file}: date differs from README.md`);
    assert.equal(p.who, r.who, `${r.file}: decider differs from README.md`);
  }
});

test('status is one of the allowed values, and "abgelöst" names an existing successor', () => {
  for (const f of files) {
    const { status } = page(f);
    const base = status?.match(/^[a-zäöü]+/)?.[0];
    assert.ok(STATUS.includes(base), `${f}: unknown status "${status}"`);
    if (base === 'abgelöst') {
      const by = status.match(/\(durch (\d{3})\)/)?.[1];
      assert.ok(by, `${f}: "abgelöst" needs "(durch NNN)"`);
      assert.ok(files.some((g) => g.startsWith(`${by}-`)), `${f}: successor ${by} does not exist`);
      assert.notEqual(by, f.slice(0, 3), `${f}: cannot supersede itself`);
    }
  }
});

test('every page has the sections of the template', () => {
  for (const f of files) {
    const { text } = page(f);
    for (const s of ['Frage', 'Entscheidung', 'Grund', 'Folgen', 'Quellen']) {
      assert.match(text, new RegExp(`^\\*\\*${s}:\\*\\*`, 'm'), `${f}: section "${s}:" missing (see TEMPLATE.md)`);
    }
  }
});
