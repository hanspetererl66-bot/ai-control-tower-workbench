/**
 * Embeds the fictional sample data of the two mockup Spaces into their pages.
 *   npm run sync:mockups            write
 *   npm run sync:mockups -- --check fail when a page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MOCKUPS = [
  { page: 'examples/call-transcripts/index.html', data: 'examples/call-transcripts/calls.json' },
  { page: 'examples/customer-emails/index.html', data: 'examples/customer-emails/threads.json' },
];
const BLOCK = /<script type="application\/json" id="data">[\s\S]*?<\/script>/;

export function embedMockupData(html, data) {
  if (!BLOCK.test(html)) throw new Error('page has no <script id="data"> block');
  // "<" is escaped so the sample text can never close the script element.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return html.replace(BLOCK, () => `<script type="application/json" id="data">${json}</script>`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  let stale = false;
  for (const { page, data } of MOCKUPS) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    const next = embedMockupData(html, JSON.parse(readFileSync(join(ROOT, data), 'utf8')));
    if (next !== html) { stale = true; if (!check) writeFileSync(join(ROOT, page), next); }
  }
  if (check && stale) { console.error('Mockup Spaces are out of sync — run: npm run sync:mockups'); process.exit(1); }
  console.log(check ? 'Mockup Spaces are in sync.' : 'Embedded the sample data into the mockup Spaces.');
}
