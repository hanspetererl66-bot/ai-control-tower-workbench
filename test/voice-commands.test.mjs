import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNavCommand, normalizeCommand } from '../src/voice-commands.ts';

const nav = (text) => parseNavCommand(text);

test('opens tabs of the AI Control Tower', () => {
  assert.deepEqual(nav('Zeig mir die roten Risiken'), { space: 'ai-control-tower', tab: 'risk', label: 'Risk & Compliance' });
  assert.equal(nav('Öffne die Agenten.')?.tab, 'repo');
  assert.equal(nav('Show me the budget')?.tab, 'gov');
  assert.equal(nav('go to token economics')?.tab, 'tokens');
});

test('opens Sub4Me and its tabs', () => {
  assert.deepEqual(nav('Öffne Sub4Me Tickets'), { space: 'sub4me', tab: 'tickets', label: 'Sub4Me Tickets' });
  assert.equal(nav('zeig mir die Verträge')?.tab, 'contracts');
  assert.deepEqual(nav('Öffne Sub4Me'), { space: 'sub4me', tab: undefined, label: 'Sub4Me' });
});

test('opens the other spaces', () => {
  assert.equal(nav('Wechsle zum Knowledge Graph')?.space, 'knowledge-graph');
  assert.equal(nav('Öffne den Skill Marketplace')?.space, 'skill-marketplace');
  assert.equal(nav('Zeig mir die Automatisierung')?.space, 'automation-dashboard');
  assert.equal(nav('open the call transcripts')?.space, 'call-transcripts');
  assert.equal(nav('Bitte öffne die E-Mails')?.space, 'customer-emails');
});

test('questions and requests for the agent are not commands', () => {
  assert.equal(nav('Welche Agenten sind gerade im roten Status?'), null);
  assert.equal(nav('Liste alle Sub4Me-Tickets'), null);
  assert.equal(nav('Zeig mir'), null);
  assert.equal(nav('Öffne die Tür'), null);
  assert.equal(nav('Zeig mir alle Risiken, die unter vierzig Prozent mitigiert sind und erkläre mir, warum die CFR gestiegen ist'), null);
});

test('normalizes umlauts and punctuation', () => {
  assert.equal(normalizeCommand('Öffne die Verträge!'), 'oeffne die vertraege');
});
