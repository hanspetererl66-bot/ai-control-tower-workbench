import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRows, checksOf, filterRows, moveSelection, nextSort, NO_FILTER, sortRows } from '../src/skill-table.ts';

const skills = [
  { name: 'sql-helper', description: 'Writes SQL for sales data', dir: 'sql-helper' },
  { name: 'lead-qualifier', description: 'Scores leads', dir: 'lead-qualifier' },
  { name: 'mail-polish', description: 'Polishes mail drafts', dir: 'mail-polish' },
];
const ck = (...s) => s.map((status, i) => ({ id: `c${i}`, status, detail: '' }));
const gov = {
  levels: ['Personal', 'Department', 'Company'],
  skills: { 'lead-qualifier': 1 }, seq: 3,
  requests: [
    { id: 1, skill: 'lead-qualifier', from: 1, to: 2, note: '', status: 'pending', createdAt: 20, checks: ck('pass', 'warn') },
    { id: 2, skill: 'lead-qualifier', from: 0, to: 1, note: '', status: 'approved', createdAt: 10, checks: ck('pass', 'fail') },
    { id: 3, skill: 'sql-helper', from: 0, to: 1, note: '', status: 'rejected', createdAt: 5 },
  ],
};

test('rows: level, status and the worst result of the newest review', () => {
  const rows = buildRows(skills, gov);
  const by = Object.fromEntries(rows.map((r) => [r.skill.name, r]));
  assert.equal(by['lead-qualifier'].level, 1);
  assert.equal(by['lead-qualifier'].status, 'review');
  assert.equal(by['lead-qualifier'].target, 2);
  assert.equal(by['lead-qualifier'].checks, 'warn', 'the newer request counts, not the old failure');
  assert.equal(by['sql-helper'].status, 'active');
  assert.equal(by['sql-helper'].checks, 'none', 'a request without a review says nothing');
  assert.equal(by['mail-polish'].level, 0);
  assert.equal(checksOf({ ...gov, requests: [{ ...gov.requests[1], createdAt: 99 }] }, 'lead-qualifier'), 'fail');
});

test('filter: search in name and description, level and status together', () => {
  const rows = buildRows(skills, gov);
  assert.deepEqual(filterRows(rows, { ...NO_FILTER, query: 'SQL' }).map((r) => r.skill.name), ['sql-helper']);
  assert.deepEqual(filterRows(rows, { ...NO_FILTER, query: 'drafts' }).map((r) => r.skill.name), ['mail-polish']);
  assert.deepEqual(filterRows(rows, { ...NO_FILTER, level: 1 }).map((r) => r.skill.name), ['lead-qualifier']);
  assert.deepEqual(filterRows(rows, { ...NO_FILTER, level: 0 }).map((r) => r.skill.name), ['sql-helper', 'mail-polish']);
  assert.deepEqual(filterRows(rows, { ...NO_FILTER, status: 'review' }).map((r) => r.skill.name), ['lead-qualifier']);
  assert.deepEqual(filterRows(rows, { query: 'x', level: 'all', status: 'all' }), []);
  assert.equal(filterRows(rows, NO_FILTER).length, 3);
});

test('sort: by every column, both directions, ties by name', () => {
  const rows = buildRows(skills, gov);
  const names = (key, dir) => sortRows(rows, key, dir).map((r) => r.skill.name);
  assert.deepEqual(names('name', 'asc'), ['lead-qualifier', 'mail-polish', 'sql-helper']);
  assert.deepEqual(names('name', 'desc'), ['sql-helper', 'mail-polish', 'lead-qualifier']);
  assert.deepEqual(names('level', 'desc'), ['lead-qualifier', 'mail-polish', 'sql-helper']);
  assert.deepEqual(names('status', 'desc')[0], 'lead-qualifier');
  assert.deepEqual(names('checks', 'desc')[0], 'lead-qualifier');
  assert.equal(rows[0].skill.name, 'sql-helper', 'the input is not changed');
});

test('sort header: the same column flips, another one starts ascending', () => {
  assert.deepEqual(nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'name', dir: 'desc' }, 'name'), { key: 'name', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'name', dir: 'desc' }, 'level'), { key: 'level', dir: 'asc' });
});

test('keys: arrows, Home and End move the selection and stop at the ends', () => {
  const n = ['a', 'b', 'c'];
  assert.equal(moveSelection(n, 'a', 'ArrowDown'), 'b');
  assert.equal(moveSelection(n, 'c', 'ArrowDown'), 'c');
  assert.equal(moveSelection(n, 'a', 'ArrowUp'), 'a');
  assert.equal(moveSelection(n, 'b', 'End'), 'c');
  assert.equal(moveSelection(n, 'b', 'Home'), 'a');
  assert.equal(moveSelection(n, null, 'ArrowDown'), 'a');
  assert.equal(moveSelection(n, null, 'ArrowUp'), 'c');
  assert.equal(moveSelection(n, 'b', 'x'), null);
  assert.equal(moveSelection([], null, 'ArrowDown'), null);
});

test('wiring: the Skills tab is a table with a side panel, the old board, steps and rings views are gone', () => {
  const ui = readFileSync(new URL('../src/ui/SkillGovernance.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  assert.match(ui, /className="sgov-table"/);
  assert.match(ui, /aria-sort=/);
  assert.match(ui, /aria-label="Selected skill"/);
  assert.match(ui, /Skills <span className="sgov-n">/);
  assert.doesNotMatch(ui, /MapView|sgov-rings|sgov-board|Organization map/);
  assert.match(css, /\.sgov-layout \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 380px/);
  assert.doesNotMatch(css, /\.sgov-board|\.sgov-ring\b|\.sgov-views/);
  const block = css.slice(css.indexOf('/* ---------- skills: table with a side panel'), css.indexOf('.sgov-empty {'));
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, 'tokens only in the new rules');
});
