import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMail, createHotlineMail, MailError, rawMessage, readFields } from '../shared/hotline-mail.mjs';

const F = { id: 'CHG-1040', customer: 'Muster Industrie AG', task: 'Renew a TLS certificate', target: 'proxy-edge-01', start: '2026-10-28T22:00', end: '2026-10-29T00:00' };
const dir = mkdtempSync(join(tmpdir(), 'hm-'));
const file = join(dir, 'hotline-mail.json');
writeFileSync(file, JSON.stringify({ to: 'test@example.com' }));
const ENV = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r' };
const decodeRaw = (raw) => Buffer.from(raw, 'base64url').toString('utf8');

function fakeFetch(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    return { ok: true, json: async () => ({ id: 'msg-1' }) };
  };
}

test('the text is fixed and carries the window; it is marked as a test', () => {
  const m = buildMail(F, 'test@example.com');
  assert.match(m.subject, /^\[TEST\] Downtime window confirmed: Renew a TLS certificate on proxy-edge-01 \(CHG-1040\)$/);
  assert.match(m.body, /Window: {2}2026-10-28 22:00 to 2026-10-29 00:00/);
  assert.match(m.body, /real customer has not been contacted/);
});

test('incomplete or invalid fields are refused', () => {
  assert.throws(() => readFields({ ...F, id: 'bad id!' }), MailError);
  assert.throws(() => readFields({ ...F, customer: '' }), MailError);
  assert.throws(() => readFields({ ...F, start: 'tomorrow' }), MailError);
  assert.throws(() => readFields({ ...F, end: F.start }), /window/);
  assert.throws(() => readFields(null), MailError);
});

test('line breaks and markup in a field cannot add headers or lines', () => {
  const m = buildMail({ ...F, customer: 'Evil\r\nBcc: x@y.z <b>', target: 'a\nb' }, 'test@example.com');
  assert.ok(!/\r|Bcc: x@y\.z/.test(m.subject + m.body.split('\n')[4]));
  const raw = decodeRaw(rawMessage({ ...m, subject: 'Hi\r\nBcc: x@y.z' }));
  assert.equal(raw.split('\r\n\r\n')[0].split('\r\n').filter((l) => /^Bcc:/i.test(l)).length, 0);
  assert.throws(() => rawMessage({ to: 'a@b.c\r\nBcc: x@y.z', subject: 's', body: 'b' }), MailError);
});

test('send: asks first, sends once through the Gmail API with the fixed recipient and writes the log', async () => {
  const calls = [], logs = [], asked = [];
  const hm = createHotlineMail({ recipientFile: file, env: ENV, confirm: async (m) => { asked.push(m); return true; }, log: (e) => logs.push(e), fetchImpl: fakeFetch(calls), now: () => new Date('2026-11-12T10:00:00Z') });
  const res = await hm.send({ ...F, to: 'attacker@example.com' });
  assert.deepEqual(res, { sent: true, at: '2026-11-12T10:00:00.000Z', to: 'test@example.com' });
  assert.equal(asked.length, 1);
  const send = calls.find((c) => c.url.endsWith('/users/me/messages/send'));
  assert.equal(send.init.method, 'POST');
  const raw = decodeRaw(JSON.parse(send.init.body).raw);
  assert.match(raw, /^To: test@example\.com\r\n/);
  assert.ok(!raw.includes('attacker@example.com'));
  assert.deepEqual(logs, [{ at: '2026-11-12T10:00:00.000Z', to: 'test@example.com', subject: asked[0].subject, request: 'CHG-1040', messageId: 'msg-1' }]);
});

test('send: a declined dialog sends nothing and calls no API', async () => {
  const calls = [];
  const hm = createHotlineMail({ recipientFile: file, env: ENV, confirm: async () => false, fetchImpl: fakeFetch(calls) });
  assert.deepEqual(await hm.send(F), { sent: false, reason: 'declined' });
  assert.equal(calls.length, 0);
});

test('without a recipient file nothing is previewed or sent; without the Gmail login the API call fails', async () => {
  const none = createHotlineMail({ recipientFile: join(dir, 'missing.json'), env: ENV, confirm: async () => true });
  assert.throws(() => none.preview(F), /No test recipient/);
  await assert.rejects(none.send(F), /No test recipient/);
  const noLogin = createHotlineMail({ recipientFile: file, env: {}, confirm: async () => true, fetchImpl: fakeFetch([]) });
  await assert.rejects(noLogin.send(F), /not configured/);
});
