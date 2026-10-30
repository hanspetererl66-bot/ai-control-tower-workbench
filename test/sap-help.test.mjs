import test from 'node:test';
import assert from 'node:assert/strict';
import { createSapHelpHandlers, helpUrl, searchUrl, parseResults, parseCommunity, communityUrl, COMMUNITY_ORIGIN, SAP_HELP_TOOL_DEFINITIONS } from '../connectors/_lib/server/sap-help.mjs';

const body = {
  data: {
    results: [
      { title: '<b>AI Core</b> quota', url: '/docs/AI_CORE/abc/quota.html?locale=en-US', product: 'SAP AI Core', snippet: 'Quota  for\n <em>tokens</em> per deployment' },
      { title: 'Elsewhere', url: 'https://evil.example/x', snippet: 'must be dropped' },
      { title: '', url: '/docs/x' },
      { title: 'Absolute', url: 'https://help.sap.com/docs/A/B/c.html', description: 'ok' },
    ],
  },
};

const fakeFetch = (payload, init = {}) => {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => { if (init.badJson) throw new Error('x'); return payload; } };
  };
  fn.calls = calls;
  return fn;
};

test('tool definition is read only with a required query', () => {
  assert.deepEqual(SAP_HELP_TOOL_DEFINITIONS.map((t) => t.name), ['search_sap_help', 'search_sap_community']);
  for (const tool of SAP_HELP_TOOL_DEFINITIONS) {
    assert.deepEqual(tool.inputSchema.required, ['q']);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('links outside help.sap.com are dropped and html is stripped', () => {
  assert.equal(helpUrl('/docs/A'), 'https://help.sap.com/docs/A');
  assert.equal(helpUrl('https://evil.example/x'), '');
  assert.equal(helpUrl('//evil.example/x'), '');
  assert.equal(helpUrl('javascript:alert(1)'), '');
  const hits = parseResults(body, 10);
  assert.deepEqual(hits.map((h) => h.title), ['AI Core quota', 'Absolute']);
  assert.equal(hits[0].excerpt, 'Quota for tokens per deployment');
  assert.ok(hits.every((h) => h.url.startsWith('https://help.sap.com/')));
});

test('search calls only help.sap.com and returns a compact result', async () => {
  const f = fakeFetch(body);
  const r = await createSapHelpHandlers({ fetchImpl: f }).search_sap_help({ q: 'AI Core quota', limit: 2 });
  assert.equal(f.calls.length, 1);
  const url = new URL(f.calls[0].url);
  assert.equal(url.origin, 'https://help.sap.com');
  assert.equal(url.searchParams.get('q'), 'AI Core quota');
  assert.equal(url.searchParams.get('to'), '2');
  assert.equal(r.count, 2);
  assert.equal(searchUrl({ q: 'a', lang: 'de-DE', limit: 3 }).includes('language=de-DE'), true);
});

test('input and error handling', async () => {
  const h = (f) => createSapHelpHandlers({ fetchImpl: f });
  await assert.rejects(h(fakeFetch(body)).search_sap_help({ q: '  ' }), /q is required/);
  await assert.rejects(h(fakeFetch(body)).search_sap_help({ q: 'x'.repeat(201) }), /too long/);
  await assert.rejects(h(fakeFetch(body)).search_sap_help({ q: 'x', lang: 'fr-FR' }), /lang/);
  await assert.rejects(h(fakeFetch(body)).search_sap_help({ q: 'x', limit: 50 }), /limit/);
  await assert.rejects(h(fakeFetch({}, { ok: false, status: 503 })).search_sap_help({ q: 'x' }), /status 503/);
  await assert.rejects(h(fakeFetch({}, { badJson: true })).search_sap_help({ q: 'x' }), /not JSON/);
  await assert.rejects(h(async () => { throw new Error('offline'); }).search_sap_help({ q: 'x' }), /not reachable: offline/);
  const none = await h(fakeFetch({ data: { results: [] } })).search_sap_help({ q: 'x' });
  assert.equal(none.count, 0);
});

test('community search keeps only community.sap.com links and strips query syntax', async () => {
  const body = { data: { items: [
    { subject: 'Quota <b>exceeded</b> in eu10', view_href: '/t5/technology-q-a/quota/qaq-p/123', board: { title: 'Technology Q&A' }, post_time: '2026-09-01T10:00:00Z', body: '<p>Try  scaling</p>' },
    { subject: 'Elsewhere', view_href: 'https://evil.example/x' },
  ] } };
  const hits = parseCommunity(body, 5);
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].title, hits[0].board, hits[0].posted, hits[0].excerpt], ['Quota exceeded in eu10', 'Technology Q&A', '2026-09-01', 'Try scaling']);
  assert.ok(hits[0].url.startsWith(`${COMMUNITY_ORIGIN}/`));
  const url = new URL(communityUrl({ q: `x' OR 1=1 --"; DROP`, limit: 2 }));
  assert.equal(url.origin, COMMUNITY_ORIGIN);
  const liql = url.searchParams.get('q');
  assert.ok(!/['"`;]\s*(OR|DROP)/.test(liql.replace(/MATCHES '[^']*'/, '')), liql);
  assert.match(liql, /MATCHES 'x OR 1 1 -- DROP'/);
  const f = fakeFetch(body);
  const r = await createSapHelpHandlers({ fetchImpl: f }).search_sap_community({ q: 'AI Core quota', limit: 3 });
  assert.equal(r.count, 1);
  assert.equal(new URL(f.calls[0].url).origin, COMMUNITY_ORIGIN);
  await assert.rejects(createSapHelpHandlers({ fetchImpl: f }).search_sap_community({ q: '!!!' }), /letter or digit/);
  await assert.rejects(createSapHelpHandlers({ fetchImpl: fakeFetch({}, { ok: false, status: 429 }) }).search_sap_community({ q: 'x' }), /status 429/);
});
