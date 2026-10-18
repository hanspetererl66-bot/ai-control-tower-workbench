import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanLine, createSpeechSplitter, speakableSentences, splitSentences } from '../src/voice-text.ts';

test('formatting marks, links, urls and emoji are not spoken', () => {
  assert.equal(cleanLine('## **Wichtig:** siehe [die Doku](https://example.com/x) 🚀'), 'Wichtig: siehe die Doku');
  assert.equal(cleanLine('- Punkt mit `code` und https://example.com/a?b=1 Ende'), 'Punkt mit code und Ende');
  assert.equal(cleanLine('> Zitat'), 'Zitat');
  assert.equal(cleanLine('1. Erster Schritt'), 'Erster Schritt');
});

test('sentences are split after . ! ? but not after abbreviations or ordinal numbers', () => {
  assert.deepEqual(splitSentences('Das gilt z. B. für Dr. Weber. Im 3. Quartal ist es anders! Wirklich? Ja.'),
    ['Das gilt z. B. für Dr. Weber.', 'Im 3. Quartal ist es anders!', 'Wirklich?', 'Ja.']);
});

test('code blocks and tables are skipped, even when they arrive in separate chunks', () => {
  const s = createSpeechSplitter();
  const out = [];
  for (const chunk of ['Hier ist der Code:\n``', '`js\nconst a = 1; // nicht vorlesen.\n``', '`\nDanach geht es weiter. ', 'Und noch ein Satz.\n| a | b |\n|---|---|\n| 1 | 2 |\nSchluss']) out.push(...s.push(chunk));
  out.push(...s.flush());
  assert.deepEqual(out, ['Hier ist der Code:', 'Danach geht es weiter.', 'Und noch ein Satz.', 'Schluss']);
});

test('sentences are released while the line is still streaming, but never inside half-written Markdown', () => {
  const s = createSpeechSplitter();
  assert.deepEqual(s.push('Erster Satz. Zweiter Sa'), ['Erster Satz.']);
  assert.deepEqual(s.push('tz ist länger. Dritter [Link'), ['Zweiter Satz ist länger.']);
  assert.deepEqual(s.push('](https://x.de) bleibt. '), ['Dritter Link bleibt.']);
  assert.deepEqual(s.flush(), []);
});

test('every list item and heading is its own sentence', () => {
  assert.deepEqual(speakableSentences('# Titel\n- eins\n- zwei\n\nEnde ohne Punkt'), ['Titel', 'eins', 'zwei', 'Ende ohne Punkt']);
});

test('an unfinished code fence at the end of the reply is dropped', () => {
  assert.deepEqual(speakableSentences('Vorher.\n```\nnoch offen'), ['Vorher.']);
});
