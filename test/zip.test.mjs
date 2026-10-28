import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, makeZip } from '../src/zip.ts';

test('crc32 of a known string', () => assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926));

test('the zip can be listed and unpacked by unzip, with folders and umlauts', { skip: (() => { try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); return false; } catch { return true; } })() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 'p.zip');
  writeFileSync(file, makeZip([{ path: 'proj/01-intent/intent.md', text: '# Größe\n' }, { path: 'proj/02/PRD.html', text: '<p>ä</p>' }]));
  assert.match(execFileSync('unzip', ['-t', file]).toString(), /No errors detected/);
  assert.equal(execFileSync('unzip', ['-p', file, 'proj/01-intent/intent.md']).toString(), '# Größe\n');
});
