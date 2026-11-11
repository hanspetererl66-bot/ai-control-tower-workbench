// License-gated knowledge feeder: official SAP sources into the Cognee knowledge graph (docs/knowledge-feeder.md).
// Default is a dry run: it collects, writes dist/cognee-corpus-<source-id>.json and prints the size. Nothing is sent to a model.
//   node scripts/knowledge-feeder.mjs [--kind git|feed] [--source <id>] [--limit N] [--estimate] [--full] [--seed [--reset]] [--list]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attributionMarkdown, estimate } from './knowledge/documents.mjs';
import { collectFeed } from './knowledge/feed.mjs';
import { collectGit } from './knowledge/git.mjs';
import { createPoliteFetch, userAgent } from './knowledge/http.mjs';
import { ROOT, SourceBlockedError, assertCollectable, loadRegistry, sourceById } from './knowledge/registry.mjs';
import { emptyState, loadState, saveState } from './knowledge/state.mjs';

const DATA = join(ROOT, 'data', 'knowledge');
const STATE = join(DATA, 'state.json');

/** Sources a run without --source takes: every one the registry allows to be collected. */
export const collectable = (reg, kind) => reg.sources.filter((s) => (s.status === 'allowed' || s.status === 'metadata_only') && (!kind || (kind === 'git' ? s.kind.startsWith('git') : s.kind === 'feed')));

/** Sources that were actually ingested (they have state), for ATTRIBUTION.md. */
export function ingestedFromState(reg, state) {
  const out = [];
  for (const s of reg.sources) {
    if (s.status === 'allowed') {
      const repos = Object.entries(state.git).filter(([k]) => k.startsWith(`${s.id}/`)).map(([, v]) => ({ name: v.name, url: v.url, license: v.license, copyright: v.copyright, revision: String(v.revision ?? '').slice(0, 12) }));
      if (repos.length) out.push({ source: s, repos });
    } else if (s.status === 'metadata_only' && Object.keys(state.feeds).some((k) => k.startsWith(`${s.id}|`))) out.push({ source: s, repos: [] });
  }
  return out;
}

function feedsOf(source) {
  const own = source.feeds ?? [];
  if (!source.feeds_file) return own;
  const file = join(ROOT, source.feeds_file);
  if (!existsSync(file)) return own;
  const extra = JSON.parse(readFileSync(file, 'utf8')).feeds;
  return [...own, ...(Array.isArray(extra) ? extra.filter((u) => /^https:\/\//.test(u)) : [])];
}

function parseArgs(argv) {
  const a = { kind: '', sources: [], limit: Infinity, estimate: false, full: false, seed: false, reset: false, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--kind') a.kind = argv[++i];
    else if (v === '--source') a.sources.push(argv[++i]);
    else if (v === '--limit') a.limit = Number(argv[++i]);
    else if (v === '--estimate') a.estimate = true;
    else if (v === '--full') a.full = true;
    else if (v === '--seed') a.seed = true;
    else if (v === '--reset') a.reset = true;
    else if (v === '--list') a.list = true;
    else throw new Error(`Unknown option ${v}`);
  }
  if (a.kind && !['git', 'feed'].includes(a.kind)) throw new Error('--kind must be git or feed');
  if (!(a.limit > 0)) throw new Error('--limit must be a positive number');
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reg = loadRegistry();
  if (args.list) {
    for (const s of reg.sources) console.log(`${s.status.padEnd(14)} ${s.id.padEnd(30)} ${s.reason}`);
    return 0;
  }
  const scope = JSON.parse(readFileSync(join(ROOT, 'sources', 'scope.json'), 'utf8'));
  const targets = args.sources.length ? args.sources.map((id) => sourceById(reg, id) ?? (() => { throw new Error(`Unknown source ${id}. See --list.`); })()) : collectable(reg, args.kind);
  if (!process.env.KNOWLEDGE_FEEDER_CONTACT) console.error('Note: KNOWLEDGE_FEEDER_CONTACT is not set; the user agent says "contact: unset". Set it to an address SAP or GitHub can write to.');
  console.log(`User agent: ${userAgent()}`);
  const http = createPoliteFetch();
  let state = loadState(STATE);
  const base = loadState(STATE);
  let exit = 0;
  let ran = 0;
  for (const source of targets) {
    try {
      assertCollectable(source, source.status === 'metadata_only' ? 'metadata' : 'full-text');
      if (source.kind.startsWith('git') && !args.sources.length && !scope[source.id]?.repos?.length) { console.log(`${source.id}: skipped, no repositories in sources/scope.json (add an allowlist to use it).`); continue; }
      let result;
      if (source.kind === 'feed') {
        result = await collectFeed({ source, feeds: feedsOf(source), http, state, limit: args.limit, full: args.full });
        for (const r of result.refused) console.log(`  refused ${r.feed}: ${r.why}`);
        if (!feedsOf(source).length) console.log(`  ${source.id}: no feeds configured (${source.feeds_file ?? 'registry'})`);
      } else {
        result = await collectGit({ source, scope: scope[source.id], http, state, dataDir: DATA, limit: args.limit, full: args.full });
        for (const s of result.skipped) console.log(`  skipped ${s.repo}: ${s.why}`);
        for (const r of result.repos) console.log(`  ${r.name}: ${r.license}, ${r.files} markdown files at ${r.revision}`);
      }
      const e = estimate(result.documents);
      console.log(`${source.id}: ${e.documents} new documents, ${e.characters} characters, about ${e.tokens} tokens (no model called)`);
      ran += 1;
      if (args.estimate || !e.documents) { if (!e.documents) console.log('  nothing new.'); continue; }
      const out = join(ROOT, 'dist', `cognee-corpus-${source.id}.json`);
      mkdirSync(join(ROOT, 'dist'), { recursive: true });
      writeFileSync(out, JSON.stringify(result.documents.map(({ id, name, text }) => ({ id, name, text })), null, 2));
      console.log(`  wrote ${out}`);
      if (args.seed) {
        const py = existsSync(join(ROOT, '.venv-cognee/bin/python')) ? join(ROOT, '.venv-cognee/bin/python') : 'python3';
        const r = spawnSync(py, [join(ROOT, 'scripts/cognee-seed.py'), '--corpus', out, '--dataset', source.dataset, ...(args.reset ? ['--reset'] : [])], { stdio: 'inherit' });
        if (r.status !== 0) { console.error(`  seeding ${source.dataset} failed; state not saved, the next run takes the same documents again.`); exit = 1; continue; }
        state = result.nextState; // saved only after a successful seed
        saveState(STATE, { ...base, git: state.git, feeds: state.feeds });
      } else {
        console.log(`  dry run: not seeded. Add --seed to load it into Cognee dataset "${source.dataset}" (this calls the model).`);
      }
    } catch (e) {
      if (e instanceof SourceBlockedError) { console.error(`Refused: ${e.message}`); exit = 2; } else { console.error(`${source.id}: ${e.message}`); exit = exit || 1; }
    }
  }
  if (args.seed && ran) {
    mkdirSync(DATA, { recursive: true });
    writeFileSync(join(DATA, 'ATTRIBUTION.md'), attributionMarkdown(ingestedFromState(reg, loadState(STATE))));
    console.log(`Attribution: ${join(DATA, 'ATTRIBUTION.md')}`);
  }
  return exit;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
