import assert from 'node:assert/strict';
import test from 'node:test';
import { commentFor, isDone, labelsFor, loadLog, markerOf, notedAt, parseWriteback, record, saveLog, summaryOf, ticketsOf, writebackPrompt } from '../src/writeback.ts';

const ref = (source, key) => ({ source, key, title: `${key} t`, url: '' });
const item = { id: 'abcdef12-0000-4000-8000-000000000001', type: 'agent', name: 'Renewal watcher', rev: 3, stage: 'prd', approved: ['prd'], refs: [ref('jira', 'AB-1'), ref('slack', '#req 1700'), ref('jira', 'BC-22'), ref('jira', 'bad key')] };

test('only real Jira keys are tickets; labels have no spaces', () => {
  assert.deepEqual(ticketsOf(item).map((r) => r.key), ['AB-1', 'BC-22']);
  assert.equal(ticketsOf({ refs: Array.from({ length: 30 }, (_, i) => ref('jira', `AB-${i + 1}`)) }).length, 20);
  assert.deepEqual(labelsFor(item), ['werkbank', 'werkbank-agent']);
  assert.ok(labelsFor({ type: 'workflow' }).every((l) => /^[A-Za-z0-9_.:-]{1,60}$/.test(l)));
});

test('the comment names the entry, revision, state and what it extends; it has a marker and no e-mail address', () => {
  const c = commentFor({ ...item, extendsItem: { id: 'x', name: 'Contract upload' } });
  assert.ok(c.startsWith(markerOf(item))); assert.equal(markerOf(item), '[Werkbank abcdef12]');
  assert.match(c, /as agent "Renewal watcher"/); assert.match(c, /extends "Contract upload"/); assert.match(c, /revision 3, 1 step confirmed/);
  assert.doesNotMatch(c, /@/);
});

test('the prompt allows only the three tools and the listed tickets, and carries the comment verbatim', () => {
  const c = commentFor(item);
  const p = writebackPrompt(['AB-1', 'BC-22'], ['werkbank', 'werkbank-agent'], c);
  assert.match(p, /Tickets: AB-1, BC-22/); assert.match(p, /Labels to add: werkbank, werkbank-agent/);
  assert.ok(p.includes(`<<<COMMENT\n${c}\nCOMMENT>>>`));
  assert.match(p, /Use only jira_get_issue, jira_add_labels and jira_add_comment/);
  assert.match(p, /Never change the status/);
});

test('parseWriteback: one result per asked ticket, unknown tickets ignored, missing ones are not done', () => {
  const answer = '```json\n' + JSON.stringify({ results: [{ key: 'ab-1', labelled: true, commented: true }, { key: 'ZZ-9', labelled: true, commented: true }] }) + '\n```';
  const r = parseWriteback(answer, ['AB-1', 'BC-22']);
  assert.deepEqual(r.map((x) => x.key), ['AB-1', 'BC-22']);
  assert.equal(isDone(r[0]), true); assert.equal(isDone(r[1]), false); assert.match(r[1].error, /No answer/);
  assert.equal(parseWriteback('no json', ['AB-1']), null);
  assert.equal(parseWriteback('{"results":"x"}', ['AB-1']), null);
  assert.equal(isDone({ key: 'AB-1', labelled: true, commented: false, skipped: 'comment was there already', error: '' }), true);
  assert.equal(isDone({ key: 'AB-1', labelled: true, commented: true, skipped: '', error: 'boom' }), false);
  assert.equal(summaryOf(r), '1 of 2 tickets noted; failed: BC-22 (No answer for this ticket.).');
});

test('the log remembers what was written per entry and ticket, survives storage and ignores junk', () => {
  const results = [{ key: 'AB-1', labelled: true, commented: true, skipped: '', error: '' }, { key: 'BC-22', labelled: false, commented: false, skipped: '', error: 'x' }];
  const log = record({}, item.id, 3, results, 1000);
  assert.deepEqual(notedAt(log, item.id, 'AB-1'), { at: 1000, rev: 3 }); assert.equal(notedAt(log, item.id, 'BC-22'), null);
  const store = { v: '', setItem(_, v) { this.v = v; }, getItem() { return this.v; } };
  saveLog(store, { ...log, 'bad': { at: 1 } });
  assert.deepEqual(loadLog(store), log);
  assert.deepEqual(loadLog({ getItem: () => 'not json' }), {});
});
