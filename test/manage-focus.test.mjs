import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const view = readFileSync(join(import.meta.dirname, '..', 'src/ui/ManageView.tsx'), 'utf8');
const app = readFileSync(join(import.meta.dirname, '..', 'src/App.tsx'), 'utf8');

test('the Skills and Connectors tiles open a page with only their own part', () => {
  assert.match(view, /const showConnectors = focus !== 'skills'/);
  assert.match(view, /const showSkills = focus !== 'connectors'/);
  assert.match(view, /\{showConnectors && \(\s*<>\s*(?:<ConnectTools [^\n]*\n\s*)?<h2 className="manage-h" id="manage-connectors">/);
  assert.match(view, /\{showSkills && \(\s*<>\s*<h2 className="manage-h" id="manage-skills">/);
  assert.match(view, /focus === 'skills' \? 'Skills' : focus === 'connectors' \? 'Connectors'/);
});

test('both tiles pass their focus to the page', () => {
  assert.match(app, /onOpenSkills=\{\(\) => \{ setManageFocus\('skills'\)/);
  assert.match(app, /onOpenConnectors=\{\(\) => \{ setManageFocus\('connectors'\)/);
  assert.match(app, /focus=\{manageFocus\}/);
});
