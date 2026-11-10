import test from 'node:test';
import assert from 'node:assert/strict';
import { chatMail, chatMailtoUrl } from '../src/chat-mail.ts';

const conversation = {
  title: 'Renewal risks Q4',
  files: [],
  messages: [
    { role: 'user', text: 'Which renewals are red?' },
    { role: 'agent', text: 'Three renewals are red:\n\n- Acme\n- Globex\n- Initech' },
  ],
};

test('chatMail builds subject, body and attachment', () => {
  const mail = chatMail(conversation, 'Joule', Date.UTC(2026, 10, 10));
  assert.equal(mail.subject, 'Conversation: Renewal risks Q4');
  assert.equal(mail.fileName, 'renewal-risks-q4-2026-11-10.md');
  assert.match(mail.body, /about "Renewal risks Q4"/);
  assert.match(mail.body, /Three renewals are red: - Acme/);
  assert.match(mail.markdown, /## Joule/);
});

test('chatMail works without an answer and clips long ones', () => {
  assert.doesNotMatch(chatMail({ title: 'x', files: [], messages: [] }).body, /In short/);
  const long = chatMail({ ...conversation, messages: [{ role: 'agent', text: 'a'.repeat(900) }] });
  assert.ok(long.body.length < 600);
});

test('chatMailtoUrl asks to attach the file', () => {
  const url = chatMailtoUrl(chatMail(conversation, 'Joule', 0));
  assert.ok(url.startsWith('mailto:?subject='));
  assert.match(decodeURIComponent(url), /Please attach the file/);
});
