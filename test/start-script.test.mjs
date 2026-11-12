import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const path = new URL('../scripts/start-werkbank.sh', import.meta.url);
const script = readFileSync(path, 'utf8');
const lines = script.split('\n').filter((l) => !l.trim().startsWith('#'));


test('the start script is valid bash (macOS ships bash 3.2)', () => {
  execFileSync('bash', ['-n', path.pathname]);
  assert.doesNotMatch(script, /\bmapfile\b|\breadarray\b|\$\{[a-z_]+,,\}|declare -A/, 'no bash 4 features');
});

test('the app starts without a bare setsid: macOS has none, so the fallback uses job control for its own process group', () => {
  const bare = lines.filter((l) => /\bsetsid\b/.test(l) && !/command -v setsid|^\s*setsid npm run dev <\/dev\/null &$/.test(l));
  assert.deepEqual(bare, [], 'setsid appears only behind the check');
  assert.match(script, /if command -v setsid >\/dev\/null 2>&1; then\n\s+setsid npm run dev <\/dev\/null &\nelse\n\s+set -m\n\s+npm run dev <\/dev\/null &\nfi\nAPP_PID=\$!/);
  assert.match(script, /kill -TERM -- "-\$APP_PID"/, 'cleanup still ends the whole process group of the app');
});

test('the port check works without ss: lsof on macOS, /dev/tcp as the last resort', () => {
  const fn = script.slice(script.indexOf('port_open() {'), script.indexOf('\n}\n', script.indexOf('port_open() {')));
  assert.ok(fn.indexOf('command -v ss') < fn.indexOf('command -v lsof') && fn.indexOf('command -v lsof') < fn.indexOf('/dev/tcp'));
  assert.match(fn, /lsof -nP -iTCP:"\$1" -sTCP:LISTEN/);
});

test('the port check finds a listening port and a free one', async () => {
  const { createServer } = await import('node:net');
  const server = createServer().listen(0, '::1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const fn = script.slice(script.indexOf('port_open() {'), script.indexOf('\n}\n', script.indexOf('port_open() {')) + 2);
  const run = (p) => { try { execFileSync('bash', ['-c', `${fn}\nport_open ${p}`]); return true; } catch { return false; } };
  assert.equal(run(port), true, 'a listener on [::1] only is found');
  server.close();
  await new Promise((r) => server.once('close', r));
  assert.equal(run(port), false, 'a free port is free');
});
