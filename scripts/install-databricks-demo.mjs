#!/usr/bin/env node
/**
 * Installs the Databricks demo into this checkout's Werkbank:
 *   - the three skills (the Werkbank form of the recipes) into goose-home/.agents/skills
 *   - the two Goose extensions (databricks, sap-mock) into goose-home/.config/goose/config.yaml, with absolute paths
 *
 * Secrets are never written: enter them in Connectors & Skills > Configure, where Werkbank stores them encrypted.
 * An extension that already exists is left alone unless --force is given.
 *
 *   node scripts/install-databricks-demo.mjs --host https://adb-123.4.azuredatabricks.net [--force] [--skills-only]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function installDatabricksDemo({ root = ROOT, host, force = false, skillsOnly = false } = {}) {
  const demo = join(root, 'examples/databricks-demo');
  const result = { skills: [], extensions: [], skipped: [] };

  // Skills: the folder the app's agent reads.
  const skillsFrom = join(demo, 'skills');
  const skillsTo = join(root, 'goose-home/.agents/skills');
  for (const entry of readdirSync(skillsFrom, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(join(skillsFrom, entry.name, 'SKILL.md'))) continue;
    mkdirSync(join(skillsTo, entry.name), { recursive: true });
    cpSync(join(skillsFrom, entry.name, 'SKILL.md'), join(skillsTo, entry.name, 'SKILL.md'));
    result.skills.push(entry.name);
  }
  if (skillsOnly) return result;

  if (host !== undefined) {
    let url;
    try {
      url = new URL(host);
    } catch {
      throw new Error('--host must be a full address such as https://adb-123.4.azuredatabricks.net');
    }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('--host must be https and contain no credentials');
    host = url.origin;
  }

  // Extensions: take the entries from the checked-in snippet, fill in this checkout's paths.
  const snippet = parseDocument(readFileSync(join(demo, 'goose/extensions.yaml'), 'utf8')).toJSON().extensions;
  const configPath = join(root, 'goose-home/.config/goose/config.yaml');
  const config = parseDocument(readFileSync(configPath, 'utf8'));
  for (const [name, entry] of Object.entries(snippet)) {
    if (config.getIn(['extensions', name]) && !force) {
      result.skipped.push(name);
      continue;
    }
    const filled = { ...entry, args: entry.args.map((arg) => arg.replace('<REPO>', root)) };
    if (name === 'databricks' && host) filled.envs = { ...filled.envs, DATABRICKS_HOST: host };
    config.setIn(['extensions', name], filled);
    result.extensions.push(name);
  }
  writeFileSync(configPath, config.toString(), 'utf8');
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  try {
    const result = installDatabricksDemo({ host: option('--host'), force: args.includes('--force'), skillsOnly: args.includes('--skills-only') });
    console.log(`Skills installed: ${result.skills.join(', ')}`);
    if (result.extensions.length) console.log(`Extensions added to goose-home/.config/goose/config.yaml: ${result.extensions.join(', ')}`);
    if (result.skipped.length) console.log(`Left unchanged (already configured, use --force to replace): ${result.skipped.join(', ')}`);
    console.log('\nNext: restart Werkbank, open Connectors & Skills, choose Configure on "databricks" and enter DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET (or DATABRICKS_TOKEN).');
    console.log('The config file now holds paths of this machine. Do not commit it.');
  } catch (error) {
    console.error(`install failed: ${error.message}`);
    process.exit(1);
  }
}
