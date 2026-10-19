import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const composer = readFileSync(path.join(root, 'src/ui/Composer.tsx'), 'utf8');
const manage = readFileSync(path.join(root, 'src/ui/ManageView.tsx'), 'utf8');
const spaces = readFileSync(path.join(root, 'src/spaces.ts'), 'utf8');

test('the public product surface uses the Joule Work X - Next Gen name', () => {
  const product = readFileSync(path.join(root, 'src/product.ts'), 'utf8');
  assert.match(product, /PRODUCT_NAME = 'Joule Work X - Next Gen'/);
  assert.match(app, /\{PRODUCT_NAME\} uses AI/);
  assert.match(composer, /Message \$\{PRODUCT_NAME\}/);
  assert.match(readFileSync(path.join(root, 'index.html'), 'utf8'), /<title>Joule Work X - Next Gen<\/title>/);
});

test('connector import and all generated Spaces are available in the product surface', () => {
  assert.match(manage, /Import \.mcpb/);
  assert.doesNotMatch(spaces, /FEATURED_SPACE_SLUG|visibleSpaces/);
});

test('clicking the logo opens the cover sheet with the prototype wording', () => {
  const rail = readFileSync(path.join(root, 'src/ui/Rail.tsx'), 'utf8');
  const cover = readFileSync(path.join(root, 'src/ui/CoverSheet.tsx'), 'utf8');
  assert.match(rail, /<button className="rail-logo" onClick=\{onOpenCover\}/);
  assert.match(app, /onOpenCover=\{\(\) => setCoverOpen\(true\)\}/);
  assert.match(app, /\{coverOpen && <CoverSheet/);
  assert.match(cover, /\{PRODUCT_NAME\}/);
  assert.match(cover, />Prototype</);
  assert.match(cover, /Built by Accenture/);
  assert.match(cover, /Demo only/);
  assert.match(cover, /Escape/); // closable from the keyboard
});

test('a missing AI Control Tower connector can be installed in one click', () => {
  const starters = readFileSync(path.join(root, 'src/ui/StarterPrompts.tsx'), 'utf8');
  const preload = readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  const main = readFileSync(path.join(root, 'electron/main.mjs'), 'utf8');
  assert.match(starters, /fehlt oder ist nicht verbunden/);
  assert.match(starters, /Jetzt installieren/);
  assert.match(composer, /onInstall=\{onInstallConnector\}/);
  assert.match(app, /onInstallConnector=\{installControlTowerConnector\}/);
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
