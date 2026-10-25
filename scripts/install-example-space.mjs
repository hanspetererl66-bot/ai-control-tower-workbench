import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Bundled example spaces: source folder under examples/ -> slug under workspace/spaces/. */
export const EXAMPLE_SPACES = {
  'control-tower': 'ai-control-tower',
  'agent-activity': 'agent-activity',
  sub4me: 'sub4me',
  'skill-marketplace': 'skill-marketplace',
  'automation-dashboard': 'automation-dashboard',
  'knowledge-graph': 'knowledge-graph',
  'what-if': 'what-if',
  'call-transcripts': 'call-transcripts',
  'customer-emails': 'customer-emails',
  'infra-ops': 'infra-ops',
  'change-checks': 'change-checks',
  sales: 'sales',
  'it-operations': 'it-operations',
  'it-infrastructure': 'it-infrastructure',
  renewals: 'renewals',
  'finance-preclose': 'finance-preclose',
  'it-fleet': 'it-fleet',
  'mcp-marketplace': 'mcp-marketplace',
  'calm-alm': 'calm-alm',
};

/**
 * Copy a bundled example space into the spaces folder Werkbank serves.
 * workspace/* is git-ignored, so examples live in examples/ and are installed on demand.
 * Returns the destination directory.
 */
export function installExampleSpace(name, { root = ROOT, spacesDir = join(root, 'workspace/spaces') } = {}) {
  const slug = EXAMPLE_SPACES[name];
  if (!slug) throw new Error(`unknown example space "${name}"`);
  const from = join(root, 'examples', name);
  if (!existsSync(join(from, 'index.html'))) throw new Error(`examples/${name}/index.html is missing`);
  const to = join(spacesDir, slug);
  mkdirSync(to, { recursive: true });
  for (const file of ['index.html', 'space.json']) {
    if (existsSync(join(from, file))) cpSync(join(from, file), join(to, file));
  }
  return to;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const names = process.argv.slice(2);
  for (const name of names.length ? names : Object.keys(EXAMPLE_SPACES)) {
    console.log(`Installed ${name} -> ${installExampleSpace(name)}`);
  }
}
