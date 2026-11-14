/**
 * Spec Builder Space: embeds the editing helpers of the PRD model (between BEGIN-EDIT and END-EDIT in examples/prd-builder/prd-model.mjs),
 * the spec model (examples/spec-builder/spec-model.mjs, between BEGIN-MODEL and END-MODEL), a demo PRD and the shared design system.
 *   npm run sync:spec-builder            write
 *   npm run sync:spec-builder -- --check fail when the page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedDesignSystem } from './sync-design-system.mjs';
import { buildPrd } from '../examples/prd-builder/prd-model.mjs';
import { fromLinear, fromNotion, fromSlack } from '../src/prd-sources.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'examples/spec-builder/index.html';
const DEMO = /(<script type="text\/plain" id="spec-demo-prd">)([\s\S]*?)(<\/script>)/;
const MODEL = /(<script id="spec-model">)([\s\S]*?)(<\/script>)/;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function block(source, from, to, what) {
  const a = source.indexOf(from), b = source.indexOf(to);
  if (a < 0 || b < 0 || b < a) throw new Error(`${what} has no ${from} / ${to} block`);
  return source.slice(a + from.length, b);
}
/** The code the page runs: the editing helpers first, then the spec model (it uses `sections`). */
export function modelSource(prdModel = read('examples/prd-builder/prd-model.mjs'), specModel = read('examples/spec-builder/spec-model.mjs')) {
  const edit = block(prdModel, '// BEGIN-EDIT', '// END-EDIT', 'prd-model.mjs').replace(/^[^\n]*\n/, '');
  const model = block(specModel, '// BEGIN-MODEL\n', '// END-MODEL', 'spec-model.mjs');
  return `${edit.trim()}\n\n${model.trim()}`;
}
/** A demo PRD of the three demo sources of the PRD Builder (Linear, Slack, Notion), as the PRD Builder writes it. */
export function demoPrd(today = '2026-11-14') {
  const d = JSON.parse(read('examples/prd-builder/demo-sources.json'));
  const issues = [...fromLinear(d.linear), ...fromSlack(d.slack.messages, d.slack.channel), ...fromNotion(d.notion)];
  return buildPrd({ project: 'Sales Companion', issues, selectedKeys: issues.map((i) => i.key), today });
}
export function embedSpecBuilder(html, source, css, prd = demoPrd()) {
  if (!DEMO.test(html) || !MODEL.test(html)) throw new Error(`${PAGE} needs <script id="spec-demo-prd"> and <script id="spec-model">`);
  const safe = (t) => t.replaceAll('</script', '<\\/script');
  const withData = html
    .replace(DEMO, (_m, o, _b, c) => `${o}\n${safe(prd)}${c}`)
    .replace(MODEL, (_m, o, _b, c) => `${o}\n${safe(modelSource(undefined, source))}\n${c}`);
  return embedDesignSystem(withData, css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read(PAGE);
  const next = embedSpecBuilder(html, read('examples/spec-builder/spec-model.mjs'), read('examples/shared/design-system.css'));
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('Spec Builder page is out of sync — run: npm run sync:spec-builder'); process.exit(1); }
    console.log('Spec Builder page is in sync.');
  } else { writeFileSync(join(ROOT, PAGE), next); console.log('Embedded the editing helpers, the spec model, a demo PRD and the design system.'); }
}
