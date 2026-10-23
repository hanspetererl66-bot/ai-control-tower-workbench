/**
 * IT Operations Space: embeds examples/it-operations/alerts.json and the shared design system into the Space page.
 *   npm run sync:it-operations            write
 *   npm run sync:it-operations -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/it-operations/index.html';
const BLOCK = /(<script type="application\/json" id="ops-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export const repoAlerts = () => JSON.parse(read('examples/it-operations/alerts.json'));
export function embedAlerts(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="ops-data"> block`);
  const body = JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedAlerts(html, repoAlerts(), read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('IT Operations page is out of sync — run: npm run sync:it-operations'); process.exit(1); }
    console.log('IT Operations page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log('Embedded the alerts and the design system.'); }
}
