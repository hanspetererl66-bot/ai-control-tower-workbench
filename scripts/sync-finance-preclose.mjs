/**
 * Finance Pre-Close Space: builds examples/finance-preclose/preclose.json (mockup data, generated) and embeds it with
 * the shared design system into examples/finance-preclose/index.html.
 *   npm run sync:finance-preclose            write
 *   npm run sync:finance-preclose -- --check fail when the data or the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';
import { buildPreclose } from './generate-preclose-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = 'examples/finance-preclose/index.html';
export const DATA = 'examples/finance-preclose/preclose.json';
const BLOCK = /(<script type="application\/json" id="preclose-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export function embedPreclose(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="preclose-data"> block`);
  const body = JSON.stringify(data).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = buildPreclose();
  const dataText = JSON.stringify(data) + '\n';
  const html = read(PAGE);
  const next = embedPreclose(html, data, read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (read(DATA) !== dataText || next !== html) { console.error('Finance Pre-Close data or page is out of sync — run: npm run sync:finance-preclose'); process.exit(1); }
    console.log('Finance Pre-Close page is in sync.');
  } else { writeFileSync(join(ROOT, DATA), dataText); writeFileSync(join(ROOT, PAGE), next); console.log(`Wrote the pre-close data (${Object.keys(data.pl).length} company codes, ${data.lines.length} lines, ${data.workingDays.length} working days).`); }
}
