import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_CONNECTORS, stageConnector } from '../connectors/_lib/bundle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const FLAGS = ['--gmail', '--databricks', '--jira', '--slack'];

/**
 * Build one connector as a .mcpb bundle (a plain zip; Werkbank reads manifest.json and extracts the rest).
 * Returns the path of the bundle.
 */
export function buildConnectorBundle(id, output = join(ROOT, `dist/${id}.mcpb`)) {
  const out = resolve(output);
  const stage = mkdtempSync(join(tmpdir(), `${id}-mcpb-`));
  try {
    stageConnector(id, stage);
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

/** All library-based connectors into one folder. */
export function buildAllConnectorBundles(dir = join(ROOT, 'dist')) {
  return LIBRARY_CONNECTORS.map((id) => buildConnectorBundle(id, join(dir, `${id}.mcpb`)));
}

if (MAIN && !FLAGS.some((f) => process.argv.includes(f))) {
  const wanted = process.argv[2];
  if (wanted && LIBRARY_CONNECTORS.includes(wanted)) console.log(`Built ${buildConnectorBundle(wanted)}`);
  else if (!wanted || wanted === '--all') for (const out of buildAllConnectorBundles()) console.log(`Built ${out}`);
  else { console.error(`Unknown connector "${wanted}". Choose one of: ${LIBRARY_CONNECTORS.join(', ')}, or --all.`); process.exit(1); }
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

/** Databricks connector bundle: manifest + server only (no data). */
export function buildDatabricksBundle(output = join(ROOT, 'dist/databricks.mcpb')) {
  const out = resolve(output);
  const stage = mkdtempSync(join(tmpdir(), 'databricks-mcpb-'));
  try {
    const source = join(ROOT, 'connectors/databricks');
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--databricks')) {
  console.log(`Built ${buildDatabricksBundle()}`);
}

/** Jira connector bundle: manifest + server only (no data). */
export function buildJiraBundle(output = join(ROOT, 'dist/jira.mcpb')) {
  const out = resolve(output);
  const stage = mkdtempSync(join(tmpdir(), 'jira-mcpb-'));
  try {
    const source = join(ROOT, 'connectors/jira');
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--jira')) {
  console.log(`Built ${buildJiraBundle()}`);
}

/** Slack connector bundle: manifest + server only (no data). */
export function buildSlackBundle(output = join(ROOT, 'dist/slack.mcpb')) {
  const out = resolve(output);
  const stage = mkdtempSync(join(tmpdir(), 'slack-mcpb-'));
  try {
    const source = join(ROOT, 'connectors/slack');
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--slack')) {
  console.log(`Built ${buildSlackBundle()}`);
}
