#!/usr/bin/env node
// Smoke test for the AI Governance entry page in the real Electron app: start it, drive the window over the
// Chromium DevTools protocol, click through the tiles and subspaces, take screenshots, quit.
//
//   npm run smoke:governance [-- --port 9333 --out <dir> --keep]
//
// Needs the Spaces installed first: node scripts/install-example-space.mjs control-tower agent-registry agent-compliance agent-observability
// (this script only reads workspace/spaces, it installs nothing). Opens a window on your
// desktop and uses your real goose-home, so run it on a machine with a display. It expands the "Governance" domain
// and the AI Control Tower subspace list in the sidebar (the app may remember that).
// Not covered: the Spaces' own content beyond the title, studio agents in the registry, agent runs, live services.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
const OUT = opt('out', join(tmpdir(), 'werkbank-smoke-governance'));
const KEEP = argv.includes('--keep');
const VITE_PORT = 5273; // fixed in electron/main.mjs (DEV_URL)
const GOOSE_PORT = 3299; // fixed in electron/main.mjs (GOOSE_PORT)
const SPACES = ['ai-control-tower', 'agent-registry', 'agent-compliance', 'agent-observability'];
const WATCHDOG_MS = 150_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: 'localhost' }); // localhost: Vite may listen on IPv6 only
  s.once('connect', () => (s.destroy(), resolve(true)));
  s.once('error', () => resolve(false));
});
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const missing = SPACES.filter((slug) => !existsSync(join(ROOT, 'workspace/spaces', slug, 'index.html')));
if (missing.length) {
  console.error(`Not installed: ${missing.join(', ')}. Run: node scripts/install-example-space.mjs control-tower agent-registry agent-compliance agent-observability`);
  process.exit(2);
}
if (await portOpen(PORT)) { console.error(`Port ${PORT} is already in use. Use --port.`); process.exit(2); }
if (await portOpen(GOOSE_PORT)) { console.error(`Port ${GOOSE_PORT} is already in use: a Werkbank instance is probably running. Quit it first.`); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const children = [];
let spawnError = null;
/** Start a child; a missing program ends up in the check output (and the cleanup), not as an unhandled error. */
const start = (command, args) => {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'ignore' });
  child.on('error', (e) => { spawnError = e; });
  children.push(child);
  return child;
};
let cdp;
async function cleanup() {
  if (!KEEP) {
    if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(3000)]); // the app quits without answering
    await sleep(1500);
    for (const c of children.reverse()) if (c.exitCode === null) c.kill();
  }
}
const watchdog = setTimeout(() => { console.log('Gave up: the run took too long.'); for (const c of children) c.kill(); process.exit(1); }, WATCHDOG_MS);

try {
  if (!(await portOpen(VITE_PORT))) {
    console.log(`Starting the Vite dev server on ${VITE_PORT} ...`);
    start(join(ROOT, 'node_modules/.bin/vite'), ['--port', String(VITE_PORT)]);
    await waitFor(() => portOpen(VITE_PORT), 30000, 'the Vite dev server');
  }
  console.log('Starting Electron ...');
  start(join(ROOT, 'node_modules/electron/dist/electron'), ['.', `--remote-debugging-port=${PORT}`]);
  const page = await waitFor(async () => {
    if (spawnError) throw new Error(`could not start ${spawnError.path ?? 'a program'}: ${spawnError.code}`);
    const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    return pages.find((p) => p.type === 'page' && p.url.startsWith('http://localhost'));
  }, 45000, 'the app window');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('DevTools connection failed')); });
  let id = 0;
  const pending = new Map();
  const frames = []; // Space iframes are separate targets: { sid, info }
  const exceptions = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Target.attachedToTarget') frames.push({ sid: m.params.sessionId, info: m.params.targetInfo });
    else if (m.method === 'Target.detachedFromTarget') { const i = frames.findIndex((x) => x.sid === m.params.sessionId); if (i >= 0) frames.splice(i, 1); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? 'exception');
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  cdp = { send };
  const ev = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result?.result?.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
    console.log(`     screenshot: ${join(OUT, `${name}.png`)}`);
  };
  /** The session of the Space iframe whose header title contains `title`. */
  const frame = (title) => waitFor(async () => {
    for (const f of [...frames].reverse()) {
      await send('Runtime.enable', {}, f.sid);
      const t = await ev('(document.querySelector(".hdr-title")?.textContent || "")', f.sid);
      if (t && t.includes(title)) return f.sid;
    }
    return null;
  }, 15000, `the Space "${title}"`);
  const clickCard = (text) => ev(`(()=>{const b=[...document.querySelectorAll('.card')].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!b)return false;b.click();return true})()`);
  const showGovernance = async () => {
    await ev('document.querySelector("[aria-label=Spaces]").click()');
    await sleep(800);
    await ev(`(()=>{for(const b of document.querySelectorAll('.domain-toggle')){if(/governance/i.test(b.textContent)&&b.getAttribute('aria-expanded')==='false')b.click()}})()`);
    await sleep(500);
    await ev(`(()=>{for(const t of document.querySelectorAll('.sub-toggle')){if(t.getAttribute('aria-expanded')==='false'&&/AI Control Tower/.test(t.getAttribute('aria-label')))t.click()}})()`);
    await sleep(500);
  };
  const tile = async (slug) => {
    const c = await frame('AI Control Tower');
    await ev(`document.querySelector('[data-hub-space="${slug}"]').click()`, c);
    await sleep(2000);
  };
  const selected = () => ev('document.querySelector(".card-on")?.innerText?.split("\\n")[0]');

  await waitFor(() => ev('!!document.querySelector(".rail-logo")'), 30000, 'the UI to render');
  await send('Runtime.enable');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await showGovernance();
  const cards = await ev('[...document.querySelectorAll(".card")].map(c=>(c.classList.contains("card-sub")?"  - ":"")+c.innerText.split("\\n")[0])');
  check('registry, compliance and observability are subspaces in the list', ['Agent Registry', 'Agent Compliance', 'Agent Observability'].every((t) => cards.some((c) => c.startsWith('  - ') && c.includes(t))), JSON.stringify(cards));
  await shot('01-spaces-list');

  check('the AI Control Tower opens', await clickCard('AI Control Tower'));
  await sleep(2500);
  let c = await frame('AI Control Tower');
  check('it opens on the AI Governance tab with four tiles', (await ev('!!document.querySelector("#page-hub.on") && document.querySelectorAll(".hub-tile").length', c)) === 4);
  await shot('02-entry');

  await tile('agent-registry');
  c = await frame('Agent Registry').catch(() => null);
  check('the registry tile opens Agent Registry', !!c && /Registry/.test((await selected()) ?? ''));
  await shot('03-registry');
  if (c) await ev('document.getElementById("hub-back").click()', c);
  await sleep(2000);
  check('the back button returns to the AI Control Tower', !!(await frame('AI Control Tower').catch(() => null)));

  await tile('agent-compliance');
  c = await frame('Agent Compliance').catch(() => null);
  check('the compliance tile opens Agent Compliance', !!c && /Compliance/.test((await selected()) ?? ''));
  await shot('04-compliance');
  if (c) await ev('document.getElementById("hub-back").click()', c);
  await sleep(2000);

  await tile('agent-observability');
  await sleep(1500);
  const now = (await selected()) ?? '';
  check('the observability tile opens Agent Observability', /Observability/.test(now), now);
  await shot('05-observability');

  await showGovernance();
  await clickCard('AI Control Tower');
  await sleep(2500);
  c = await frame('AI Control Tower');
  await ev('document.querySelector(\'[data-hub-view="studio"]\').click()', c);
  await sleep(2000);
  check('the development tile opens the Agent Studio', (await ev('document.querySelector("[aria-label=Develop]")?.classList.contains("rail-btn-on")')) === true);
  await shot('06-studio');

  check('no uncaught exceptions in the app window', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));
  ws.close();
} catch (e) {
  check('run', false, e.message);
} finally {
  clearTimeout(watchdog);
  await cleanup();
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
