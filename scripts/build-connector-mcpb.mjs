import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Connectors that are a manifest plus a server folder and need no data files. */
export const SIMPLE_CONNECTORS = ['databricks-bridge', 'sap-mock'];

/**
 * Build dist/<name>.mcpb for a connector under connectors/<name>: manifest.json and server/.
 * A .mcpb is a plain zip; Werkbank reads manifest.json and extracts the rest.
 */
export function buildConnectorBundle(name, output = join(ROOT, `dist/${name}.mcpb`), root = ROOT) {
  if (!SIMPLE_CONNECTORS.includes(name)) throw new Error(`unknown connector "${name}" (expected one of ${SIMPLE_CONNECTORS.join(', ')})`);
  const source = join(root, 'connectors', name);
  const out = resolve(output);
  const stage = mkdtempSync(join(tmpdir(), `${name}-mcpb-`));
  try {
    cpSync(join(source, 'manifest.json'), join(stage, 'manifest.json'));
    cpSync(join(source, 'server'), join(stage, 'server'), { recursive: true });
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
  const name = process.argv[2];
  console.log(`Built ${buildConnectorBundle(name, process.argv[3])}`);
}
