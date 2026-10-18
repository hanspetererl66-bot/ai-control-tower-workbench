import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'examples/shared/design-system.css');
export const SPACE_PAGES = ['examples/control-tower/index.html', 'examples/sub4me/index.html', 'examples/skill-marketplace/index.html', 'examples/automation-dashboard/index.html'];
const BLOCK = /<style id="design-system">[\s\S]*?<\/style>/;

export function embedDesignSystem(html, css) {
  if (!BLOCK.test(html)) throw new Error('page has no <style id="design-system"> block');
  return html.replace(BLOCK, () => `<style id="design-system">\n${css.trim()}\n</style>`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const css = readFileSync(CSS, 'utf8');
  const check = process.argv.includes('--check');
  let stale = false;
  for (const rel of SPACE_PAGES) {
    const path = join(ROOT, rel);
    const html = readFileSync(path, 'utf8');
    const next = embedDesignSystem(html, css);
    if (next !== html) {
      stale = true;
      if (!check) writeFileSync(path, next);
    }
  }
  if (check && stale) {
    console.error('design system is out of sync — run: npm run sync:design');
    process.exit(1);
  }
  console.log(check ? 'Design system is in sync.' : 'Embedded the design system into all Spaces.');
}
