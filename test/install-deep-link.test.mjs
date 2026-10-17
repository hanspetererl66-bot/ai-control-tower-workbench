import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHttpsBundleUrl, parseMcpbUrl } from '../electron/install-deep-link.mjs';

const bundleUrl =
  'https://github.com/marianfoo/sap-mcp-servers/releases/download/sap-notes-latest/sap-notes.mcpb';
const webDeepLink = `werkbank://install-mcpb?url=${encodeURIComponent(bundleUrl)}`;

test('accepts the exact Werkbank web handoff', () => {
  assert.deepEqual(parseMcpbUrl(webDeepLink), {
    kind: 'mcpb-url',
    src: bundleUrl,
  });
});

test('rejects unsafe bundle sources and unrelated protocol actions', () => {
  assert.equal(normalizeHttpsBundleUrl('http://example.com/server.mcpb'), null);
  assert.equal(normalizeHttpsBundleUrl('https://user:password@example.com/server.mcpb'), null);
  assert.equal(parseMcpbUrl('other://install-mcpb?url=https%3A%2F%2Fexample.com%2Fx.mcpb'), null);
  assert.equal(parseMcpbUrl('werkbank://install-mcpb?url=http%3A%2F%2Fexample.com%2Fx.mcpb'), null);
  assert.equal(parseMcpbUrl('werkbank://install-skill?url=https%3A%2F%2Fexample.com%2Fx.mcpb'), null);
});
