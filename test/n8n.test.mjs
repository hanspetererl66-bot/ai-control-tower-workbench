import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createN8nStore, isAllowedNavigation, mcpUrl, n8nExtensionEntry, normalizeInstanceUrl } from '../electron/n8n.mjs';

test('instance URL is reduced to its https origin', () => {
  assert.equal(normalizeInstanceUrl('acme.app.n8n.cloud'), 'https://acme.app.n8n.cloud');
  assert.equal(normalizeInstanceUrl('  https://acme.app.n8n.cloud/home/workflows?x=1  '), 'https://acme.app.n8n.cloud');
  for (const bad of ['', 'http://acme.app.n8n.cloud', 'https://user:pw@acme.app.n8n.cloud', 'localhost', 'ftp://x.y', 'javascript:alert(1)']) {
    assert.throws(() => normalizeInstanceUrl(bad), undefined, bad);
  }
});

test('MCP endpoint and extension entry carry no token', () => {
  assert.equal(mcpUrl('https://acme.app.n8n.cloud'), 'https://acme.app.n8n.cloud/mcp-server/http');
  const entry = n8nExtensionEntry('https://acme.app.n8n.cloud');
  assert.deepEqual(entry, { enabled: true, type: 'streamable_http', name: 'n8n', uri: 'https://acme.app.n8n.cloud/mcp-server/http', envs: {}, timeout: 300 });
  assert.ok(!JSON.stringify(entry).toLowerCase().includes('bearer'));
});

test('embedded view may only follow the instance and n8n.cloud', () => {
  const origin = 'https://acme.app.n8n.cloud';
  assert.equal(isAllowedNavigation('https://acme.app.n8n.cloud/workflow/1', origin), true);
  assert.equal(isAllowedNavigation('https://app.n8n.cloud/login', origin), true);
  assert.equal(isAllowedNavigation('https://evil.example/n8n.cloud', origin), false);
  assert.equal(isAllowedNavigation('https://n8n.cloud.evil.example/', origin), false);
  assert.equal(isAllowedNavigation('http://acme.app.n8n.cloud/', origin), false);
  assert.equal(isAllowedNavigation('file:///etc/passwd', origin), false);
  assert.equal(isAllowedNavigation('not a url', origin), false);
});

test('store keeps only a normalized url and survives garbage', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'n8n-')), 'n8n.json');
  const store = createN8nStore(file);
  assert.equal(store.getUrl(), '');
  assert.equal(store.saveUrl('Acme.app.n8n.cloud/x'), 'https://acme.app.n8n.cloud');
  assert.equal(store.getUrl(), 'https://acme.app.n8n.cloud');
  assert.throws(() => store.saveUrl('http://x.y'));
  assert.equal(store.saveUrl(''), '');
  assert.equal(store.getUrl(), '');
});
