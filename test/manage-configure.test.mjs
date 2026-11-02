import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(join(import.meta.dirname, '../src/ui/ManageView.tsx'), 'utf8');

/**
 * The Connectors page shows only the connectors (focus === 'connectors'), so the Skills section is not rendered there.
 * The Configure dialog must not live inside it, or Configure does nothing on the Connectors page.
 */
test('Configure dialog is rendered outside the Skills and Connectors sections', () => {
  const skillsStart = source.indexOf('{showSkills && (');
  const connectorsStart = source.indexOf('{showConnectors && (');
  const dialog = source.indexOf('{configuring && (');
  assert.ok(skillsStart > 0 && connectorsStart > 0 && dialog > 0);
  assert.ok(dialog < connectorsStart, 'dialog is placed before the Connectors section');
  assert.ok(dialog < skillsStart, 'dialog is placed before the Skills section');
  assert.equal(source.split('{configuring && (').length - 1, 1, 'rendered once');
});
