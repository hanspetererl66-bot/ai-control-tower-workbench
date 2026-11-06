/**
 * Embeds the fictional sample data of the two mockup Spaces into their pages.
 *   npm run sync:mockups            write
 *   npm run sync:mockups -- --check fail when a page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogic } from '../connectors/_lib/server/recruiting-logic.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MOCKUPS = [
  { page: 'examples/call-transcripts/index.html', data: 'examples/call-transcripts/calls.json' },
  { page: 'examples/customer-emails/index.html', data: 'examples/customer-emails/threads.json' },
  { page: 'examples/sales/index.html', data: 'examples/sales/pipeline.json' },
  { page: 'examples/abap-workbench/index.html', data: 'examples/abap-workbench/data.json' },
  { page: 'examples/design-study/index.html', data: 'examples/design-study/data.json' },
  { page: 'examples/recruiting-workbench/index.html', data: 'examples/recruiting-workbench/data.json' },
];
/** Catalog Spaces: real, sourced facts (not fictional), embedded the same way. */
export const CATALOGS = [
  { page: 'examples/mcp-marketplace/index.html', data: 'examples/mcp-marketplace/servers.json' },
];
const BLOCK = /<script type="application\/json" id="data">[\s\S]*?<\/script>/;
/** Pages whose logic has one source in a module (the page cannot import): the code between the two markers is copied from it. */
export const LOGIC_PAGES = { 'examples/recruiting-workbench/index.html': () => makeLogic.toString() };
const LOGIC = /\/\/ @logic-start\n[\s\S]*?\n\s*\/\/ @logic-end/;

export function embedLogic(html, source) {
  if (!LOGIC.test(html)) throw new Error('page has no @logic-start / @logic-end markers');
  return html.replace(LOGIC, () => `// @logic-start\n${source}\n  // @logic-end`);
}

export function embedMockupData(html, data) {
  if (!BLOCK.test(html)) throw new Error('page has no <script id="data"> block');
  // "<" is escaped so the sample text can never close the script element.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return html.replace(BLOCK, () => `<script type="application/json" id="data">${json}</script>`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  let stale = false;
  for (const { page, data } of [...MOCKUPS, ...CATALOGS]) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    let next = embedMockupData(html, JSON.parse(readFileSync(join(ROOT, data), 'utf8')));
    if (LOGIC_PAGES[page]) next = embedLogic(next, LOGIC_PAGES[page]());
    if (next !== html) { stale = true; if (!check) writeFileSync(join(ROOT, page), next); }
  }
  if (check && stale) { console.error('Mockup Spaces are out of sync — run: npm run sync:mockups'); process.exit(1); }
  console.log(check ? 'Mockup Spaces are in sync.' : 'Embedded the sample data into the mockup Spaces.');
}
