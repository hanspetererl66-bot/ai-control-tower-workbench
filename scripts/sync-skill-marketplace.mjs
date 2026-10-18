/**
 * Embeds the skill catalog into the Skill Marketplace Space (a sandboxed page cannot fetch data).
 * Default source: the example skills in the repository, so it works without Supabase.
 * With --registry the approved skills are read from the shared registry (SUPABASE_URL, SUPABASE_KEY = publishable key).
 * Fictional sample skills from sample-skills.json are always added and marked "sample".
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_AREAS, LOBS, SCOPES, parseSkill, rpc } from './skills-registry.mjs';
import { catalogEntry } from '../connectors/control-tower/server/skills.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'examples/skill-marketplace');
const BLOCK = /(<script type="application\/json" id="sm-data">)([\s\S]*?)(<\/script>)/;

export const serialise = (data) => JSON.stringify(data, null, 2).replaceAll('<', '\\u003c');

export function embeddedData(html) {
  const match = BLOCK.exec(html);
  if (!match) throw new Error('index.html has no <script id="sm-data"> block');
  return JSON.parse(match[2]);
}

export function embedData(html, data) {
  if (!BLOCK.test(html)) throw new Error('index.html has no <script id="sm-data"> block');
  return html.replace(BLOCK, (_m, open, _body, close) => `${open}\n${serialise(data)}\n${close}`);
}

export const taxonomy = () => ({ boardAreas: BOARD_AREAS, lobs: LOBS, scopes: SCOPES });

/** Registered skills as the Space shows them, read from the repository example skills. */
export function repoSkills(root = ROOT) {
  const dir = join(root, 'examples/skills');
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const { name, description, meta } = parseSkill(readFileSync(join(dir, e.name, 'SKILL.md'), 'utf8'));
      return { ...catalogEntry({ slug: name, description, owner: '', version: 1, maturity: 'pilot', meta }), demand: { installs: 0, views: 0, searchHits: 0, previousScore: 0 }, sample: false };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function registrySkills({ url, key, fetchImpl = fetch }) {
  const rows = await rpc({ url, key, fn: 'skills_list', fetchImpl });
  const ranking = await rpc({ url, key, fn: 'skills_ranking', args: { p_days: 30, p_limit: 200 }, fetchImpl });
  const demand = new Map(ranking.map((r) => [r.slug, { installs: r.installs, views: r.views, searchHits: r.searchHits, previousScore: r.previousScore }]));
  return rows
    .map((row) => ({ ...catalogEntry(row), demand: demand.get(row.slug) ?? { installs: 0, views: 0, searchHits: 0, previousScore: 0 }, sample: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildCatalog({ registered, samples, source, asOf }) {
  const names = new Set(registered.map((s) => s.name));
  return { asOf, source, taxonomy: taxonomy(), skills: [...registered, ...samples.filter((s) => !names.has(s.name))] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const htmlPath = join(DIR, 'index.html');
  const html = readFileSync(htmlPath, 'utf8');
  const samples = JSON.parse(readFileSync(join(DIR, 'sample-skills.json'), 'utf8')).skills;
  const useRegistry = process.argv.includes('--registry');
  const check = process.argv.includes('--check');
  const registered = useRegistry
    ? await registrySkills({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY })
    : repoSkills();
  const asOf = check ? embeddedData(html).asOf : new Date().toISOString().slice(0, 10);
  const next = embedData(html, buildCatalog({ registered, samples, source: useRegistry ? 'registry' : 'repository', asOf }));
  if (check) {
    if (next !== html) {
      console.error('Skill Marketplace data is out of sync — run: npm run sync:skill-marketplace');
      process.exit(1);
    }
    console.log('Skill Marketplace data is in sync.');
  } else {
    writeFileSync(htmlPath, next);
    console.log(`Embedded ${registered.length} registered and ${samples.length} sample skills (${useRegistry ? 'registry' : 'repository'}).`);
  }
}
