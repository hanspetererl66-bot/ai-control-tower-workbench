import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const composer = readFileSync(path.join(root, 'src/ui/Composer.tsx'), 'utf8');
const manage = readFileSync(path.join(root, 'src/ui/ManageView.tsx'), 'utf8');
const spaces = readFileSync(path.join(root, 'src/spaces.ts'), 'utf8');

test('the public product surface uses the Joule Work X - Next Gen Design Study title', () => {
  const product = readFileSync(path.join(root, 'src/product.ts'), 'utf8');
  assert.match(product, /PRODUCT_NAME = 'Joule Work X - Next Gen'/);
  assert.match(product, /PRODUCT_TITLE = `\$\{PRODUCT_NAME\} Design Study`/);
  assert.match(app, /\{PRODUCT_TITLE\} uses AI/);
  assert.match(composer, /Message \$\{PRODUCT_TITLE\}/);
  assert.match(readFileSync(path.join(root, 'index.html'), 'utf8'), /<title>Joule Work X - Next Gen Design Study<\/title>/);
});

test('connector import and all generated Spaces are available in the product surface', () => {
  assert.match(manage, /Import \.mcpb/);
  assert.doesNotMatch(spaces, /FEATURED_SPACE_SLUG|visibleSpaces/);
});

test('clicking the logo opens the cover sheet with the design study wording', () => {
  const rail = readFileSync(path.join(root, 'src/ui/Rail.tsx'), 'utf8');
  const cover = readFileSync(path.join(root, 'src/ui/CoverSheet.tsx'), 'utf8');
  assert.match(rail, /<button className="rail-logo" onClick=\{onOpenCover\}/);
  assert.match(app, /onOpenCover=\{\(\) => setCoverOpen\(true\)\}/);
  assert.match(app, /\{coverOpen && <CoverSheet/);
  assert.match(cover, /<h1 className="cover-title">\s*\{COVER_NAME\}\s*<span className="cover-title-line2">\{COVER_SUBTITLE\}<\/span>\s*<span className="cover-title-line2 cover-title-line3">\{COVER_TAGLINE\}<\/span>/, 'name, then the subtitle, then the tagline');
  assert.match(readFileSync(path.join(root, 'src/product.ts'), 'utf8'), /COVER_SUBTITLE = 'Futuristic Design Study'[\s\S]*COVER_TAGLINE = 'Engineered as MVP'/);
  const css = readFileSync(path.join(root, 'src/theme.css'), 'utf8');
  assert.match(css, /\.cover-title-line2 \{[^}]*color: var\(--accent\);[^}]*animation: cover-blink/, 'second line is purple and blinks');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.cover-title-line2 \{ animation: none; \}/, 'blinking stops for reduced motion');
  assert.doesNotMatch(cover, /[Pp]rototype/);
  const product = readFileSync(path.join(root, 'src/product.ts'), 'utf8');
  assert.match(product, /COVER_SUBTITLE = 'A Futuristic Design Study'/);
  assert.match(product, /COVER_TAGLINE = 'Engineered as MVP'/, 'own line below the title');
  assert.match(product, /COVER_BY = 'Accenture Germany'/);
  assert.doesNotMatch(cover, /from Accenture/, 'no \"from\" before the company name');
  assert.match(cover, /\{COVER_TAGLINE\}[\s\S]*\{COVER_BY\}/, 'tagline, then the company line');
  assert.match(product, /Demo only · Mockup · no productive system · illustrative sample data/);
  assert.match(cover, /Author: Hans-Peter Erl/);
  assert.match(cover, /COVER_STATUS/);
  assert.match(cover, /Escape/); // closable from the keyboard
});

test('the one-click install of the AI Control Tower connector stays available in the desktop app, but the chat no longer advertises it', () => {
  const preload = readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  const main = readFileSync(path.join(root, 'electron/main.mjs'), 'utf8');
  assert.match(preload, /prepareControlTowerConnector: \(\) => ipcRenderer\.invoke\('prepare-control-tower-connector'\)/);
  // The staged request goes through the same approve→install path as any .mcpb.
  assert.match(main, /ipcMain\.handle\('prepare-control-tower-connector'/);
  assert.match(main, /ALLOWED_COMMANDS\.has\(mcp\.command\)/);
  assert.match(main, /pendingInstalls\.set\(id, request\)/);
});

test('the composer popovers close on Escape and on a click outside', () => {
  const composer = readFileSync(path.join(root, 'src/ui/Composer.tsx'), 'utf8');
  assert.match(composer, /event\.key === 'Escape'/);
  assert.match(composer, /addEventListener\('mousedown', onPointer\)/);
  // The Integrations menu stays open while a switch is flipped; Web Search is a real, per-conversation switch.
  assert.match(composer, /onClick=\{\(\) => onWebSearchChange\?\.\(!webSearch\)\}/);
  assert.doesNotMatch(composer, /Display only in this prototype|Work Calendar|'Charts'/);
});

test('the cover sheet is set in the bundled SAP 72 typeface', async () => {
  const { existsSync } = await import('node:fs');
  const css = readFileSync(path.join(root, 'src/theme.css'), 'utf8');
  for (const weight of ['Light', 'Regular', 'Semibold', 'Bold', 'Black']) {
    assert.ok(existsSync(path.join(root, `src/assets/fonts/72/72-${weight}.woff2`)), `72-${weight}.woff2`);
    assert.match(css, new RegExp(`72-${weight}\\.woff2`));
  }
  assert.ok(existsSync(path.join(root, 'src/assets/fonts/72/LICENSE.txt')));
  assert.match(css, /\.cover \{[^}]*font-family: '72'/);
  assert.match(readFileSync(path.join(root, 'NOTICE'), 'utf8'), /"72" typeface/);
});

test('rail foot offers a profile menu and help instead of the placeholder badge and sidebar toggle', () => {
  const rail = readFileSync(path.join(root, 'src/ui/Rail.tsx'), 'utf8');
  assert.doesNotMatch(rail, /rail-avatar|MZ|Toggle sidebar/);
  assert.match(rail, /aria-label="Profile"/);
  assert.match(rail, /aria-label="Help and shortcuts"/);
  assert.match(rail, /onAppearance\(value\)/);
});

test('the embedded n8n view offers Back, Forward and Home so a page without a way out is never a dead end', () => {
  const view = readFileSync(path.join(root, 'src/ui/N8nView.tsx'), 'utf8');
  const main = readFileSync(path.join(root, 'electron/main.mjs'), 'utf8');
  const preload = readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  for (const name of ['back', 'forward', 'home']) {
    assert.match(view, new RegExp(`host\\.${name}\\(\\)`));
    assert.match(preload, new RegExp(`n8n-${name}`));
    assert.match(main, new RegExp(`ipcMain.handle\\('n8n-${name}'`));
  }
  assert.match(main, /n8n-nav-state/);
});

test('every main view shows "Design Study November 2026" in red at the bottom left, as decoration only', () => {
  const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const css = readFileSync(path.join(root, 'src/theme.css'), 'utf8');
  assert.match(app, /<div className="study-badge" aria-hidden="true">Design Study November 2026<\/div>\s*<Rail/);
  assert.match(css, /\.study-badge \{[^}]*position: fixed;[^}]*left: calc\(var\(--rail-w\) \+ 14px\);[^}]*bottom: 14px;[^}]*color: var\(--error, #c9190b\);[^}]*pointer-events: none;/);
});
