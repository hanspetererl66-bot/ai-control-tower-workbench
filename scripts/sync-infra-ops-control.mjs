/**
 * Infra Ops Control Space: embeds examples/infra-ops-control/data.json and the shared design system into the Space page.
 *   npm run sync:infra-ops-control            write
 *   npm run sync:infra-ops-control -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/infra-ops-control/index.html';
const BLOCK = /(<script type="application\/json" id="ctl-data">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export const repoControlData = () => JSON.parse(read('examples/infra-ops-control/data.json'));
export function embedControl(html, data, css) {
  if (!BLOCK.test(html)) throw new Error(`${PAGE} has no <script id="ctl-data"> block`);
  const body = JSON.stringify(data, null, 1).replaceAll('<', '\\u003c');
  return embedDesignSystem(html.replace(BLOCK, (_m, open, _b, close) => `${open}\n${body}\n${close}`), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedControl(html, repoControlData(), read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('Infra Ops Control page is out of sync — run: npm run sync:infra-ops-control'); process.exit(1); }
    console.log('Infra Ops Control page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log('Embedded the data and the design system.'); }
}
