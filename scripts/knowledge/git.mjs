/**
 * Git collector for open-licensed sources (status allowed). GitHub's REST API is used only to list repositories and read
 * their license; the content comes from `git clone --depth 1` / `git fetch`, never from scraping HTML.
 * Incremental: the state keeps the blob hash of every file already processed, so a second run finds only what changed.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { assertCollectable, attributionFor, licenseDecision } from './registry.mjs';
import { chunkDocument } from './documents.mjs';
import { chunkMarkdown, cleanMarkdown } from './markdown.mjs';

const run = promisify(execFile);
const SKIP_FILE = /(^|\/)(LICENSE[^/]*|LICENSES\/.*|CONTRIBUTING[^/]*|CODE_OF_CONDUCT[^/]*|SECURITY[^/]*|CHANGELOG[^/]*|\.github\/.*)$/i;
const MAX_FILE_BYTES = 400_000;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

const defaultGit = (args, cwd) => run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).then((r) => r.stdout);

/** Repositories of the source from the GitHub REST API: {name, license, clone_url, html_url, archived}. */
export async function listRepos({ source, http, env = process.env }) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) };
  const row = (r) => ({ name: r.name, license: r.license?.spdx_id ?? null, clone_url: r.clone_url, html_url: r.html_url, archived: !!r.archived });
  const owner = source.owner;
  if (!NAME.test(owner)) throw new Error(`Bad owner name in the registry: ${owner}`);
  const get = async (url) => {
    const res = await http.get(url, { headers });
    if (res.status === 403 || res.status === 429) throw new Error('GitHub answered with a rate limit. Set GITHUB_TOKEN (read-only, public data) or try again later.');
    if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status} for ${new URL(url).pathname}.`);
    return res.json();
  };
  if (source.kind === 'git-repo') {
    const repo = new URL(source.url).pathname.split('/').filter(Boolean)[1];
    return [row(await get(`https://api.github.com/repos/${owner}/${repo}`))];
  }
  const out = [];
  for (let page = 1; page <= 5; page += 1) {
    const rows = await get(`https://api.github.com/orgs/${owner}/repos?per_page=100&page=${page}&type=public`);
    out.push(...rows.map(row));
    if (rows.length < 100) break;
  }
  return out;
}

const urlPath = (p) => p.split('/').map(encodeURIComponent).join('/');

/**
 * @param scope {repos: string[], paths?: string[]} the allowlist of this source from sources/scope.json
 * @param allowLocalClone tests only: clone URLs that are not https://github.com/...
 * @returns {{documents, nextState, repos: object[], skipped: {repo, why}[], files: number}}
 */
export async function collectGit({ source, scope, http, state, dataDir, env = process.env, git = defaultGit, limit = Infinity, allowLocalClone = false, full = false }) {
  assertCollectable(source, 'full-text');
  const wanted = Array.isArray(scope?.repos) ? scope.repos : [];
  if (!wanted.length) throw new Error(`No repositories in sources/scope.json for ${source.id}. Add an explicit allowlist first (start small).`);
  const listing = await listRepos({ source, http, env });
  const byName = new Map(listing.map((r) => [r.name, r]));
  const documents = [];
  const skipped = [];
  const repos = [];
  const next = { ...state, git: { ...state.git } };
  let fileCount = 0;

  for (const name of wanted) {
    const repo = byName.get(name);
    if (!repo) { skipped.push({ repo: name, why: 'not found in the organization listing' }); continue; }
    const decision = licenseDecision(repo.license);
    if (!decision.ok) { skipped.push({ repo: name, why: `${decision.status}: ${decision.why}` }); continue; }
    if (!allowLocalClone && !/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(\.git)?$/.test(repo.clone_url)) { skipped.push({ repo: name, why: 'clone URL is not on github.com' }); continue; }
    if (documents.length >= limit) { skipped.push({ repo: name, why: 'limit reached' }); continue; }

    const dir = join(dataDir, 'git', source.owner, name);
    mkdirSync(join(dataDir, 'git', source.owner), { recursive: true });
    if (existsSync(join(dir, '.git'))) {
      await git(['fetch', '--depth', '1', 'origin', 'HEAD'], dir);
      await git(['reset', '--hard', '-q', 'FETCH_HEAD'], dir);
    } else {
      await git(['clone', '--depth', '1', '-q', repo.clone_url, dir]);
    }
    const revision = (await git(['rev-parse', 'HEAD'], dir)).trim();
    const listingOut = await git(['ls-tree', '-r', '-l', '-z', 'HEAD'], dir);
    const tree = listingOut.split('\0').filter(Boolean).map((l) => /^(\d+) (\w+) ([0-9a-f]+)\s+(\d+|-)\t(.+)$/s.exec(l)).filter(Boolean)
      .map((m) => ({ type: m[2], blob: m[3], size: m[4] === '-' ? 0 : Number(m[4]), path: m[5] }));
    const prefixes = scope.paths?.length ? scope.paths : null;
    const files = tree.filter((f) => f.type === 'blob' && /\.(md|markdown)$/i.test(f.path) && f.size > 0 && f.size <= MAX_FILE_BYTES && !SKIP_FILE.test(f.path) && (!prefixes || prefixes.some((p) => f.path.startsWith(p))));

    let copyright = '';
    try { copyright = /SPDX-FileCopyrightText\s*=\s*"([^"]+)"/.exec(readFileSync(join(dir, 'REUSE.toml'), 'utf8'))?.[1] ?? ''; } catch { /* no REUSE.toml */ }
    const key = `${source.id}/${name}`;
    const before = full ? {} : (state.git[key]?.files ?? {});
    const after = {};
    let stopped = false;
    for (const f of files) {
      if (before[f.path] === f.blob) { after[f.path] = f.blob; continue; }
      if (stopped) continue;
      const cleaned = cleanMarkdown(readFileSync(join(dir, f.path), 'utf8'));
      const title = cleaned.title || f.path.split('/').pop().replace(/\.\w+$/, '');
      const chunks = chunkMarkdown(cleaned.text, title);
      if (documents.length > 0 && documents.length + chunks.length > limit) { stopped = true; continue; } // not recorded: the next run takes it
      const attribution = `${copyright ? `© ${copyright}. ` : ''}${attributionFor(source, { repo_url: repo.html_url, license: decision.license, title: `${name}/${f.path}` })}`;
      chunks.forEach((c, i) => documents.push(chunkDocument(source, {
        repo: name, path: f.path, title, heading: c.heading, text: c.text, license: decision.license, revision: revision.slice(0, 12), attribution, n: i + 1,
        url: `${repo.html_url.replace(/\/$/, '')}/blob/${revision}/${urlPath(f.path)}`,
      })));
      after[f.path] = f.blob;
      fileCount += 1;
    }
    next.git[key] = { revision, files: after, name, url: repo.html_url, license: decision.license, copyright };
    repos.push({ name, url: repo.html_url, license: decision.license, revision: revision.slice(0, 12), copyright, files: files.length });
  }
  return { documents, nextState: next, repos, skipped, files: fileCount };
}
