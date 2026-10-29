import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../src/chat-context.ts';
import * as m from '../src/memory.ts';

test('expandCommand fills args, memory and approvals; unknown commands pass through', () => {
  const cmds = c.allCommands([{ name: 'x', prompt: 'Do {args} now' }]);
  assert.equal(c.expandCommand('/x the thing', cmds, { memory: '', approvals: 0 }), 'Do the thing now');
  assert.match(c.expandCommand('/briefing', cmds, { memory: '- About me: Sales lead', approvals: 3 }), /Sales lead[\s\S]*3\./);
  assert.equal(c.expandCommand('/nope', cmds, { memory: '', approvals: 0 }), null);
  assert.equal(c.expandCommand('hello /x', cmds, { memory: '', approvals: 0 }), null);
  const plain = c.allCommands([{ name: 'y', prompt: 'Ask' }]);
  assert.equal(c.expandCommand('/y more', plain, { memory: '', approvals: 0 }), 'Ask\n\nmore');
});

test('own command beats built-in; invalid names are refused', () => {
  const r = c.addCommand([], '/Board', 'Mine');
  assert.equal(c.allCommands(r.commands).find((x) => x.name === 'board').prompt, 'Mine');
  assert.ok(c.addCommand([], 'bad name', 'x').error);
  assert.ok(c.addCommand([], 'ok', '  ').error);
});

test('personas: add, choose, remove; note only when one is active', () => {
  let s = { active: '', custom: [] };
  assert.equal(c.personaNote(s), '');
  s = { ...s, active: 'executive' };
  assert.match(c.personaNote(s), /Executive/);
  const r = c.addPersona(s, 'Presales', 'Talk like a solution architect.');
  s = { ...r.state, active: r.state.custom[0].id };
  assert.match(c.personaNote(s), /Presales/);
  assert.ok(c.addPersona(s, 'executive', 'dup').error);
  assert.equal(c.removePersona(s, s.active).active, '');
});

test('memory per Space and agreed level appear in the note', () => {
  let st = m.addMemory(m.EMPTY_MEMORY, 'context', 'Green means renewal safe').state;
  st = m.addMemory(st, 'context', 'In Renewals red means churn risk', new Date(), 'renewals').state;
  assert.ok(!m.memoryNote(st).includes('churn risk'));
  assert.match(m.memoryNote(st, 'renewals'), /churn risk.*\[this Space\]/);
  const id = st.entries[1].id;
  assert.match(m.memoryNote(st, 'renewals', (x) => (x === id ? 0 : 1), ['Personal', 'Team']), /\[agreed: Team\]/);
});

test('suggestions from a whole conversation are unique and skip dismissed ones', () => {
  const texts = ['Ich leite den Vertrieb EMEA', 'Frage', 'Ich leite den Vertrieb EMEA', 'Antworte bitte immer kurz'];
  const out = m.suggestFromConversation(texts, m.EMPTY_MEMORY);
  assert.equal(out.length, 2);
  assert.equal(m.suggestFromConversation(texts, m.EMPTY_MEMORY, [out[0].text]).length, 1);
});
