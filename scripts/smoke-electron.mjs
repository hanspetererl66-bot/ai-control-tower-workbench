#!/usr/bin/env node
// Smoke test for the real Electron app: start it, drive the window over the Chromium
// DevTools protocol, check a few things, take screenshots, quit.
//
//   npm run smoke:electron [-- --port 9333 --out <dir> --keep]
//
// What it checks: window title, Goose server on port 3299, the cover sheet opens from the
// logo with the cover title, the chat view renders. It uses your real goose-home (config.yaml,
// connectors) and opens a window on your desktop, so run it on a machine with a display.
// Not covered: agent runs, live services, other views.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const PORT = Number(opt('port', 9333));
const OUT = opt('out', join(tmpdir(), 'werkbank-smoke'));
const KEEP = argv.includes('--keep');
const VITE_PORT = 5273; // fixed in electron/main.mjs (DEV_URL)
const GOOSE_PORT = 3299; // fixed in electron/main.mjs (GOOSE_PORT)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: 'localhost' }); // localhost: Vite may listen on IPv6 only
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });
}
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const children = [];
async function cleanup(cdp) {
  if (!KEEP) {
    // The app quits without answering Browser.close, so do not wait for the reply.
    if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(3000)]);
    await sleep(1500);
    for (const c of children.reverse()) if (c.exitCode === null) c.kill();
  }
}

if (await portOpen(PORT)) {
  console.error(`Port ${PORT} is already in use (another app instance with a debug port?). Use --port.`);
  process.exit(2);
}
if (await portOpen(GOOSE_PORT)) {
  console.error(`Port ${GOOSE_PORT} is already in use: a Werkbank instance is probably running. Quit it first.`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

let cdp;
try {
  if (!(await portOpen(VITE_PORT))) {
    console.log(`Starting the Vite dev server on ${VITE_PORT} ...`);
    children.push(spawn(join(ROOT, 'node_modules/.bin/vite'), ['--port', String(VITE_PORT)], { cwd: ROOT, stdio: 'ignore' }));
    await waitFor(() => portOpen(VITE_PORT), 30000, 'the Vite dev server');
  }
  console.log('Starting Electron ...');
  children.push(spawn(join(ROOT, 'node_modules/electron/dist/electron'), ['.', `--remote-debugging-port=${PORT}`], { cwd: ROOT, stdio: 'ignore' }));
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    return pages.find((p) => p.type === 'page' && p.url.startsWith('http://localhost'));
  }, 45000, 'the app window');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('DevTools connection failed')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  cdp = { send };
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `${name}.png`);
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return file;
  };

  await waitFor(() => ev('!!document.querySelector(".rail-logo")'), 30000, 'the UI to render');
  const title = await ev('document.title');
  check('window title', /Joule Work X/.test(title), title);
  check('Goose server is listening', await waitFor(() => portOpen(GOOSE_PORT), 20000, 'the Goose server').catch(() => false), `port ${GOOSE_PORT}`);
  check('chat input is rendered', await ev('!!document.querySelector("textarea, [contenteditable]")'));
  console.log(`     screenshot: ${await shot('01-start')}`);

  await ev('document.querySelector(".rail-logo").click()');
  const cover = await waitFor(() => ev('document.querySelector(".cover-title")?.innerText'), 5000, 'the cover sheet').catch(() => null);
  check('cover sheet opens from the logo', !!cover, JSON.stringify(cover));
  check('cover title is "Joule Work X"', !!cover && cover.startsWith('Joule Work X'));
  console.log(`     screenshot: ${await shot('02-cover')}`);
  ws.close();
} catch (e) {
  check('run', false, e.message);
} finally {
  await cleanup(cdp);
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
