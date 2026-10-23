/**
 * IT Infrastructure Space: embeds examples/it-infrastructure/vms.json and the shared design system into the Space page.
 *   npm run sync:it-infrastructure            write
 *   npm run sync:it-infrastructure -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/it-infrastructure/index.html';
const BLOCK = /(<script type="application\/json" id="vm-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export const repoVms = () => JSON.parse(read('examples/it-infrastructure/vms.json'));
export function embedVms(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="vm-data"> block`);
  const body = JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedVms(html, repoVms(), read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('IT Infrastructure page is out of sync — run: npm run sync:it-infrastructure'); process.exit(1); }
    console.log('IT Infrastructure page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log('Embedded the VMs and the design system.'); }
}
