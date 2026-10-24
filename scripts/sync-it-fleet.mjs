/**
 * IT Fleet Space: embeds examples/it-fleet/fleet.json and the shared design system into the Space page.
 *   npm run sync:it-fleet            write
 *   npm run sync:it-fleet -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/it-fleet/index.html';
const BLOCK = /(<script type="application\/json" id="fleet-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export const repoFleet = () => JSON.parse(read('examples/it-fleet/fleet.json'));
export function embedFleet(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="fleet-data"> block`);
  const body = JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedFleet(html, repoFleet(), read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('IT Fleet page is out of sync — run: npm run sync:it-fleet'); process.exit(1); }
    console.log('IT Fleet page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log('Embedded the fleet and the design system.'); }
}
