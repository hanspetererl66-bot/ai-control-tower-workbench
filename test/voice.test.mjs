import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVoiceStore, isAppAudioRequest, MAX_AUDIO_BYTES, transcribeWithDeepgram } from '../electron/voice.mjs';

const fakeSafeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`), decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString() };
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const ok = (transcript) => json(200, { results: { channels: [{ alternatives: [{ transcript }] }] } });
const audio = Buffer.from([1, 2, 3]);

test('store keeps the key out of the public view and in its own encrypted file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'voice-')), 'voice.enc');
  const store = createVoiceStore({ file, safeStorage: fakeSafeStorage });
  assert.deepEqual(store.getPublic(), { language: 'de', speak: false, autoSend: false, hasKey: false });
  const saved = store.save({ key: '  secret-key  ', language: 'en', speak: true });
  assert.deepEqual(saved, { language: 'en', speak: true, autoSend: false, hasKey: true });
  assert.equal(store.getKey(), 'secret-key');
  assert.ok(!readFileSync(file).toString().includes('secret-key'));
  store.save({ autoSend: true });
  assert.equal(store.getKey(), 'secret-key', 'undefined key keeps the stored one');
  store.save({ key: '' });
  assert.equal(store.getPublic().hasKey, false);
  assert.equal(store.save({ language: 'fr' }).language, 'de');
});

test('store refuses plaintext when the keychain is unavailable', () => {
  const store = createVoiceStore({ file: join(mkdtempSync(join(tmpdir(), 'voice-')), 'v.enc'), safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false } });
  assert.throws(() => store.save({ key: 'x' }), /keychain/);
});

test('transcribe calls the EU endpoint with the key in the header only', async () => {
  const calls = [];
  const text = await transcribeWithDeepgram({ audio, mimeType: 'audio/webm;codecs=opus', key: 'k1', language: 'de', fetchImpl: async (url, init) => { calls.push({ url, init }); return ok('  Hallo Joule  '); } });
  assert.equal(text, 'Hallo Joule');
  assert.match(calls[0].url, /^https:\/\/api\.eu\.deepgram\.com\/v1\/listen\?model=nova-3&language=de/);
  assert.ok(!calls[0].url.includes('k1'));
  assert.equal(calls[0].init.headers.Authorization, 'Token k1');
  assert.equal(calls[0].init.headers['Content-Type'], 'audio/webm');
});

test('falls back to nova-2 on 400/422, and reports clear errors without leaking the key', async () => {
  const urls = [];
  const text = await transcribeWithDeepgram({ audio, mimeType: 'audio/webm', key: 'k', fetchImpl: async (url) => { urls.push(url); return urls.length === 1 ? json(422, {}) : ok('ok'); } });
  assert.equal(text, 'ok');
  assert.match(urls[1], /model=nova-2/);
  for (const [status, code] of [[401, 'auth'], [402, 'quota'], [429, 'rate'], [500, 'http']]) {
    await assert.rejects(transcribeWithDeepgram({ audio, mimeType: 'audio/webm', key: 'topsecret', fetchImpl: async () => json(status, {}) }), (e) => e.code === code && !e.message.includes('topsecret'));
  }
  await assert.rejects(transcribeWithDeepgram({ audio, mimeType: 'audio/webm', key: 'k', fetchImpl: async () => { throw new Error('boom k'); } }), (e) => e.code === 'network' && !e.message.includes('boom'));
});

test('input validation: key, size, empty, format', async () => {
  const f = async () => ok('x');
  await assert.rejects(transcribeWithDeepgram({ audio, mimeType: 'audio/webm', key: '', fetchImpl: f }), { code: 'no-key' });
  await assert.rejects(transcribeWithDeepgram({ audio: Buffer.alloc(0), mimeType: 'audio/webm', key: 'k', fetchImpl: f }), { code: 'empty' });
  await assert.rejects(transcribeWithDeepgram({ audio: Buffer.alloc(MAX_AUDIO_BYTES + 1), mimeType: 'audio/webm', key: 'k', fetchImpl: f }), { code: 'too-large' });
  await assert.rejects(transcribeWithDeepgram({ audio, mimeType: 'text/html', key: 'k', fetchImpl: f }), { code: 'bad-audio' });
  assert.equal(await transcribeWithDeepgram({ audio, mimeType: 'audio/webm', key: 'k', fetchImpl: async () => json(200, {}) }), '');
});

test('microphone is allowed for the app origin only, audio only, main frame only', () => {
  const appOrigin = 'http://localhost:5273';
  const base = { permission: 'media', appOrigin, details: { mediaTypes: ['audio'], isMainFrame: true, requestingUrl: 'http://localhost:5273/' } };
  assert.equal(isAppAudioRequest(base), true);
  assert.equal(isAppAudioRequest({ ...base, details: { ...base.details, mediaTypes: ['audio', 'video'] } }), false);
  assert.equal(isAppAudioRequest({ ...base, details: { ...base.details, isMainFrame: false } }), false);
  assert.equal(isAppAudioRequest({ ...base, details: { ...base.details, requestingUrl: 'http://evil.example/' } }), false);
  assert.equal(isAppAudioRequest({ ...base, permission: 'geolocation' }), false);
  assert.equal(isAppAudioRequest({ ...base, details: {} }), false);
});
