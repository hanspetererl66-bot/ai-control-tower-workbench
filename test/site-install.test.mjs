import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseMcpbUrl } from '../electron/install-deep-link.mjs';
import {
  DEFAULT_BUNDLE_URL,
  PAGES_BASE_URL,
  buildInstallPageUrl,
  buildMcpInstallPageUrl,
  buildMcpWerkbankUrl,
  buildSkillInstallPageUrl,
  buildSkillWerkbankUrl,
  buildWerkbankUrl,
  normalizeBundleUrl,
} from '../site/assets/install.mjs';

test('site and desktop share the exact guarded MCPB handoff', () => {
  const deepLink = buildWerkbankUrl(DEFAULT_BUNDLE_URL);

  assert.equal(
    deepLink,
    `werkbank://install-mcpb?url=${encodeURIComponent(DEFAULT_BUNDLE_URL)}`
  );
  assert.deepEqual(parseMcpbUrl(deepLink), {
    kind: 'mcpb-url',
    src: DEFAULT_BUNDLE_URL,
  });
});

test('future install URL belongs to the Werkbank site', () => {
  const installUrl = buildInstallPageUrl(DEFAULT_BUNDLE_URL);
  const parsed = new URL(installUrl);

  assert.equal(PAGES_BASE_URL, 'https://getwerkbank.com/');
  assert.equal(parsed.origin, 'https://getwerkbank.com');
  assert.equal(parsed.pathname, '/install-mcpb/');
  assert.equal(parsed.searchParams.get('url'), DEFAULT_BUNDLE_URL);
});

test('README install button uses the Pages-hosted asset and guarded handoff', async () => {
  const [readme, button] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../site/assets/add-to-werkbank.svg', import.meta.url), 'utf8'),
  ]);

  assert.match(readme, /https:\/\/getwerkbank\.com\/assets\/add-to-werkbank\.svg/);
  assert.match(readme, /https:\/\/getwerkbank\.com\/install-mcpb\/\?url=/);
  assert.match(button, /aria-label="Add to Werkbank"/);
  assert.match(button, />Add to Werkbank<\/text>/);
});

test('landing page leads with an honest Get Werkbank action', async () => {
  const page = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');

  assert.match(
    page,
    /class="button button-primary button-hero"\s+href="https:\/\/github\.com\/marianfoo\/werkbank#local-development"/
  );
  assert.match(page, />\s*Get Werkbank\s*<\/a>/);
  assert.match(page, /class="button button-secondary" href="#store">\s*Explore the app store/);
  assert.match(page, /macOS source build available today · signed installer coming later/);
  assert.ok(page.indexOf('Get Werkbank') < page.indexOf('Explore the app store'));
});

test('hosted MCP and skill handoffs use dedicated Werkbank routes', () => {
  const mcpConfig = {
    type: 'streamable_http',
    url: 'https://mcp-sap-docs.marianzeis.de/mcp',
  };
  const mcpPage = new URL(buildMcpInstallPageUrl('sap-docs', mcpConfig));
  const skillPage = new URL(
    buildSkillInstallPageUrl(
      'https://github.com/UI5/plugins-coding-agents',
      'ui5-best-practices'
    )
  );

  assert.equal(mcpPage.pathname, '/install-mcp/');
  assert.equal(skillPage.pathname, '/install-skill/');
  assert.match(buildMcpWerkbankUrl('sap-docs', mcpConfig), /^werkbank:\/\/install-mcp\?/);
  assert.match(
    buildSkillWerkbankUrl(
      'https://github.com/UI5/plugins-coding-agents',
      'ui5-best-practices'
    ),
    /^werkbank:\/\/install-skill\?/
  );
});

test('web and desktop layers both reject unsafe bundle sources', () => {
  for (const source of [
    'http://example.com/server.mcpb',
    'https://user:password@example.com/server.mcpb',
    'https://example.com:8443/server.mcpb',
    'not a URL',
  ]) {
    assert.equal(normalizeBundleUrl(source), null);
  }
});

test('local site contains no previously published SAP repository Pages URL', async () => {
  const files = await Promise.all([
    readFile(new URL('../site/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../site/install-mcpb/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../site/install-mcp/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../site/install-skill/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../site/assets/install.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../site/assets/catalog.mjs', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(files.join('\n'), /marianfoo\.github\.io\/sap-mcp-servers/);
});
