/**
 * Subspaces of the AI Governance Space (examples/control-tower): Agent registry and Agent compliance are cut out of the
 * Control Tower page so their numbers can never drift apart. Each keeps the shared style, data and script blocks, only
 * the listed tabs, and a way back to the entry page.
 *   npm run sync:governance-subspaces            write
 *   npm run sync:governance-subspaces -- --check fail when a page is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'examples/control-tower/index.html';

export const SUBSPACES = [
  { dir: 'agent-registry', title: 'Agent Registry', sub: 'EVERY AGENT, ITS OWNER, RIGHTS AND RISK', tabs: ['repo', 'usage'] },
  { dir: 'agent-compliance', title: 'Agent Compliance', sub: 'EU AI ACT, RISKS, MODEL RULES AND POLICIES', tabs: ['risk', 'gov', 'policies'] },
];

const BACK = `<button type="button" class="hub-back" id="hub-back">&larr; AI Governance</button>`;
const BACK_CSS = `.hub-back{font:inherit;font-size:12px;font-weight:600;color:var(--purple);background:none;border:1px solid var(--line);border-radius:99px;padding:6px 12px;cursor:pointer}.hub-back:hover{border-color:var(--purple)}.hub-back:focus-visible{outline:2px solid var(--purple);outline-offset:2px}\n`;
// The page scripts fill elements of every tab; a subspace has only some, so a missing id gets a detached stand-in.
const SHIM = `<script>(function(){var g=document.getElementById.bind(document);document.getElementById=function(id){return g(id)||document.createElement('div');};})();</script>\n`;
const BACK_JS = `document.getElementById('hub-back').addEventListener('click',function(){if(window.parent!==window)window.parent.postMessage({type:'wb:handoff',to:'ai-control-tower',payload:{},open:true},'*');});\n`;

/** Pure: the Control Tower page + one subspace spec -> the page of that subspace. */
export function buildSubspace(html, spec) {
  const section = (id) => {
    const m = new RegExp(`<section id="page-${id}" class="pg[^"]*">[\\s\\S]*?\\n</section>`).exec(html);
    if (!m) throw new Error(`control-tower page has no tab "${id}"`);
    return m[0].replace(/class="pg[^"]*"/, 'class="pg"');
  };
  const label = (id) => {
    const m = new RegExp(`<button class="tb[^"]*"\\s+onclick="go\\('${id}',this\\)"><span class="tnum">([^<]*)</span>([^<]*)</button>`).exec(html);
    if (!m) throw new Error(`control-tower page has no tab button "${id}"`);
    return { num: m[1], text: m[2] };
  };
  // Drop every tab page (and the entry page) from the source, then put back the chosen ones.
  const pages = /<!-- ═+ [^\n]*-->\n<section id="page-\w+" class="pg[^"]*">|<section id="page-\w+" class="pg[^"]*">/g;
  const sections = /<section id="page-\w+" class="pg[^"]*">[\s\S]*?\n<\/section>\n?/g;
  const tabs = spec.tabs.map((id, i) => ({ id, ...label(id), on: i === 0 }));
  let out = html.replace(sections, '');
  out = out.replace(/<!-- ═+ [^\n]*═+ -->\n(?=\s*\n)/g, '');
  const nav = tabs.map((t) => `  <button class="tb${t.on ? ' on' : ''}" onclick="go('${t.id}',this)"><span class="tnum">${t.num}</span>${t.text}</button>`).join('\n');
  out = out.replace(/<nav class="tbar">[\s\S]*?<\/nav>/, `<nav class="tbar">\n${nav}\n</nav>\n\n${tabs.map((t) => section(t.id).replace('class="pg"', t.on ? 'class="pg on"' : 'class="pg"')).join('\n\n')}\n`);
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${spec.title} · Accenture</title>`);
  out = out.replace('<div class="hdr-title">AI Control Tower</div>', `<div class="hdr-title">${spec.title}</div>`);
  out = out.replace(/<div class="hdr-sub">[^<]*<\/div>/, `<div class="hdr-sub">${spec.sub}</div>`);
  out = out.replace('<script type="application/json" id="ct-data">', `${SHIM}<script type="application/json" id="ct-data">`);
  out = out.replace('<div class="live">', `${BACK}\n    <div class="live">`);
  out = out.replace('</style>\n<style id="design-system">', `${BACK_CSS}</style>\n<style id="design-system">`);
  out = out.replace('// The host (Werkbank chat) can ask this page to show a tab.', `${BACK_JS}// The host (Werkbank chat) can ask this page to show a tab.`);
  void pages;
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const source = readFileSync(join(ROOT, SOURCE), 'utf8');
  let stale = false;
  for (const spec of SUBSPACES) {
    const path = join(ROOT, 'examples', spec.dir, 'index.html');
    const next = buildSubspace(source, spec);
    let current = '';
    try { current = readFileSync(path, 'utf8'); } catch { /* not written yet */ }
    if (check) { if (current !== next) { stale = true; console.error(`${spec.dir}/index.html is out of date`); } }
    else { writeFileSync(path, next); console.log(`wrote examples/${spec.dir}/index.html`); }
  }
  if (stale) process.exit(1);
}
