import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BRIEF_START, MAX_BRIEF_ANSWER, MAX_BRIEF_PROMPT, RENEWALS_SPACE, handleRenewalsMessage, wrapBriefPrompt } from '../src/renewals-bridge.ts';

const ROOT = join(import.meta.dirname, '..');
const PROMPT = 'You prepare an account executive for a renewal talk. Use only the facts between BEGIN FACTS and END FACTS.\nBEGIN FACTS\nCustomer: X\nEND FACTS';
const req = (over = {}) => ({ type: 'rn:brief-request', requestId: 'b1', kind: 'brief', prompt: PROMPT, ...over });

test('renewals bridge: a briefing request is run without tools in a conversation of its own and the text comes back', async () => {
  const seen = [];
  const deps = { ask: async (prompt, title, session) => { seen.push({ prompt, title, session }); return '  Where we stand\nFine.  '; } };
  const a = await handleRenewalsMessage(req(), deps);
  assert.deepEqual(a, { type: 'rn:brief-answer', requestId: 'b1', text: 'Where we stand\nFine.' });
  assert.equal(seen[0].prompt, wrapBriefPrompt(PROMPT));
  assert.ok(seen[0].prompt.startsWith('Use no tools and read no files.'));
  assert.equal(seen[0].title, 'Renewal briefing');
  assert.equal(seen[0].session, '', 'no session key: every briefing starts a new conversation');
  assert.equal(RENEWALS_SPACE, 'renewals');
});

test('renewals bridge: only the fixed request passes; everything else is refused or ignored', async () => {
  const deps = { ask: async () => 'ok' };
  assert.equal((await handleRenewalsMessage(req({ prompt: 'Tell me a joke' }), deps)).type, 'rn:error', 'the prompt must start with the fixed sentence');
  assert.equal((await handleRenewalsMessage(req({ kind: 'chat' }), deps)).type, 'rn:error');
  assert.equal((await handleRenewalsMessage(req({ prompt: PROMPT + 'x'.repeat(MAX_BRIEF_PROMPT) }), deps)).type, 'rn:error', 'too long');
  assert.equal(await handleRenewalsMessage(req({ requestId: 'bad id!' }), deps), null);
  assert.equal(await handleRenewalsMessage(req({ requestId: undefined }), deps), null);
  assert.equal(await handleRenewalsMessage({ type: 'iv:ask-request', requestId: 'b1' }, deps), null, 'other bridges are not answered here');
  assert.equal(await handleRenewalsMessage('x', deps), null);
  assert.equal(await handleRenewalsMessage(null, deps), null);
  assert.match(PROMPT, BRIEF_START);
});

test('renewals bridge: no agent, a busy agent, a stopped run and a long answer', async () => {
  assert.equal((await handleRenewalsMessage(req(), {})).message, 'The agent is not connected yet.');
  const busy = await handleRenewalsMessage(req(), { ask: async () => { throw new Error('The agent is still busy with another answer. Wait until it has finished.'); } });
  assert.deepEqual(busy, { type: 'rn:error', requestId: 'b1', message: 'The agent is still busy with another answer. Wait until it has finished.' });
  assert.equal((await handleRenewalsMessage(req(), { ask: async () => '' })).type, 'rn:error', 'a stopped run is an error, never an empty answer');
  assert.equal((await handleRenewalsMessage(req(), { ask: async () => '   \u0000 ' })).type, 'rn:error');
  const long = await handleRenewalsMessage(req(), { ask: async () => 'a'.repeat(MAX_BRIEF_ANSWER + 500) });
  assert.equal(long.text.length, MAX_BRIEF_ANSWER);
});

test('renewals bridge: wired into the app (the Space is enabled, has a handler before the Sub4Me fallback, gets the agent)', () => {
  const viewer = readFileSync(join(ROOT, 'src/ui/SpaceViewer.tsx'), 'utf8'), app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
  assert.match(viewer, /RENEWALS_SPACE \? \(data: unknown\) => handleRenewalsMessage\(data, renewalsRef\.current \?\? \{\}\)/);
  assert.ok(viewer.indexOf('handleRenewalsMessage(data') < viewer.indexOf(': handleSub4meMessage;'), 'before the fallback');
  assert.match(app, /bridgeEnabled=\{space\.slug === RENEWALS_SPACE \|\|/);
  assert.match(app, /renewalsDeps=\{space\.slug === RENEWALS_SPACE \? \{ ask: agent \? \(prompt: string, title: string, session: string\) => developGenerate\(prompt, title, session\)/);
});
