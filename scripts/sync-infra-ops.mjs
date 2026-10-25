/**
 * Infrastructure Operations Space: embeds the sample data (examples/infra-ops/data.json), the planning model
 * (connectors/control-tower/server/infra-ops.mjs, the part between BEGIN-MODEL and END-MODEL) and the shared design system into the page,
 * so the page and the tests run literally the same rules.
 *   npm run sync:infra-ops            write
 *   npm run sync:infra-ops -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/infra-ops/index.html';
/** Pages that run the same model: the Infrastructure Operations Space and the Pre-Checks and Post-Checks Space. */
export const PAGES = [PAGE, 'examples/change-checks/index.html'];
const DATA = /(<script type="application\/json" id="io-data">)([\s\S]*?)(<\/script>)/;
const MODEL = /(<script id="io-model">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** The model code exactly as the page runs it. */
export function modelSource(source = read('connectors/control-tower/server/infra-ops.mjs')) {
  const match = /\/\/ BEGIN-MODEL\n([\s\S]*?)\/\/ END-MODEL/.exec(source);
  if (!match) throw new Error('infra-ops.mjs has no BEGIN-MODEL / END-MODEL block');
  return match[1].trimEnd();
}

export function embedInfraOps(html, data, source, css) {
  if (!DATA.test(html) || !MODEL.test(html)) throw new Error(`${PAGE} needs <script id="io-data"> and <script id="io-model">`);
  const withData = html
    .replace(DATA, (_m, open, _body, close) => `${open}\n${JSON.stringify(data, null, 1).replaceAll('<', '\\u003c')}\n${close}`)
    .replace(MODEL, (_m, open, _body, close) => `${open}\n${modelSource(source).replaceAll('</script', '<\\/script')}\n${close}`);
  return embedDesignSystem(withData, css);
}

export const repoData = () => JSON.parse(read('examples/infra-ops/data.json'));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let stale = false;
  for (const page of PAGES) {
    const html = read(page);
    const next = embedInfraOps(html, repoData(), undefined, read('examples/shared/design-system.css'));
    if (process.argv.includes('--check')) { if (next !== html) { console.error(`${page} is out of sync — run: npm run sync:infra-ops`); stale = true; } }
    else writeFileSync(join(ROOT, page), next);
  }
  if (process.argv.includes('--check')) { if (stale) process.exit(1); console.log('Infrastructure Operations pages are in sync.'); }
  else console.log('Embedded the Infrastructure Operations data, model and design system.');
}
