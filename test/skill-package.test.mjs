import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LIMITS, makeZip, openSkillPackage, packSkill, readZip, safeRelative } from '../electron/skill-package.mjs';
import { exportBlocker, extraFiles, importBlocked, reviewPackage } from '../src/skill-package.ts';

const MD = '---\nname: contract-check\ndescription: Checks a contract against the playbook\n---\n# Contract check\nRead the contract and list deviations.\n';

function skillDir(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skillpkg-'));
  const dir = join(root, 'contract-check');
  mkdirSync(join(dir, 'references'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), MD);
  writeFileSync(join(dir, 'references', 'playbook.md'), 'Ümlaute ÄÖÜ ß and more '.repeat(200));
  writeFileSync(join(dir, '.hidden'), 'secret');
  for (const [k, v] of Object.entries(extra)) writeFileSync(join(dir, k), v);
  return dir;
}

test('export and import round trip keeps names, umlauts and contents', () => {
  const dir = skillDir();
  const { zip, files } = packSkill('contract-check', dir);
  assert.deepEqual(files.map((f) => f.path).sort(), ['SKILL.md', 'references/playbook.md'], 'hidden files are left out');
  const pkg = openSkillPackage(zip);
  assert.equal(pkg.slug, 'contract-check');
  assert.equal(pkg.name, 'contract-check');
  assert.match(pkg.description, /playbook/);
  assert.equal(pkg.files.find((f) => f.path === 'SKILL.md').data.toString('utf8'), MD);
  assert.equal(pkg.files.find((f) => f.path === 'references/playbook.md').data.toString('utf8'), readFileSync(join(dir, 'references', 'playbook.md'), 'utf8'));
});

test('the exported zip is a real zip that unzip accepts', () => {
  const dir = skillDir();
  const out = mkdtempSync(join(tmpdir(), 'skillzip-'));
  writeFileSync(join(out, 'a.zip'), packSkill('contract-check', dir).zip);
  try {
    const listing = execFileSync('unzip', ['-t', join(out, 'a.zip')], { encoding: 'utf8' });
    assert.match(listing, /No errors detected/);
  } catch (e) {
    if (e.code === 'ENOENT') return; // unzip not installed here
    throw e;
  }
});

test('a skill zipped directly at the root takes its name from the frontmatter', () => {
  const pkg = openSkillPackage(makeZip('', [{ path: 'SKILL.md', data: Buffer.from(MD) }, { path: 'notes.md', data: Buffer.from('n') }]));
  assert.equal(pkg.slug, 'contract-check');
  assert.deepEqual(pkg.files.map((f) => f.path).sort(), ['SKILL.md', 'notes.md']);
});

test('paths that leave the skill folder are refused', () => {
  for (const bad of ['../evil.md', '/etc/passwd', 'a/../../b', 'a\\b', 'C:/x', 'a//b', '.git/config']) assert.equal(safeRelative(bad), false, bad);
  assert.equal(safeRelative('references/playbook.md'), true);
  const evil = makeZip('contract-check', [{ path: 'SKILL.md', data: Buffer.from(MD) }, { path: '../../outside.txt', data: Buffer.from('x') }]);
  assert.throws(() => openSkillPackage(evil), /Unsafe path/);
});

test('packages without SKILL.md, with several folders or a bad name are refused', () => {
  assert.throws(() => openSkillPackage(makeZip('a', [{ path: 'readme.md', data: Buffer.from('x') }])), /SKILL\.md/);
  const two = makeZip('a', [{ path: 'SKILL.md', data: Buffer.from(MD) }]);
  assert.ok(two.length > 0);
  assert.throws(() => openSkillPackage(makeZip('bad name!', [{ path: 'SKILL.md', data: Buffer.from(MD) }])), /not a valid skill name/);
  assert.throws(() => openSkillPackage(makeZip('a', [{ path: 'SKILL.md', data: Buffer.from('no frontmatter') }])), /no name/);
  assert.throws(() => openSkillPackage(Buffer.from('this is not a zip file at all, just text')), /not a zip/);
});

test('size and file count limits hold, damaged data is detected', () => {
  const big = [{ path: 'SKILL.md', data: Buffer.from(MD) }, { path: 'big.bin', data: Buffer.alloc(LIMITS.fileBytes + 1, 1) }];
  assert.throws(() => openSkillPackage(makeZip('contract-check', big)), /larger than/);
  const many = Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ path: i === 0 ? 'SKILL.md' : `f${i}.md`, data: Buffer.from(i === 0 ? MD : 'x') }));
  assert.throws(() => openSkillPackage(makeZip('contract-check', many)), /Too many/);
  const zip = Buffer.from(packSkill('contract-check', skillDir()).zip);
  zip[60] ^= 0xff; // flip a byte inside the first entry's data
  assert.throws(() => openSkillPackage(zip));
});

test('the automatic review blocks a credential on export and a red finding on import', () => {
  const clean = reviewPackage(MD);
  assert.equal(exportBlocker(clean), null);
  assert.equal(importBlocked(clean), false);
  const leaky = reviewPackage(MD + '\napi_key = "sk-abcdefghijklmnopqrstuvwxyz0123456789"\n');
  assert.match(exportBlocker(leaky) ?? '', /^Not exported:/);
  assert.equal(importBlocked(leaky), true);
  assert.deepEqual(extraFiles([{ path: 'SKILL.md', bytes: 1 }, { path: 'a.md', bytes: 1 }, { path: 'run.py', bytes: 1 }]).map((f) => f.path), ['run.py']);
});

test('the Skills view wires export, import and the confirmation dialog', () => {
  const view = readFileSync(join(import.meta.dirname, '..', 'src/ui/ManageView.tsx'), 'utf8');
  assert.match(view, /Import skill…/);
  assert.match(view, /exportBlocker\(reviewPackage/);
  assert.match(view, /<SkillImportDialog/);
  const main = readFileSync(join(import.meta.dirname, '..', 'electron/main.mjs'), 'utf8');
  for (const ch of ['skill-pack-info', 'skill-export', 'skill-import-open', 'skill-import-install']) assert.match(main, new RegExp(`'${ch}'`));
  assert.match(main, /\.skill-backups/, 'a replaced skill is backed up');
});
