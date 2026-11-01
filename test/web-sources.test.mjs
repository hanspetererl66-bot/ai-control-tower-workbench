import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCES, WEB_SOURCE_TOOL_DEFINITIONS, checkUrl, createWebSourceHandlers, parsePage, sourceOfHost } from '../connectors/_lib/server/web-sources.mjs';
import { isWebTool } from '../src/web-search.ts';

const reply = (body, init = {}) => ({ ok: (init.status ?? 200) < 400, status: init.status ?? 200, headers: new Map(Object.entries({ 'content-type': 'text/html; charset=utf-8', ...(init.headers ?? {}) })), text: async () => body });
const fake = (routes) => { const calls = []; const fn = async (url) => { calls.push(url); const r = routes[url]; if (!r) throw new Error('no route ' + url); return r; }; fn.calls = calls; return fn; };

test('approved sources: SAP sites, openSAP, Handelsblatt and FAZ; everything else is refused', () => {
  const ids = SOURCES.map((s) => s.id);
  for (const id of ['sap', 'sap-learning', 'sap-support', 'sap-news', 'openSAP', 'handelsblatt', 'faz', 'finanzen', 'cnn']) assert.ok(ids.includes(id), id);
  for (const ok of ['https://www.sap.com/', 'https://learning.sap.com/x', 'https://support.sap.com/en/index.html', 'https://news.sap.com/?s=ai', 'https://open.sap.com/', 'https://discovery-center.cloud.sap/', 'https://www.handelsblatt.com/', 'https://www.faz.net/aktuell/', 'https://www.finanzen.net/aktien/sap-aktie', 'https://www.sap.com/investors/de.html', 'https://edition.cnn.com/markets/stocks/SAP']) assert.equal(checkUrl(ok).href.startsWith('https://'), true, ok);
  for (const bad of ['http://www.sap.com/', 'https://evil.example/sap.com', 'https://sap.com.evil.example/', 'https://notsap.com/', 'https://finanzen.net.evil.example/', 'https://notcnn.com/', 'https://www.google.com/finance/', 'https://user:pw@www.sap.com/', 'https://www.sap.com:8443/', 'https://10.0.0.1/', 'file:///etc/passwd', 'javascript:alert(1)', '']) assert.throws(() => checkUrl(bad), /approved|https|IP|user name|port|valid/, bad);
  assert.equal(sourceOfHost('help.sap.com').id, 'sap-help', 'most specific source wins');
});

test('tool definitions are read only; the web guard knows the two network tools but not the list', () => {
  assert.deepEqual(WEB_SOURCE_TOOL_DEFINITIONS.map((t) => t.name), ['list_web_sources', 'fetch_web_page', 'search_web_sources']);
  assert.equal(isWebTool({ toolName: 'ai-control-tower__fetch_web_page' }), true);
  assert.equal(isWebTool({ toolName: 'ai-control-tower__search_web_sources' }), true);
  assert.equal(isWebTool({ toolName: 'ai-control-tower__list_web_sources' }), false);
});

test('parsePage: title, text without scripts, only approved links', () => {
  const html = '<html><head><title>News &amp; Stories</title><meta name="description" content="Desc"><script>var x=1</script></head><body><nav>menu</nav><h1>Hello</h1><p>First   paragraph.</p><a href="/story/1">A long story title</a><a href="https://evil.example/x">Evil link here</a><a href="https://www.faz.net/a">FAZ article link</a><footer>foot</footer></body></html>';
  const p = parsePage(html, 'https://news.sap.com/');
  assert.equal(p.title, 'News & Stories'); assert.equal(p.description, 'Desc');
  assert.match(p.text, /Hello\nFirst paragraph\./); assert.doesNotMatch(p.text, /menu|var x|foot/);
  assert.deepEqual(p.links.map((l) => l.url), ['https://news.sap.com/story/1', 'https://www.faz.net/a']);
});

test('fetch_web_page: reads a page, checks every redirect, reports login and paywall instead of bypassing', async () => {
  const f = fake({
    'https://www.sap.com/': reply('<title>SAP</title><p>' + 'word '.repeat(100) + '</p>'),
    'https://www.sap.com/a': reply('', { status: 302, headers: { location: 'https://evil.example/' } }),
    'https://www.sap.com/b': reply('', { status: 301, headers: { location: '/c' } }),
    'https://www.sap.com/c': reply('<title>C</title><p>' + 'x '.repeat(200) + '</p>'),
    'https://support.sap.com/notes': reply('', { status: 403 }),
    'https://www.faz.net/plus': reply('<title>FAZ+</title><p>Kurzer Anriss des Artikels. Jetzt weiterlesen mit F+</p>'),
    'https://www.sap.com/pdf': reply('%PDF', { headers: { 'content-type': 'application/pdf' } }),
  });
  const h = createWebSourceHandlers({ fetchImpl: f });
  const ok = await h.fetch_web_page({ url: 'https://www.sap.com/' });
  assert.equal(ok.title, 'SAP'); assert.equal(ok.readable, true);
  await assert.rejects(h.fetch_web_page({ url: 'https://www.sap.com/a' }), /not an approved source/);
  assert.equal((await h.fetch_web_page({ url: 'https://www.sap.com/b' })).title, 'C');
  const login = await h.fetch_web_page({ url: 'https://support.sap.com/notes' });
  assert.equal(login.readable, false); assert.match(login.note, /S-user/);
  const faz = await h.fetch_web_page({ url: 'https://www.faz.net/plus' });
  assert.match(faz.note, /free part/);
  await assert.rejects(h.fetch_web_page({ url: 'https://www.sap.com/pdf' }), /not a web page/);
  await assert.rejects(h.fetch_web_page({ url: 'https://www.sap.com/', maxChars: 5 }), /maxChars/);
  await assert.rejects(h.fetch_web_page({ url: 'https://example.com/' }), /not an approved source/);
});

test('search_web_sources and list_web_sources', async () => {
  const f = fake({ 'https://news.sap.com/?s=joule': reply('<a href="/2026/10/joule-agents/">Joule agents are here for everyone</a><a href="/?s=joule&page=2">next page of results</a><p>' + 'text '.repeat(80) + '</p>') });
  const h = createWebSourceHandlers({ fetchImpl: f });
  const r = await h.search_web_sources({ source: 'sap-news', q: 'joule' });
  assert.equal(r.count, 1); assert.equal(r.results[0].url, 'https://news.sap.com/2026/10/joule-agents/');
  await assert.rejects(h.search_web_sources({ source: 'sap-help', q: 'x' }), /search_sap_help|no usable public search/);
  await assert.rejects(h.search_web_sources({ source: 'nope', q: 'x' }), /Unknown source/);
  await assert.rejects(h.search_web_sources({ source: 'faz', q: '' }), /q is required/);
  const list = await h.list_web_sources();
  assert.ok(list.sources.find((s) => s.id === 'handelsblatt' && s.search));
  assert.equal(f.calls.length, 1, 'listing and refused calls make no request');
});

test('market sources: share prices carry the delay and no-advice note, and the SAP quote pages are named', () => {
  const fin = SOURCES.find((s) => s.id === 'finanzen');
  const cnn = SOURCES.find((s) => s.id === 'cnn');
  assert.equal(fin.group, 'Markets');
  assert.match(fin.note, /delayed.*not investment advice/);
  assert.match(fin.note, /finanzen\.net\/aktien\/sap-aktie/);
  assert.match(cnn.note, /markets\/stocks\/SAP/);
  assert.equal(sourceOfHost('www.finanzen.net').id, 'finanzen');
  assert.equal(sourceOfHost('edition.cnn.com').id, 'cnn');
});

test('SAP Investor Relations is listed for Markets, and sap.com pages still belong to the SAP source', () => {
  const ir = SOURCES.find((s) => s.id === 'sap-investors');
  assert.equal(ir.group, 'Markets');
  assert.match(ir.note, /sap\.com\/investors\/de\.html/);
  assert.equal(sourceOfHost('www.sap.com').id, 'sap');
  assert.equal(checkUrl('https://www.sap.com/investors/de.html').hostname, 'www.sap.com');
});
