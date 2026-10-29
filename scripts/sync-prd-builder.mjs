/**
 * PRD Builder Space: embeds the PRD model (examples/prd-builder/prd-model.mjs, the part between BEGIN-MODEL and END-MODEL),
 * the demo backlog (examples/jira-demo) and the shared design system into the page.
 *   npm run sync:prd-builder            write
 *   npm run sync:prd-builder -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';
import { demoIssues } from './prd-demo-issues.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/prd-builder/index.html';
const DATA = /(<script type="application\/json" id="prd-demo">)([\s\S]*?)(<\/script>)/;
const MODEL = /(<script id="prd-model">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export function modelSource(source = read('examples/prd-builder/prd-model.mjs')) {
  const m = /\/\/ BEGIN-MODEL\n([\s\S]*?)\/\/ END-MODEL/.exec(source);
  if (!m) throw new Error('prd-model.mjs has no BEGIN-MODEL / END-MODEL block');
  return m[1].trimEnd();
}
export function embedPrdBuilder(html, issues, source, css) {
  if (!DATA.test(html) || !MODEL.test(html)) throw new Error(`${PAGE} needs <script id="prd-demo"> and <script id="prd-model">`);
  const withData = html
    .replace(DATA, (_m, o, _b, c) => `${o}\n${JSON.stringify(issues, null, 1).replaceAll('<', '\\u003c')}\n${c}`)
    .replace(MODEL, (_m, o, _b, c) => `${o}\n${modelSource(source).replaceAll('</script', '<\\/script')}\n${c}`);
  return embedDesignSystem(withData, css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedPrdBuilder(html, demoIssues('DEMO'), undefined, read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('PRD Builder page is out of sync — run: npm run sync:prd-builder'); process.exit(1); }
    console.log('PRD Builder page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log('Embedded the PRD model, demo backlog and design system.'); }
}
