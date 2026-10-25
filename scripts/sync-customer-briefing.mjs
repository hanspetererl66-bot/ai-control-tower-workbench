/**
 * Customer AI Briefing Space: embeds examples/customer-ai-briefing/data.json and the shared design system into the page.
 *   npm run sync:customer-briefing            write
 *   npm run sync:customer-briefing -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = 'examples/customer-ai-briefing/index.html';
export const DATA = 'examples/customer-ai-briefing/data.json';
const BLOCK = /(<script type="application\/json" id="cab-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export function embedBriefing(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="cab-data"> block`);
  const body = JSON.stringify(data).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = JSON.parse(read(DATA));
  const html = read(PAGE);
  const next = embedBriefing(html, data, read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('Customer AI Briefing page is out of sync — run: npm run sync:customer-briefing'); process.exit(1); }
    console.log('Customer AI Briefing page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log(`Embedded the data (${data.customers.length} customers).`); }
}
