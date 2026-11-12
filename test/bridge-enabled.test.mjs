import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
const viewer = readFileSync(join(ROOT, 'src/ui/SpaceViewer.tsx'), 'utf8');

/** A Space bridge answers only when App.tsx switches it on (bridgeEnabled). A branch in SpaceViewer without that switch never gets a message through. */
test('every Space that the bridge listener of SpaceViewer answers is switched on in App.tsx', () => {
  const start = viewer.indexOf('const onMessage = (event: MessageEvent) => {', viewer.indexOf('if (!bridgeEnabled) return;'));
  const end = viewer.indexOf('}, [bridgeEnabled, space.slug]);');
  assert.ok(start > 0 && end > start, 'the bridge listener was found');
  const slugs = [...new Set([...viewer.slice(start, end).matchAll(/space\.slug === ([A-Z0-9_]+)/g)].map((m) => m[1]))];
  assert.ok(slugs.length >= 8, `found ${slugs.length} Spaces`);
  const condition = /bridgeEnabled=\{([^\n]*)\}\n/.exec(app)[1];
  for (const slug of slugs) assert.ok(condition.includes(`space.slug === ${slug}`), `${slug} is missing in bridgeEnabled of App.tsx`);
});

test('the Customer Hotline and Onboarding bridges are switched on, and App.tsx imports their space names', () => {
  const condition = /bridgeEnabled=\{([^\n]*)\}\n/.exec(app)[1];
  for (const slug of ['HOTLINE_SPACE', 'ONBOARDING_SPACE']) {
    assert.ok(condition.includes(`space.slug === ${slug}`), slug);
    assert.match(app, new RegExp(`import \\{[^}]*\\b${slug}\\b[^}]*\\} from './`), `${slug} is imported`);
  }
});
