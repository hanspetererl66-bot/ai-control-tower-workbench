import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'connectors/control-tower');
const DATA = join(ROOT, 'examples/control-tower/data.json');

/**
 * Build the .mcpb bundle: manifest.json, the server, and a copy of data.json.
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`Built ${buildControlTowerBundle(process.argv[2])}`);
}
