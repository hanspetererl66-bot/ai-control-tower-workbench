import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMcpbUrl, parseMcpUrl, parseSkillUrl } from '../electron/install-deep-link.mjs';
import { CATALOG, installPageFor } from '../site/assets/catalog.mjs';
import {
  PAGES_BASE_URL,
  buildMcpWerkbankUrl,
  buildSkillWerkbankUrl,
  buildWerkbankUrl,
} from '../site/assets/install.mjs';

test('catalog contains the three requested MCP servers and six curated skills', () => {
  const connectors = CATALOG.filter((item) => item.kind === 'connector');
  const skills = CATALOG.filter((item) => item.kind === 'skill');

  assert.deepEqual(
    connectors.map((item) => item.title),
    ['ARC-1', 'SAP Notes MCP', 'SAP Docs MCP']
  );
  assert.equal(skills.length, 6);
  assert.equal(new Set(CATALOG.map((item) => item.id)).size, CATALOG.length);
});

test('every catalog item has an HTTPS source and a valid local handoff page', () => {
  for (const item of CATALOG) {
    assert.equal(new URL(item.sourceUrl).protocol, 'https:');
    const installPage = new URL(installPageFor(item, PAGES_BASE_URL));
    assert.equal(installPage.origin, 'https://getwerkbank.com');
    assert.match(installPage.pathname, /^\/install-(?:mcpb|mcp|skill)\/$/);
  }
});

test('every store action is accepted by the matching Werkbank desktop parser', () => {
  for (const item of CATALOG) {
    if (item.install.type === 'mcpb') {
      const deepLink = buildWerkbankUrl(item.install.url);
      assert.ok(parseMcpbUrl(deepLink), item.title);
      continue;
    }

    if (item.install.type === 'mcp') {
      const deepLink = buildMcpWerkbankUrl(item.install.name, item.install.config);
      const parsed = parseMcpUrl(deepLink);
      assert.equal(parsed?.kind, 'mcp', item.title);
      assert.equal(parsed?.name, item.install.name, item.title);
      continue;
    }

    const deepLink = buildSkillWerkbankUrl(
      item.install.repository,
      item.install.name,
      'skills.cloud.sap'
    );
    const parsed = parseSkillUrl(deepLink);
    assert.equal(parsed?.name, item.install.name, item.title);
    assert.equal(parsed?.slug, new URL(item.install.repository).pathname.slice(1), item.title);
  }
});

test('unsafe connector and skill install inputs are rejected', () => {
  assert.equal(
    parseMcpUrl(
      buildMcpWerkbankUrl('unsafe', {
        type: 'streamable_http',
        url: 'https://user:secret@example.com/mcp',
      })
    ),
    null
  );
  assert.equal(buildSkillWerkbankUrl('https://example.com/owner/repo', 'skill'), null);
  assert.equal(buildSkillWerkbankUrl('https://github.com/owner/repo', '--global'), null);
});
