/**
 * SAP Cloud ALM (Calm MCP) Space: embeds the sample data (examples/calm-alm/data.json), the mock of the Calm MCP tools
 * (shared/calm-mock.mjs, the part between BEGIN-MODEL and END-MODEL) and the shared design system into the page,
 * so the page and the tests run literally the same code.
 *   npm run sync:calm-alm            write
 *   npm run sync:calm-alm -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/calm-alm/index.html';
const DATA = /(<script type="application\/json" id="ca-data">)([\s\S]*?)(<\/script>)/;
const MODEL = /(<script id="ca-model">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** The model code exactly as the page runs it. */
export function modelSource(source = read('shared/calm-mock.mjs')) {
  const match = /\/\/ BEGIN-MODEL\n([\s\S]*?)\/\/ END-MODEL/.exec(source);
  if (!match) throw new Error('calm-mock.mjs has no BEGIN-MODEL / END-MODEL block');
  return match[1].trimEnd();
}

export function embedCalmAlm(html, data, source, css) {
  if (!DATA.test(html) || !MODEL.test(html)) throw new Error(`${PAGE} needs <script id="ca-data"> and <script id="ca-model">`);
  const withData = html
    .replace(DATA, (_m, open, _body, close) => `${open}\n${JSON.stringify(data, null, 1).replaceAll('<', '\\u003c')}\n${close}`)
    .replace(MODEL, (_m, open, _body, close) => `${open}\n${modelSource(source).replaceAll('</script', '<\\/script')}\n${close}`);
  return embedDesignSystem(withData, css);
}

export const repoData = () => JSON.parse(read('examples/calm-alm/data.json'));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedCalmAlm(html, repoData(), undefined, read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('Cloud ALM page is out of sync — run: npm run sync:calm-alm'); process.exit(1); }
    console.log('Cloud ALM page is in sync.');
  } else {
    writeFileSync(join(ROOT, PAGE), next);
    console.log('Embedded the Cloud ALM data, Calm MCP mock and design system.');
  }
}
