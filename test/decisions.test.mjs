import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const DIR = join(import.meta.dirname, '../docs/decisions');
const read = (name) => readFileSync(join(DIR, name), 'utf8');
const files = readdirSync(DIR).filter((f) => /^\d{3}-.+\.md$/.test(f)).sort();
const STATUS = ['vorgeschlagen', 'entschieden', 'abgelöst'];
const entry = (f) => {
  const s = read(f);
  const head = /^# (\d{3}) (.+)$/m.exec(s);
  const field = (name) => new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, 'm').exec(s)?.[1] ?? '';
  return { f, s, nr: head?.[1], title: head?.[2], status: field('Status'), date: field('Datum'), who: field('Entscheider') };
};
const entries = files.map(entry);

test('the decision log has entries, numbered without gaps, and the file name starts with the number in its title', () => {
  assert.ok(entries.length >= 10);
  entries.forEach((e, i) => {
    assert.equal(e.nr, String(i + 1).padStart(3, '0'), `${e.f} is number ${i + 1}`);
    assert.ok(e.f.startsWith(`${e.nr}-`), `${e.f} starts with its number`);
  });
});

test('every entry has status, date, decider and the five sections; the status is one of the known ones', () => {
  for (const e of entries) {
    assert.ok(STATUS.some((s) => e.status.startsWith(s)), `${e.f}: status "${e.status}"`);
    assert.ok(e.date && e.who, `${e.f}: date and decider`);
    for (const part of ['Frage', 'Entscheidung', 'Grund', 'Folgen', 'Quellen']) assert.match(e.s, new RegExp(`^\\*\\*${part}:\\*\\* \\S`, 'm'), `${e.f}: ${part}`);
  }
});

test('a superseded entry names an existing entry that replaces it', () => {
  for (const e of entries.filter((x) => x.status.startsWith('abgelöst'))) {
    const by = /durch (\d{3})/.exec(e.status)?.[1];
    assert.ok(by && entries.some((x) => x.nr === by && x.nr !== e.nr), `${e.f}: replaced by an existing entry`);
  }
});

test('the overview lists every entry once with its title, link and status, and the template exists', () => {
  const readme = read('README.md');
  for (const e of entries) {
    const row = readme.split('\n').find((l) => l.startsWith(`| ${e.nr} |`));
    assert.ok(row, `${e.f} is in the overview`);
    assert.ok(row.includes(`[${e.title}](${e.f})`), `${e.f}: title and link in the row`);
    assert.ok(row.includes(`| ${e.status} |`), `${e.f}: status in the row`);
  }
  assert.equal(readme.split('\n').filter((l) => /^\| \d{3} \|/.test(l)).length, entries.length, 'no row without a file');
  assert.match(read('TEMPLATE.md'), /\*\*Status:\*\*/);
});

test('an open question is marked as such and a decided entry never says "offen" in its decision', () => {
  for (const e of entries) {
    const decision = /\*\*Entscheidung:\*\* (.+)/.exec(e.s)?.[1] ?? '';
    if (e.status.startsWith('entschieden')) assert.doesNotMatch(decision, /^Offen\b/, `${e.f} is decided but its decision says "Offen"`);
  }
});

test('CLAUDE.md points to the decision log and stays short', () => {
  const claude = readFileSync(join(import.meta.dirname, '../CLAUDE.md'), 'utf8');
  assert.match(claude, /docs\/decisions\//);
  assert.ok(claude.split('\n').length < 90, 'CLAUDE.md stays short');
});
