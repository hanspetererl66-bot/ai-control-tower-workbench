import assert from 'node:assert/strict';
import test from 'node:test';

import { wantsSpace } from '../src/space-intent.ts';

test('recognises positive Space and dashboard authoring requests', () => {
  assert.equal(wantsSpace('Create a Space for transport health.'), true);
  assert.equal(wantsSpace('Build a dashboard from the attached CSV.'), true);
});

test('does not turn a negative Space guardrail into an authoring request', () => {
  assert.equal(wantsSpace('Do not create or update a Space.'), false);
  assert.equal(wantsSpace('Report the IDs only, without a dashboard.'), false);
});
