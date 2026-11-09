import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOpenViewMessage } from '../src/space-open.ts';

test('a Space may open only the listed app views', () => {
  assert.equal(parseOpenViewMessage({ type: 'wb:open-view', view: 'studio' }), 'studio');
  assert.equal(parseOpenViewMessage({ type: 'wb:open-view', view: 'develop' }), 'develop');
  assert.equal(parseOpenViewMessage({ type: 'wb:open-view', view: 'admin' }), null);
  assert.equal(parseOpenViewMessage({ type: 'wb:open-view' }), null);
  assert.equal(parseOpenViewMessage({ type: 'other', view: 'studio' }), null);
  assert.equal(parseOpenViewMessage(null), null);
});
