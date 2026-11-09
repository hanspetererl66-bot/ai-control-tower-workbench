/**
 * Infra Wiki Space: embeds examples/infra-wiki/pages.json and the shared design system into the Space page.
 *   npm run sync:infra-wiki            write
 *   npm run sync:infra-wiki -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/infra-wiki/index.html';
const BLOCK = /(<script type="application\/json" id="wiki-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export const repoWiki = () => JSON.parse(read('examples/infra-wiki/pages.json'));
export function embedWiki(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="wiki-data"> block`);
  const body = JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedWiki(html, repoWiki(), read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('Infra Wiki page is out of sync — run: npm run sync:infra-wiki'); process.exit(1); }
    console.log('Infra Wiki page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log('Embedded the pages and the design system.'); }
}
