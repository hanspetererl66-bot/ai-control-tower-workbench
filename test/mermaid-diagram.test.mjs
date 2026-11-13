import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { codeLanguage, diagramKind, hasInitDirective, shouldDraw, stripPreamble } from '../src/mermaid-diagram.ts';

test('the four diagram kinds are recognised, others are not drawn', () => {
  assert.equal(diagramKind('flowchart TD\n  A --> B'), 'Flowchart');
  assert.equal(diagramKind('graph LR\n  A --> B'), 'Flowchart');
  assert.equal(diagramKind('gantt\n  title Plan'), 'Gantt chart');
  assert.equal(diagramKind('sequenceDiagram\n  A->>B: hi'), 'Sequence diagram');
  assert.equal(diagramKind('stateDiagram-v2\n  [*] --> A'), 'State diagram');
  for (const other of ['pie\n "a": 1', 'mindmap\n  root', '', '   ', 'hello world', 'constructor']) assert.equal(diagramKind(other), null, other);
});

test('front matter, directives and comments before the first word are skipped', () => {
  assert.equal(diagramKind('---\ntitle: Signup\n---\nflowchart TD\n A-->B'), 'Flowchart');
  assert.equal(diagramKind('%% a comment\nsequenceDiagram\n A->>B: x'), 'Sequence diagram');
  assert.equal(stripPreamble('\r\n%% c\r\ngantt\r\n'), 'gantt');
});

test('an init directive switches drawing off, so a diagram cannot change the security level', () => {
  const evil = "%%{init: {'securityLevel': 'loose'}}%%\nflowchart TD\n A-->B";
  assert.ok(hasInitDirective(evil));
  assert.ok(!shouldDraw(evil));
  assert.ok(shouldDraw('flowchart TD\n A-->B'));
  assert.ok(!shouldDraw('pie\n "a": 1'));
});

test('the code language comes from the react-markdown class', () => {
  assert.equal(codeLanguage('language-mermaid'), 'mermaid');
  assert.equal(codeLanguage('foo language-Mermaid'), 'mermaid');
  assert.equal(codeLanguage('language-ts'), 'ts');
  assert.equal(codeLanguage(undefined), null);
  assert.equal(codeLanguage('notlanguage-x'), null);
});

test('the chat draws mermaid blocks with strict security and colour tokens, and does not use the network', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies.mermaid, 'mermaid is a dependency');
  const md = readFileSync(new URL('../src/ui/ChatMarkdown.tsx', import.meta.url), 'utf8');
  assert.match(md, /codeLanguage\(.*\) === 'mermaid'/);
  assert.match(md, /<MermaidDiagram /);
  const ui = readFileSync(new URL('../src/ui/MermaidDiagram.tsx', import.meta.url), 'utf8');
  assert.match(ui, /securityLevel: 'strict'/);
  assert.doesNotMatch(ui, /securityLevel: 'loose'|fetch\(|XMLHttpRequest/);
  assert.match(ui, /get\('--ink'/);
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  assert.match(css, /\.mermaid-diagram\s*\{/);
});

import { DIAGRAM_NOTE, wantsDiagram } from '../src/mermaid-diagram.ts';

test('the hint for the agent is added only when a diagram is asked for', () => {
  for (const yes of ['Draw a flowchart of the signup', 'Zeichne ein Flussdiagramm für den Onboarding-Prozess', 'Mach daraus ein Sequenzdiagramm', 'Create a Gantt chart for the rollout', 'a state diagram please', 'as mermaid', 'Erstelle ein Diagramm']) assert.ok(wantsDiagram(yes), yes);
  for (const no of ['Summarise the renewals', 'Wie ist der Status von Lindenau?', 'Build a dashboard Space', 'diagrammatic', '']) assert.ok(!wantsDiagram(no), no);
});

test('the hint names the four kinds, forbids init directives and Figma claims, and is wired into the prompt', () => {
  for (const w of ['flowchart', 'gantt', 'sequenceDiagram', 'stateDiagram-v2', 'mermaid', '%%{init}%%', 'Figma']) assert.ok(DIAGRAM_NOTE.includes(w), w);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /!spaceRequested && wantsDiagram\(text\) \? DIAGRAM_NOTE : ''/);
});
