/**
 * Embeds the fictional sample data of the two mockup Spaces into their pages.
 *   npm run sync:mockups            write
 *   npm run sync:mockups -- --check fail when a page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogic } from '../connectors/_lib/server/recruiting-logic.mjs';
import { makeLogic as makeLogic360 } from '../connectors/_lib/server/customer-360.mjs';
import { makeJourney } from '../shared/journey.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MOCKUPS = [
  { page: 'examples/call-transcripts/index.html', data: 'examples/call-transcripts/calls.json' },
  { page: 'examples/customer-emails/index.html', data: 'examples/customer-emails/threads.json' },
  { page: 'examples/sales/index.html', data: 'examples/sales/pipeline.json' },
  { page: 'examples/abap-workbench/index.html', data: 'examples/abap-workbench/data.json' },
  { page: 'examples/recruiting-workbench/index.html', data: 'examples/recruiting-workbench/data.json' },
  { page: 'examples/hiring-approvals/index.html', data: 'examples/hiring-approvals/data.json' },
  { page: 'examples/onboarding/index.html', data: 'examples/onboarding/data.json' },
  { page: 'examples/order-to-cash/index.html', data: 'examples/order-to-cash/data.json' },
  { page: 'examples/order-to-cash-software/index.html', data: 'examples/order-to-cash-software/data.json' },
  { page: 'examples/revenue-recognition/index.html', data: 'examples/revenue-recognition/data.json' },
  { page: 'examples/customer-360/index.html', data: 'examples/customer-360/data.json', extra: { 'data-lindenau': 'examples/customer-360/data-lindenau.json' } },
];
/** Catalog Spaces: real, sourced facts (not fictional), embedded the same way. */
export const CATALOGS = [
  { page: 'examples/mcp-marketplace/index.html', data: 'examples/mcp-marketplace/servers.json' },
];
const BLOCK = /<script type="application\/json" id="data">[\s\S]*?<\/script>/;
/** Pages whose logic has one source in a module (the page cannot import): the code between the two markers is copied from it. */
export const LOGIC_PAGES = { 'examples/recruiting-workbench/index.html': () => makeLogic.toString(), 'examples/customer-360/index.html': () => makeLogic360.toString() };
/** Pages that carry the Sales journey rail (shared/journey.mjs): the code between the two markers is copied from the module. */
export const JOURNEY_PAGES = ['examples/sales/index.html', 'examples/customer-360/index.html', 'examples/customer-emails/index.html', 'examples/renewals/index.html'];
const JOURNEY = /\/\/ @journey-start\n(?:[\s\S]*?\n)?\s*\/\/ @journey-end/;
export function embedJourney(html, source) {
  if (!JOURNEY.test(html)) throw new Error('page has no @journey-start / @journey-end markers');
  return html.replace(JOURNEY, () => `// @journey-start\n${source}\n// @journey-end`);
}
const LOGIC = /\/\/ @logic-start\n[\s\S]*?\n\s*\/\/ @logic-end/;

export function embedLogic(html, source) {
  if (!LOGIC.test(html)) throw new Error('page has no @logic-start / @logic-end markers');
  return html.replace(LOGIC, () => `// @logic-start\n${source}\n  // @logic-end`);
}

/** Further data blocks of one page (a second customer): replaced when present, else inserted right after the main block. */
export function embedExtraData(html, id, data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const block = `<script type="application/json" id="${id}">${json}</script>`;
  const own = new RegExp(`<script type="application/json" id="${id}">[\\s\\S]*?</script>`);
  if (own.test(html)) return html.replace(own, () => block);
  return html.replace(BLOCK, (m) => `${m}\n${block}`);
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
  for (const { page, data, extra } of [...MOCKUPS, ...CATALOGS]) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    let next = embedMockupData(html, JSON.parse(readFileSync(join(ROOT, data), 'utf8')));
    for (const [id, file] of Object.entries(extra ?? {})) next = embedExtraData(next, id, JSON.parse(readFileSync(join(ROOT, file), 'utf8')));
    if (LOGIC_PAGES[page]) next = embedLogic(next, LOGIC_PAGES[page]());
    if (JOURNEY_PAGES.includes(page)) next = embedJourney(next, makeJourney.toString());
    if (next !== html) { stale = true; if (!check) writeFileSync(join(ROOT, page), next); }
  }
  // Pages that carry the journey rail but get their data from another sync script (for example Renewals).
  const done = new Set([...MOCKUPS, ...CATALOGS].map((m) => m.page));
  for (const page of JOURNEY_PAGES.filter((p) => !done.has(p))) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    const next = embedJourney(html, makeJourney.toString());
    if (next !== html) { stale = true; if (!check) writeFileSync(join(ROOT, page), next); }
  }
  if (check && stale) { console.error('Mockup Spaces are out of sync — run: npm run sync:mockups'); process.exit(1); }
  console.log(check ? 'Mockup Spaces are in sync.' : 'Embedded the sample data into the mockup Spaces.');
}
