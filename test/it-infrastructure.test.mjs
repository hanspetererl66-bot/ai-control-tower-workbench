import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { embedVms, repoVms } from '../scripts/sync-it-infrastructure.mjs';
import { EXAMPLE_SPACES } from '../scripts/install-example-space.mjs';
import { SPACE_PAGES } from '../scripts/sync-design-system.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('examples/it-infrastructure/index.html');
const assess = vm.runInNewContext(`${/<script id="vm-logic">([\s\S]*?)<\/script>/.exec(page)[1]}; assess`);

test('page embeds the current VMs and design system, is installable, and has no network access', () => {
  assert.equal(embedVms(page, repoVms(), read('examples/shared/design-system.css')), page, 'run npm run sync:it-infrastructure');
  assert.equal(EXAMPLE_SPACES['it-infrastructure'], 'it-infrastructure');
  assert.ok(SPACE_PAGES.includes('examples/it-infrastructure/index.html'));
  assert.doesNotMatch(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage/);
  const meta = JSON.parse(read('examples/it-infrastructure/space.json'));
  assert.equal(meta.title, 'IT Infrastructure');
});

test('25 VMs with unique names, each colour is explained by its reasons', () => {
  const data = repoVms();
  assert.equal(data.vms.length, 25);
  assert.equal(new Set(data.vms.map((v) => v.name)).size, 25);
  const count = { green: 0, yellow: 0, red: 0 };
  for (const v of data.vms) {
    const a = assess(v, data.rules);
    count[a.status]++;
    if (a.status === 'green') assert.equal(a.reasons.length, 0, `${v.name}: green has no reasons`);
    else assert.ok(a.reasons.length > 0 && a.reasons[0].level === a.status, `${v.name}: ${a.status} is explained by its worst reason first`);
  }
  assert.deepEqual(count, { green: 16, yellow: 6, red: 3 });
});

test('rules: unreachable is red, test VMs need no backup, limits are inclusive', () => {
  const { rules } = repoVms();
  const base = { env: 'prod', reachable: true, cpuPct: 10, memPct: 10, diskPct: 10, backupAgeHours: 1, patchLagDays: 0 };
  assert.equal(assess({ ...base, reachable: false }, rules).status, 'red');
  assert.equal(assess({ ...base, env: 'test', backupAgeHours: 200 }, rules).status, 'green');
  assert.equal(assess({ ...base, backupAgeHours: 200 }, rules).status, 'red');
  assert.equal(assess({ ...base, cpuPct: 75 }, rules).status, 'yellow');
  assert.equal(assess({ ...base, cpuPct: 90 }, rules).status, 'red');
  assert.equal(assess({ ...base, diskPct: 94 }, rules).status, 'yellow');
});
