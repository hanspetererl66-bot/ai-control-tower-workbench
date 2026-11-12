/**
 * Infra Ops story: embeds examples/shared/infra-story.html (a bar with six steps) into the six Spaces of the story,
 * right after <body>. Every step posts a normal Space hand-over (wb:handoff), so the host opens the next Space.
 *   npm run sync:infra-story            write
 *   npm run sync:infra-story -- --check fail when a page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STORY_SPACES = ['infra-wiki', 'it-fleet', 'it-infrastructure', 'it-operations', 'infra-rca', 'infra-ops', 'infra-hotline', 'infra-ops-control', 'infra-orchestrator'];
const BLOCK = /<!--story:start-->[\s\S]*?<!--story:end-->\n?/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export function embedStory(html, slug, source) {
  const block = `<!--story:start-->\n${source.replaceAll('__SLUG__', slug)}<!--story:end-->\n`;
  if (BLOCK.test(html)) return html.replace(BLOCK, () => block);
  if (!/<body[^>]*>\n/.test(html)) throw new Error(`${slug}: no <body> found`);
  return html.replace(/(<body[^>]*>\n)/, (_m, open) => open + block);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = read('examples/shared/infra-story.html');
  let stale = 0;
  for (const slug of STORY_SPACES) {
    const page = `examples/${slug}/index.html`, html = read(page), next = embedStory(html, slug, source);
    if (next !== html) { stale++; if (!process.argv.includes('--check')) writeFileSync(join(ROOT, page), next); }
  }
  if (process.argv.includes('--check') && stale) { console.error(`${stale} page(s) out of date: run npm run sync:infra-story`); process.exit(1); }
  console.log(stale ? `Updated ${stale} page(s).` : 'Story bar up to date.');
}
