/**
 * What-if Space: embeds the data (Control Tower) and the model code (connectors/control-tower/server/what-if.mjs,
 * the part between BEGIN-MODEL and END-MODEL) into the page, plus the shared design system, so the slider and the
 * chat tool use literally the same rules.
 *   npm run sync:what-if            write
 *   npm run sync:what-if -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareWhatIf } from '../connectors/control-tower/server/what-if.mjs';
import { embedDesignSystem } from './sync-design-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/what-if/index.html';
const DATA = /(<script type="application\/json" id="wi-data">)([\s\S]*?)(<\/script>)/;
const MODEL = /(<script id="wi-model">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** The model code exactly as the page runs it. */
export function modelSource(source = read('connectors/control-tower/server/what-if.mjs')) {
  const match = /\/\/ BEGIN-MODEL\n([\s\S]*?)\/\/ END-MODEL/.exec(source);
  if (!match) throw new Error('what-if.mjs has no BEGIN-MODEL / END-MODEL block');
  return match[1].trimEnd();
}

export function embedWhatIf(html, model, source, css) {
  if (!DATA.test(html) || !MODEL.test(html)) throw new Error(`${PAGE} needs <script id="wi-data"> and <script id="wi-model">`);
  const withData = html
    .replace(DATA, (_m, open, _body, close) => `${open}\n${JSON.stringify(model, null, 1).replaceAll('<', '\\u003c')}\n${close}`)
    .replace(MODEL, (_m, open, _body, close) => `${open}\n${modelSource(source).replaceAll('</script', '<\\/script')}\n${close}`);
  return embedDesignSystem(withData, css);
}

export const repoModel = () => prepareWhatIf(JSON.parse(read('examples/control-tower/data.json')));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedWhatIf(html, repoModel(), undefined, read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('What-if page is out of sync — run: npm run sync:what-if'); process.exit(1); }
    console.log('What-if page is in sync.');
  } else {
    writeFileSync(join(ROOT, PAGE), next);
    console.log('Embedded the What-if data, model and design system.');
  }
}
