/**
 * Root Cause Analysis Space: embeds examples/infra-rca/data.json and the shared design system into the Space page.
 *   npm run sync:infra-rca            write
 *   npm run sync:infra-rca -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/infra-rca/index.html';
const BLOCK = /(<script type="application\/json" id="rca-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export const repoRcaData = () => JSON.parse(read('examples/infra-rca/data.json'));
export function embedRca(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="rca-data"> block`);
  const body = JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedRca(html, repoRcaData(), read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('Root Cause Analysis page is out of sync — run: npm run sync:infra-rca'); process.exit(1); }
    console.log('Root Cause Analysis page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log('Embedded the data and the design system.'); }
}
