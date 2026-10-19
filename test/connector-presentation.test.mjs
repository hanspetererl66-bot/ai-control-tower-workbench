import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILT_IN_WORK_SOURCES,
  INTEGRATION_MENU_ITEMS,
  connectorDisplayName,
  isMicrosoft365Backend,
} from '../src/connector-presentation.ts';

test('uses the expected product-facing connector labels', () => {
  assert.deepEqual([...BUILT_IN_WORK_SOURCES], ['Work Email', 'Work Calendar']);
  assert.deepEqual(
    INTEGRATION_MENU_ITEMS.map(({ label, trailing }) => [label, trailing]),
    [
      ['Model', 'submenu'],
      ['Web Search', 'switch'],
    ]
  );
  assert.equal(connectorDisplayName('sap-notes'), 'Knowledge@SAP');
  assert.equal(connectorDisplayName('arc-1'), 'ARC-1');
});

test('treats ms365 as an internal backend instead of an external connector', () => {
  assert.equal(isMicrosoft365Backend('ms365'), true);
  assert.equal(isMicrosoft365Backend('Knowledge@SAP'), false);
});
