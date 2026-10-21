/**
 * Static web demo of the bundled example Spaces (for Vercel or any static host).
 *   npm run build:demo   ->  dist/demo/
 * Only the read-only Spaces are published: no chat, no Joule, no connectors (those need the desktop app).
 * The pages already embed their data and design system, so they run as plain files in a sandboxed iframe.
 * Uses Node built-ins only, so the host does not need to install the project's dependencies.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_SPACES } from './install-example-space.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Spaces to publish: [{ slug, title }] in registry order. */
export function demoSpaces(root = ROOT) {
  return Object.entries(EXAMPLE_SPACES).map(([name, slug]) => {
    const html = readFileSync(join(root, 'examples', name, 'index.html'), 'utf8');
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() || slug;
    return { name, slug, title };
  });
}

export function galleryHtml(spaces) {
  const items = spaces.map((s) => `<a href="#${esc(s.slug)}" data-slug="${esc(s.slug)}">${esc(s.title)}</a>`).join('\n      ');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Joule Work X Demo</title>
<style>
:root{--bg:#f5f6f7;--panel:#fbfbfc;--ink:#1d2d3e;--muted:#5b6b7b;--line:#d9dde1;--accent:#6a1bb1;--accent-dim:#efe3fa}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--panel:#171a20;--ink:#e8eaed;--muted:#9aa4af;--line:#2a2f38;--accent:#c08af0;--accent-dim:#2b1d3d}}
*{box-sizing:border-box}
body{margin:0;height:100vh;display:grid;grid-template-columns:240px 1fr;grid-template-rows:auto 1fr;font:14px system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{grid-column:1 / 3;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);color:var(--muted);font-size:12px}
header b{color:var(--ink)}
nav{padding:10px;border-right:1px solid var(--line);background:var(--panel);overflow:auto;display:flex;flex-direction:column;gap:2px}
nav a{padding:9px 12px;border-radius:8px;color:var(--ink);text-decoration:none}
nav a:hover{background:var(--accent-dim)}
nav a[aria-current=page]{background:var(--accent-dim);color:var(--accent);font-weight:600}
iframe{width:100%;height:100%;border:0;background:var(--bg)}
@media (max-width:720px){body{grid-template-columns:1fr;grid-template-rows:auto auto 1fr}header{grid-column:1}nav{flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line)}nav a{white-space:nowrap}}
</style>
</head>
<body>
<header><b>Joule Work X Demo</b> · Beispieldaten, nur lesend. Chat, Joule und Connectors laufen in der Desktop-App.</header>
<nav aria-label="Spaces">
      ${items}
</nav>
<iframe id="frame" title="Space" sandbox="allow-scripts"></iframe>
<script>
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('nav a'));
  var frame = document.getElementById('frame');
  function show() {
    var slug = decodeURIComponent(location.hash.slice(1));
    var link = links.filter(function (a) { return a.dataset.slug === slug; })[0] || links[0];
    if (!link) return;
    links.forEach(function (a) { a.removeAttribute('aria-current'); });
    link.setAttribute('aria-current', 'page');
    frame.src = 'spaces/' + link.dataset.slug + '/index.html';
    document.title = link.textContent + ' · Joule Work X Demo';
  }
  window.addEventListener('hashchange', show);
  show();
})();
</script>
</body>
</html>
`;
}

export function buildDemo({ root = ROOT, out = join(ROOT, 'dist/demo') } = {}) {
  const spaces = demoSpaces(root);
  rmSync(out, { recursive: true, force: true });
  for (const s of spaces) {
    const to = join(out, 'spaces', s.slug);
    mkdirSync(to, { recursive: true });
    cpSync(join(root, 'examples', s.name, 'index.html'), join(to, 'index.html'));
    if (existsSync(join(root, 'examples', s.name, 'space.json'))) cpSync(join(root, 'examples', s.name, 'space.json'), join(to, 'space.json'));
  }
  writeFileSync(join(out, 'index.html'), galleryHtml(spaces));
  return spaces;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const spaces = buildDemo();
  console.log(`Built the web demo with ${spaces.length} Spaces -> dist/demo`);
}
