import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSpaceMetadata, repairJsonStringControls } from '../shared/space-metadata.mjs';

test('repairs literal control characters inside generated JSON strings', () => {
  const raw = '{"title":"Meeting Prep","prompt":"line one\tline two\nline three"}';
  const repaired = repairJsonStringControls(raw);

  assert.equal(repaired, '{"title":"Meeting Prep","prompt":"line one\\tline two\\nline three"}');
  assert.deepEqual(parseSpaceMetadata(raw), {
    title: 'Meeting Prep',
    prompt: 'line one\tline two\nline three',
  });
});

test('leaves valid formatted JSON unchanged', () => {
  const raw = '{\n  "title": "Meeting Prep — js-soft",\n  "insights": ["One"]\n}';
  assert.equal(repairJsonStringControls(raw), raw);
  assert.deepEqual(parseSpaceMetadata(raw), {
    title: 'Meeting Prep — js-soft',
    insights: ['One'],
  });
});
