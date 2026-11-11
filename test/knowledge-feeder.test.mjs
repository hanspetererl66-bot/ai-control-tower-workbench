import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { attributionMarkdown, chunkDocument, estimate, metadataDocument } from '../scripts/knowledge/documents.mjs';
import { collectFeed, parseFeed } from '../scripts/knowledge/feed.mjs';
import { collectGit } from '../scripts/knowledge/git.mjs';
import { RobotsDisallowedError, createPoliteFetch, parseRobots, robotsAllows, userAgent } from '../scripts/knowledge/http.mjs';
import { CHUNK_MAX, chunkMarkdown, cleanMarkdown } from '../scripts/knowledge/markdown.mjs';
import { SourceBlockedError, assertCollectable, blockedCollector, licenseDecision, loadRegistry, sourceById, validateRegistry } from '../scripts/knowledge/registry.mjs';
import { emptyState, loadState, saveState } from '../scripts/knowledge/state.mjs';
import { collectable, ingestedFromState } from '../scripts/knowledge-feeder.mjs';

const reg = loadRegistry();
const docsSource = sourceById(reg, 'sap-docs-github');
const newsSource = sourceById(reg, 'sap-news-feed');
const tmp = () => mkdtempSync(join(tmpdir(), 'knowledge-test-'));
const res = (body, status = 200) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
const fast = { now: () => 0, sleep: async () => {}, env: { KNOWLEDGE_FEEDER_CONTACT: 'test@example.invalid' } };

// ---------- registry and gate

test('the registry is valid, every status is known, and the research result is in it', () => {
  assert.deepEqual(validateRegistry(reg), []);
  const status = Object.fromEntries(reg.sources.map((s) => [s.id, s.status]));
  assert.deepEqual(
    { docs: status['sap-docs-github'], samples: status['sap-samples-github'], news: status['sap-news-feed'], community: status['sap-community-feeds'], help: status['sap-help-portal'], pages: status['sap-community-pages'], article: status['sap-news-article-pages'], notes: status['sap-notes-kba'], launchpad: status['sap-support-launchpad'], arch: status['sap-architecture-center'], tut: status['sap-tutorials-github'], hub: status['sap-business-accelerator-hub'], learn: status['sap-learning'], road: status['sap-roadmap-explorer'], dc: status['sap-discovery-center'] },
    { docs: 'allowed', samples: 'allowed', news: 'metadata_only', community: 'metadata_only', help: 'blocked', pages: 'blocked', article: 'blocked', notes: 'blocked', launchpad: 'blocked', arch: 'needs_review', tut: 'needs_review', hub: 'needs_review', learn: 'needs_review', road: 'needs_review', dc: 'needs_review' });
});

test('validateRegistry finds broken entries', () => {
  const bad = structuredClone(reg);
  bad.sources.push({ ...bad.sources[0] }); // duplicate id and prefix
  bad.sources[1].status = 'maybe';
  bad.sources.find((s) => s.id === 'sap-help-portal').status = 'allowed'; // a page can never be allowed
  const problems = validateRegistry(bad).join('\n');
  assert.match(problems, /duplicate id/);
  assert.match(problems, /status must be one of/);
  assert.match(problems, /only git sources may be allowed/);
});

test('license gate: only CC-BY-4.0, Apache-2.0 and MIT pass; share-alike, unknown and missing do not', () => {
  for (const ok of ['CC-BY-4.0', 'Apache-2.0', 'MIT']) assert.equal(licenseDecision(ok).ok, true, ok);
  for (const bad of ['CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'GPL-3.0', 'NOASSERTION', 'other', null, undefined, '', 'BSD-3-Clause']) {
    const d = licenseDecision(bad);
    assert.equal(d.ok, false, String(bad));
    assert.equal(d.status, 'needs_review');
  }
});

test('blocked and needs_review sources are refused for every mode; metadata_only never gives full text', () => {
  for (const s of reg.sources.filter((x) => x.status === 'blocked' || x.status === 'needs_review')) {
    for (const mode of ['full-text', 'metadata']) assert.throws(() => assertCollectable(s, mode), SourceBlockedError, `${s.id} ${mode}`);
    assert.throws(() => blockedCollector(s), (e) => e instanceof SourceBlockedError && e.reason === s.reason);
  }
  assert.throws(() => assertCollectable(newsSource, 'full-text'), SourceBlockedError);
  assert.throws(() => assertCollectable(docsSource, 'metadata'), SourceBlockedError);
  assert.equal(assertCollectable(docsSource, 'full-text'), docsSource);
  assert.equal(assertCollectable(newsSource, 'metadata'), newsSource);
});

test('a flag or the environment cannot widen a status: a changed copy is still judged by its own status', () => {
  // a metadata_only feed cannot be turned into full text by editing its status either: feeds may not be 'allowed'
  assert.ok(validateRegistry({ version: 1, sources: [{ ...newsSource, status: 'allowed' }] }).some((p) => /only git sources may be allowed/.test(p)));
  process.env.KNOWLEDGE_FEEDER_ALLOW_ALL = '1';
  assert.throws(() => assertCollectable(sourceById(reg, 'sap-help-portal'), 'full-text'), SourceBlockedError);
  delete process.env.KNOWLEDGE_FEEDER_ALLOW_ALL;
  // the collectors themselves call the gate
  return Promise.all([
    assert.rejects(collectGit({ source: sourceById(reg, 'sap-help-portal'), scope: { repos: ['x'] }, http: null, state: emptyState(), dataDir: tmp() }), SourceBlockedError),
    assert.rejects(collectGit({ source: newsSource, scope: { repos: ['x'] }, http: null, state: emptyState(), dataDir: tmp() }), SourceBlockedError),
    assert.rejects(collectFeed({ source: docsSource, feeds: ['https://example.invalid/f'], http: null, state: emptyState() }), SourceBlockedError),
    assert.rejects(collectFeed({ source: sourceById(reg, 'sap-news-article-pages'), feeds: [], http: null, state: emptyState() }), SourceBlockedError),
  ]);
});

test('a run without --source takes only collectable sources', () => {
  assert.deepEqual(collectable(reg).map((s) => s.id), ['sap-docs-github', 'sap-samples-github', 'sap-news-feed', 'sap-community-feeds']);
  assert.deepEqual(collectable(reg, 'git').map((s) => s.id), ['sap-docs-github', 'sap-samples-github']);
  assert.deepEqual(collectable(reg, 'feed').map((s) => s.id), ['sap-news-feed', 'sap-community-feeds']);
});

// ---------- http, robots

test('robots.txt: named group wins over *, longest rule wins, an unlisted agent is held to *', () => {
  const sap = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nUser-agent: ClaudeBot\nAllow: /wp-admin/admin-ajax.php\nDisallow: /wp-admin/\n');
  assert.equal(robotsAllows(sap, '/feed/'), false); // our agent is not named: "*" disallows everything
  assert.equal(robotsAllows(sap, '/feed/', 'Googlebot'), true);
  assert.equal(robotsAllows(sap, '/wp-admin/', 'Googlebot'), false);
  const c = parseRobots('User-agent: *\nCrawl-delay: 5\nDisallow: /khhcw49343/rss\nDisallow: /*?t:ac=\nAllow: /khhcw49343/rss/public\n');
  assert.equal(robotsAllows(c, '/khhcw49343/rss/board?x=1'), false);
  assert.equal(robotsAllows(c, '/khhcw49343/rss/public'), true);
  assert.equal(robotsAllows(c, '/t5/x?t:ac=1'), false);
  assert.equal(robotsAllows(c, '/t5/x'), true);
  assert.equal(robotsAllows([], '/anything'), true);
});

test('polite fetch: robots.txt first (cached per host), clear user agent, at most one request per second per host, https only', async () => {
  const calls = [];
  let clock = 0;
  const sleeps = [];
  const fetchImpl = async (url, init) => { calls.push({ url, ua: init.headers['User-Agent'] }); return url.endsWith('/robots.txt') ? res('User-agent: *\nDisallow: /private/') : res('ok'); };
  const http = createPoliteFetch({ fetchImpl, env: fast.env, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  await http.get('https://a.example/one');
  await http.get('https://a.example/two');
  assert.deepEqual(calls.map((c) => c.url), ['https://a.example/robots.txt', 'https://a.example/one', 'https://a.example/two']);
  assert.ok(calls.every((c) => c.ua === 'werkbank-knowledge-feeder (contact: test@example.invalid)'));
  assert.equal(sleeps.length, 2); // each following request to the same host waited
  assert.ok(sleeps.every((ms) => ms === 1000));
  await assert.rejects(http.get('https://a.example/private/x'), RobotsDisallowedError);
  assert.ok(!calls.some((c) => c.url.endsWith('/private/x')), 'a disallowed URL is never requested');
  await assert.rejects(http.get('http://a.example/one'), /Only https/);
  assert.match(userAgent({}), /contact: unset/);
});

test('polite fetch: a robots.txt that cannot be read (5xx) means: do not fetch; a 404 means: allowed', async () => {
  const mk = (status) => createPoliteFetch({ ...fast, fetchImpl: async (url) => (url.endsWith('/robots.txt') ? res('', status) : res('ok')) });
  await assert.rejects(mk(503).get('https://b.example/x'), RobotsDisallowedError);
  assert.equal((await mk(404).get('https://c.example/x')).status, 200);
});

// ---------- markdown

const SAP_MD = `<!-- loio3416f8fae3374cd9a71e5c4ab8ddd399 -->

# Ingest via JSON API Endpoint

You can ship documents to SAP Cloud Logging via \`JSON\` endpoint. See [the other guide](other-fdc78af.md) and ![pic](images/a.png).

> ### Note:  
> Alternately, use [OpenTelemetry](ingest-fdc78af.md).

<a name="loio3416f8fae3374cd9a71e5c4ab8ddd399__section_jh4_thx_jbc"/>

## Procedure

\`\`\`
PUT /
{ "msg": "<keep this>" }
\`\`\`

<table>
<tr><th>Field</th><th>Meaning</th></tr>
<tr><td>msg</td><td>The message</td></tr>
</table>
`;

test('cleaner: markers, anchors, images, comments and tags go; link text, notes, code and table cells stay', () => {
  const { title, text } = cleanMarkdown(`---\ntitle: Front title\n---\n${SAP_MD}`);
  assert.equal(title, 'Front title');
  assert.doesNotMatch(text, /loio|<a |!\[|images\/|\.md\)|<table|<tr|<td/);
  assert.match(text, /See the other guide and \./);
  assert.match(text, /Note:\nAlternately, use OpenTelemetry\./);
  assert.match(text, /\{ "msg": "<keep this>" \}/);
  assert.match(text, /Field \| Meaning/);
  assert.match(text, /msg \| The message/);
  assert.equal(cleanMarkdown(SAP_MD).title, 'Ingest via JSON API Endpoint');
  assert.deepEqual(cleanMarkdown(''), { title: '', text: '' });
});

test('chunker: 800 to 1500 characters, heading path kept, no chunk above the maximum, tiny tails dropped', () => {
  const para = (n) => `Paragraph ${n}. ${'The integration flow connects systems and moves messages reliably. '.repeat(8)}`.trim();
  const body = `# Guide\n\nIntro text that is long enough to be kept as a chunk of its own. ${'More words. '.repeat(10)}\n\n## Setup\n\n${[1, 2, 3, 4, 5, 6].map(para).join('\n\n')}\n\n### Detail\n\n${'x'.repeat(4000)}\n\n## Empty\n\nshort`;
  const chunks = chunkMarkdown(cleanMarkdown(body).text, 'Guide');
  assert.ok(chunks.length >= 4);
  for (const c of chunks) assert.ok(c.text.length <= CHUNK_MAX, `${c.text.length}`);
  assert.ok(chunks.some((c) => c.heading === 'Guide > Setup'));
  assert.ok(chunks.some((c) => c.heading === 'Guide > Setup > Detail'));
  assert.ok(!chunks.some((c) => /Empty/.test(c.heading)), 'a section of a few words is dropped');
  const inner = chunks.filter((c) => c.heading === 'Guide > Setup');
  assert.ok(inner.slice(0, -1).every((c) => c.text.length >= 800), 'full chunks reach the minimum');
});

// ---------- documents

test('git chunk documents end with their id, carry source, license, revision and attribution; only allowed sources may build them', () => {
  const d = chunkDocument(docsSource, { repo: 'btp-integration-suite', path: 'docs/x.md', title: 'X', heading: 'X > Y', text: 'Body text of the chunk.', url: 'https://github.com/SAP-docs/btp-integration-suite/blob/abc/docs/x.md', license: 'CC-BY-4.0', revision: 'abc', attribution: 'Attribution line', n: 3 });
  assert.equal(d.id, 'sap-docs:btp-integration-suite/docs/x.md#chunk-3');
  assert.ok(d.text.endsWith('\n(sap-docs:btp-integration-suite/docs/x.md#chunk-3)'));
  for (const line of ['Source: sap-docs-github', 'License: CC-BY-4.0', 'Revision: abc', 'Attribution: Attribution line', 'URL: https://github.com/SAP-docs/btp-integration-suite/blob/abc/docs/x.md']) assert.ok(d.text.includes(line), line);
  assert.throws(() => chunkDocument(newsSource, { repo: 'r', path: 'p', title: 't', text: 'x', license: 'MIT', revision: 'r', attribution: 'a', n: 1 }), SourceBlockedError);
  assert.throws(() => chunkDocument(docsSource, { repo: 'r', path: 'p', title: 't', text: 'x', license: 'MIT', revision: 'r', attribution: '', n: 1 }), /attribution/);
});

test('metadata documents have no body: extra fields are refused and long titles are cut', () => {
  const item = { guid: 'g-1', title: 'SAP launches something', url: 'https://news.sap.com/2026/11/x/', date: '2026-11-10', categories: ['AI', 'Cloud'], language: 'en-US', feed: 'https://news.sap.com/feed/' };
  const d = metadataDocument(newsSource, item);
  assert.match(d.id, /^sap-news:[0-9a-f]{12}$/);
  assert.ok(d.text.endsWith(`(${d.id})`));
  assert.match(d.text, /Categories: AI, Cloud/);
  for (const extra of ['description', 'content', 'summary', 'body', 'text']) assert.throws(() => metadataDocument(newsSource, { ...item, [extra]: 'article text' }), /not metadata/);
  assert.throws(() => metadataDocument(docsSource, item), SourceBlockedError);
  assert.ok(metadataDocument(newsSource, { ...item, title: 'x'.repeat(900) }).text.length < 1200);
});

test('attribution is generated for the ingested sources only', () => {
  const md = attributionMarkdown([{ source: docsSource, repos: [{ name: 'btp-cloud-logging', url: 'https://github.com/SAP-docs/btp-cloud-logging', license: 'CC-BY-4.0', copyright: '2023-2024 SAP SE or an SAP affiliate company', revision: 'abc123' }] }], new Date('2026-11-11T00:00:00Z'));
  assert.match(md, /sap-docs-github/);
  assert.match(md, /btp-cloud-logging: https:\/\/github.com\/SAP-docs\/btp-cloud-logging, CC-BY-4.0, 2023-2024 SAP SE/);
  assert.doesNotMatch(md, /sap-help-portal|sap-news-feed/);
  assert.match(attributionMarkdown([]), /Nothing was ingested yet/);
  const state = { ...emptyState(), git: { 'sap-docs-github/r': { revision: 'abcdef1234567890', name: 'r', url: 'https://github.com/SAP-docs/r', license: 'MIT', copyright: '', files: {} } }, feeds: { 'sap-news-feed|https://news.sap.com/feed/': { seen: ['a'] } } };
  assert.deepEqual(ingestedFromState(reg, state).map((i) => i.source.id), ['sap-docs-github', 'sap-news-feed']);
  assert.match(attributionMarkdown(ingestedFromState(reg, state)), /Only title, URL, date, categories and language/);
  assert.deepEqual(estimate([{ text: 'x'.repeat(400) }, { text: 'y'.repeat(40) }]), { documents: 2, characters: 440, tokens: 110 });
});

// ---------- feeds

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>News</title><language>en-US</language>
<item><title><![CDATA[SAP & partners: a new <b>launch</b>]]></title><link>https://news.sap.com/2026/11/a/</link><guid isPermaLink="false">https://news.sap.com/?p=1</guid><pubDate>Mon, 10 Nov 2026 08:00:00 +0000</pubDate><category><![CDATA[AI]]></category><category>Cloud</category>
<description><![CDATA[SECRET ARTICLE TEXT that must never be stored]]></description><content:encoded><![CDATA[FULL ARTICLE BODY]]></content:encoded></item>
<item><title>Second</title><link>https://news.sap.com/2026/11/b/</link><guid>https://news.sap.com/?p=2</guid><pubDate>Tue, 11 Nov 2026 08:00:00 +0000</pubDate></item>
<item><description>no title, no link</description></item></channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="de"><entry><title>Atom Eintrag</title><link rel="alternate" href="https://news.sap.com/germany/2026/11/c/"/><id>tag:c</id><published>2026-11-09T10:00:00Z</published><category term="Cloud"/><summary>SUMMARY TEXT</summary><content>BODY</content></entry></feed>`;

test('feed parser reads RSS and Atom and drops what is not metadata', () => {
  const rss = parseFeed(RSS);
  assert.equal(rss.length, 2);
  assert.deepEqual(rss[0], { guid: 'https://news.sap.com/?p=1', title: 'SAP & partners: a new launch', url: 'https://news.sap.com/2026/11/a/', date: '2026-11-10', categories: ['AI', 'Cloud'], language: 'en-US' });
  assert.ok(!JSON.stringify(rss).includes('SECRET'));
  const atom = parseFeed(ATOM);
  assert.deepEqual(atom[0], { guid: 'tag:c', title: 'Atom Eintrag', url: 'https://news.sap.com/germany/2026/11/c/', date: '2026-11-09', categories: ['Cloud'], language: 'de' });
  assert.deepEqual(parseFeed('not xml at all'), []);
});

const feedHttp = (bodies) => createPoliteFetch({ ...fast, fetchImpl: async (url) => {
  if (url.endsWith('/robots.txt')) return res(bodies.robots ?? '', bodies.robots === undefined ? 404 : 200);
  return bodies[url] === undefined ? res('', 404) : res(bodies[url]);
} });

test('feed collector: no body text in any document, a second run produces nothing new', async () => {
  const feeds = ['https://news.sap.com/feed/', 'https://news.sap.com/germany/feed/'];
  const http = feedHttp({ [feeds[0]]: RSS, [feeds[1]]: ATOM });
  const first = await collectFeed({ source: newsSource, feeds, http, state: emptyState() });
  assert.equal(first.documents.length, 3);
  const all = first.documents.map((d) => d.text).join('\n');
  for (const secret of ['SECRET ARTICLE TEXT', 'FULL ARTICLE BODY', 'SUMMARY TEXT', 'BODY']) assert.ok(!all.includes(secret), secret);
  assert.ok(first.documents.every((d) => /\(sap-news:[0-9a-f]{12}\)$/.test(d.text)));
  const second = await collectFeed({ source: newsSource, feeds, http, state: first.nextState });
  assert.equal(second.documents.length, 0);
  assert.equal(second.items, 3);
  const again = await collectFeed({ source: newsSource, feeds, http, state: first.nextState, full: true });
  assert.equal(again.documents.length, 3);
  // a new item in the feed is the only one taken
  const more = RSS.replace('<item><title>Second', '<item><title>Third</title><link>https://news.sap.com/2026/11/t/</link><guid>https://news.sap.com/?p=3</guid></item><item><title>Second');
  const third = await collectFeed({ source: newsSource, feeds, http: feedHttp({ [feeds[0]]: more, [feeds[1]]: ATOM }), state: first.nextState });
  assert.deepEqual(third.documents.map((d) => d.name), ['Third']);
});

test('feed collector: a robots.txt denial refuses the feed, nothing is requested, nothing is stored', async () => {
  const calls = [];
  const http = createPoliteFetch({ ...fast, fetchImpl: async (url) => { calls.push(url); return url.endsWith('/robots.txt') ? res('User-agent: *\nDisallow: /') : res(RSS); } });
  const out = await collectFeed({ source: newsSource, feeds: ['https://news.sap.com/feed/'], http, state: emptyState() });
  assert.equal(out.documents.length, 0);
  assert.match(out.refused[0].why, /robots\.txt of news\.sap\.com disallows/);
  assert.deepEqual(calls, ['https://news.sap.com/robots.txt']);
  assert.deepEqual(out.nextState.feeds, {});
});

test('--limit keeps the rest for the next run', async () => {
  const http = feedHttp({ 'https://news.sap.com/feed/': RSS });
  const a = await collectFeed({ source: newsSource, feeds: ['https://news.sap.com/feed/'], http, state: emptyState(), limit: 1 });
  assert.equal(a.documents.length, 1);
  const b = await collectFeed({ source: newsSource, feeds: ['https://news.sap.com/feed/'], http, state: a.nextState });
  assert.equal(b.documents.length, 1);
  assert.notEqual(a.documents[0].id, b.documents[0].id);
});

// ---------- git: a temporary local repository as fixture

function fixtureRepo() {
  const dir = tmp();
  const repo = join(dir, 'origin');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: repo, stdio: 'pipe' }).toString();
  git('init', '-q');
  writeFileSync(join(repo, 'docs', 'a.md'), `<!-- loio1 -->\n\n# Alpha guide\n\n${'Alpha explains how the connectivity service reaches on-premise systems. '.repeat(14)}\n`);
  writeFileSync(join(repo, 'docs', 'b.md'), `# Beta guide\n\n${'Beta describes the job scheduling service and its limits in detail. '.repeat(14)}\n`);
  writeFileSync(join(repo, 'README.md'), '# Readme\n\nContribution boilerplate that is not in scope because of the paths filter.\n'.repeat(5));
  writeFileSync(join(repo, 'REUSE.toml'), 'version = 1\n[[annotations]]\nSPDX-FileCopyrightText = "2026 SAP SE or an SAP affiliate company and fixture contributors"\nSPDX-License-Identifier = "CC-BY-4.0"\n');
  git('add', '-A'); git('commit', '-q', '-m', 'one');
  return { dir, repo, git, data: join(dir, 'data') };
}
const listing = (repos) => createPoliteFetch({ ...fast, fetchImpl: async (url) => {
  if (url.endsWith('/robots.txt')) return res('', 404);
  if (url.includes('/orgs/SAP-docs/repos')) return res(repos);
  return res('', 404);
} });

test('git collector: license gate per repo, shallow clone, chunks with attribution, second run finds nothing, a change finds only that file', async () => {
  const fx = fixtureRepo();
  const repos = [
    { name: 'good', license: { spdx_id: 'CC-BY-4.0' }, clone_url: fx.repo, html_url: 'https://github.com/SAP-docs/good' },
    { name: 'sharealike', license: { spdx_id: 'CC-BY-SA-4.0' }, clone_url: fx.repo, html_url: 'https://github.com/SAP-docs/sharealike' },
    { name: 'unknown', license: { spdx_id: 'NOASSERTION' }, clone_url: fx.repo, html_url: 'https://github.com/SAP-docs/unknown' },
    { name: 'nolicense', license: null, clone_url: fx.repo, html_url: 'https://github.com/SAP-docs/nolicense' },
    { name: 'outside', license: { spdx_id: 'MIT' }, clone_url: fx.repo, html_url: 'https://github.com/SAP-docs/outside' },
  ];
  const opts = { source: docsSource, scope: { repos: ['good', 'sharealike', 'unknown', 'nolicense', 'missing'], paths: ['docs/'] }, http: listing(repos), dataDir: fx.data, allowLocalClone: true };
  const first = await collectGit({ ...opts, state: emptyState() });
  assert.deepEqual(first.skipped.map((s) => s.repo), ['sharealike', 'unknown', 'nolicense', 'missing']);
  assert.match(first.skipped[0].why, /needs_review/);
  assert.ok(!existsSync(join(fx.data, 'git', 'SAP-docs', 'sharealike')), 'a repo that fails the gate is not even cloned');
  assert.ok(!existsSync(join(fx.data, 'git', 'SAP-docs', 'outside')), 'a repo outside the allowlist is not cloned');
  assert.equal(first.repos.length, 1);
  assert.ok(first.documents.length >= 2);
  assert.ok(first.documents.every((d) => /^sap-docs:good\/docs\/[ab]\.md#chunk-\d+$/.test(d.id) && d.text.endsWith(`(${d.id})`)));
  assert.ok(first.documents.every((d) => d.text.includes('License: CC-BY-4.0') && d.text.includes('Attribution: © 2026 SAP SE or an SAP affiliate company and fixture contributors.') && /Revision: [0-9a-f]{12}/.test(d.text)));
  assert.ok(first.documents.every((d) => !d.text.includes('loio1') && !d.text.includes('boilerplate')));
  assert.match(first.documents[0].text, /URL: https:\/\/github.com\/SAP-docs\/good\/blob\/[0-9a-f]{40}\/docs\/a\.md/);
  assert.equal(first.nextState.git['sap-docs-github/good'].license, 'CC-BY-4.0');

  const second = await collectGit({ ...opts, state: first.nextState });
  assert.equal(second.documents.length, 0, 'unchanged files give no new documents');

  writeFileSync(join(fx.repo, 'docs', 'b.md'), `# Beta guide\n\n${'Beta changed: it now also explains retries and dead-letter handling. '.repeat(14)}\n`);
  fx.git('commit', '-q', '-am', 'two');
  const third = await collectGit({ ...opts, state: second.nextState });
  assert.ok(third.documents.length >= 1);
  assert.ok(third.documents.every((d) => d.id.includes('docs/b.md')));
  assert.ok(third.documents.every((d) => /retries/.test(d.text)));
  assert.equal((await collectGit({ ...opts, state: third.nextState })).documents.length, 0);
  rmSync(fx.dir, { recursive: true, force: true });
});

test('git collector: --limit stops before a file that does not fit and keeps it for the next run; --full starts over', async () => {
  const fx = fixtureRepo();
  const repos = [{ name: 'good', license: { spdx_id: 'MIT' }, clone_url: fx.repo, html_url: 'https://github.com/SAP-docs/good' }];
  const opts = { source: docsSource, scope: { repos: ['good'], paths: ['docs/'] }, http: listing(repos), dataDir: fx.data, allowLocalClone: true };
  const a = await collectGit({ ...opts, state: emptyState(), limit: 1 });
  const files = new Set(a.documents.map((d) => d.id.split('#')[0]));
  assert.equal(files.size, 1);
  const b = await collectGit({ ...opts, state: a.nextState });
  assert.ok(b.documents.length >= 1);
  assert.ok(!b.documents.some((d) => files.has(d.id.split('#')[0])), 'the file of the first run is not repeated');
  const full = await collectGit({ ...opts, state: b.nextState, full: true });
  assert.equal(full.documents.length, a.documents.length + b.documents.length, 'full re-reads everything');
  rmSync(fx.dir, { recursive: true, force: true });
});

test('git collector: an empty scope is an error, a clone URL outside github.com is skipped, a rate limit is readable, the token only goes to the API', async () => {
  const fx = fixtureRepo();
  await assert.rejects(collectGit({ source: docsSource, scope: { repos: [] }, http: listing([]), state: emptyState(), dataDir: fx.data }), /No repositories in sources\/scope.json/);
  const evil = [{ name: 'good', license: { spdx_id: 'MIT' }, clone_url: 'https://evil.example/x.git', html_url: 'https://github.com/SAP-docs/good' }];
  const out = await collectGit({ source: docsSource, scope: { repos: ['good'] }, http: listing(evil), state: emptyState(), dataDir: fx.data });
  assert.match(out.skipped[0].why, /not on github\.com/);
  const limited = createPoliteFetch({ ...fast, fetchImpl: async (url) => (url.endsWith('/robots.txt') ? res('', 404) : res({}, 403)) });
  await assert.rejects(collectGit({ source: docsSource, scope: { repos: ['good'] }, http: limited, state: emptyState(), dataDir: fx.data }), /rate limit/);
  const seen = [];
  const spy = createPoliteFetch({ ...fast, fetchImpl: async (url, init) => { seen.push({ url, auth: init.headers.Authorization }); return url.endsWith('/robots.txt') ? res('', 404) : res([]); } });
  await collectGit({ source: docsSource, scope: { repos: ['good'] }, http: spy, state: emptyState(), dataDir: fx.data, env: { GITHUB_TOKEN: 'ghp_SECRET' } });
  assert.ok(seen.filter((s) => s.auth).every((s) => s.url.startsWith('https://api.github.com/')));
  assert.ok(!seen.some((s) => s.url.endsWith('/robots.txt') && s.auth), 'the token is not sent with the robots.txt request');
  rmSync(fx.dir, { recursive: true, force: true });
});

// ---------- command line

test('the command line refuses blocked and needs_review sources with the registry reason and fetches nothing', () => {
  const run = (...a) => spawnSync('node', ['scripts/knowledge-feeder.mjs', ...a], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', env: { ...process.env, KNOWLEDGE_FEEDER_CONTACT: 'test@example.invalid' } });
  for (const id of ['sap-help-portal', 'sap-notes-kba', 'sap-learning']) {
    const r = run('--source', id, '--limit', '1');
    assert.equal(r.status, 2, id);
    assert.match(r.stderr, new RegExp(`Refused: Source ${id} is (blocked|needs_review)`));
  }
  assert.equal(run('--source', 'nope').status, 1);
  assert.equal(run('--limit', '0').status, 1);
  assert.match(run('--list').stdout, /blocked\s+sap-help-portal/);
});

// ---------- state

test('state file: round trip, a damaged or foreign file starts over instead of crashing', () => {
  const dir = tmp();
  const file = join(dir, 'sub', 'state.json');
  assert.deepEqual(loadState(file), emptyState());
  const s = { ...emptyState(), git: { 'a/b': { revision: 'x', files: { 'p.md': 'h' } } }, feeds: { 'f|u': { seen: ['1'] } } };
  saveState(file, s);
  assert.deepEqual(loadState(file), s);
  writeFileSync(file, '{broken');
  assert.deepEqual(loadState(file), emptyState());
  writeFileSync(file, JSON.stringify({ version: 2 }));
  assert.deepEqual(loadState(file), emptyState());
  rmSync(dir, { recursive: true, force: true });
});

test('data/knowledge is git-ignored and nothing downloaded is tracked', () => {
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^data\/knowledge\/$/m);
});
