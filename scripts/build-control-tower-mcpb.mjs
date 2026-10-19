import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSub4MeData } from '../connectors/control-tower/server/sub4me.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'connectors/control-tower');
const DATA = join(ROOT, 'examples/control-tower/data.json');
const SUB4ME_PAGE = join(ROOT, 'examples/sub4me/index.html');

/**
 * Build the .mcpb bundle: manifest.json, the server, and a copy of data.json and the Sub4Me sample data.
 * A .mcpb is a plain zip; Werkbank reads manifest.json and extracts the rest.
 * Returns the path of the bundle.
 */
export function buildControlTowerBundle(output = join(ROOT, 'dist/ai-control-tower.mcpb')) {
  const out = resolve(output);
  const stage = mkdtempSync(join(tmpdir(), 'control-tower-mcpb-'));
  try {
    cpSync(join(SOURCE, 'manifest.json'), join(stage, 'manifest.json'));
    cpSync(join(SOURCE, 'server'), join(stage, 'server'), { recursive: true });
    mkdirSync(join(stage, 'data'));
    cpSync(DATA, join(stage, 'data/data.json'));
    cpSync(join(ROOT, 'examples/automation-dashboard/categories.json'), join(stage, 'data/n8n-categories.json'));
    writeFileSync(join(stage, 'data/sub4me.json'), JSON.stringify(extractSub4MeData(readFileSync(SUB4ME_PAGE, 'utf8')), null, 2));

    mkdirSync(dirname(out), { recursive: true });
    if (existsSync(out)) rmSync(out);
    try {
      execFileSync('zip', ['-q', '-r', '-X', out, '.'], { cwd: stage });
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('the `zip` command is required to build the bundle');
      throw error;
    }
    return out;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && !process.argv.includes('--gmail')) {
  console.log(`Built ${buildControlTowerBundle(process.argv[2])}`);
}

/** Gmail connector bundle: manifest + server only (no data). */
export function buildGmailBundle(output = join(ROOT, 'dist/gmail-drafts.mcpb')) {
  const out = resolve(output);
  const stage = mkdtempSync(join(tmpdir(), 'gmail-mcpb-'));
  try {
    const source = join(ROOT, 'connectors/gmail');
    cpSync(join(source, 'manifest.json'), join(stage, 'manifest.json'));
    cpSync(join(source, 'server'), join(stage, 'server'), { recursive: true });
    mkdirSync(dirname(out), { recursive: true });
    if (existsSync(out)) rmSync(out);
    execFileSync('zip', ['-q', '-r', '-X', out, '.'], { cwd: stage });
    return out;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--gmail')) {
  console.log(`Built ${buildGmailBundle()}`);
}
