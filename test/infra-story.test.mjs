import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { STORY_SPACES, embedStory } from '../scripts/sync-infra-story.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ORDER = ['infra-wiki', 'it-fleet', 'it-infrastructure', 'it-operations', 'infra-rca', 'infra-ops', 'infra-hotline', 'infra-ops-control', 'infra-orchestrator'];

/** Runs only the story block of a Space inside a fake host frame and collects what it posts to the host. */
function open(slug, inHost = true) {
  const html = read(`examples/${slug}/index.html`);
  const block = html.match(/<!--story:start-->([\s\S]*?)<!--story:end-->/)[1];
  const dom = new JSDOM(`<body>${block}</body>`, { runScripts: 'outside-only' });
  const posted = [];
  const w = dom.window;
  Object.defineProperty(w, 'parent', { value: inHost ? { postMessage: (m) => posted.push(m) } : w });
  const script = block.match(/<script>([\s\S]*)<\/script>/)[1];
  w.eval(script);
  return { doc: w.document, posted };
}

test('the story runs through the nine Spaces in a fixed order and each page is in sync with the shared source', () => {
  assert.deepEqual(STORY_SPACES, ORDER);
  const source = read('examples/shared/infra-story.html');
  for (const slug of ORDER) assert.equal(embedStory(read(`examples/${slug}/index.html`), slug, source), read(`examples/${slug}/index.html`), `${slug}: run npm run sync:infra-story`);
});

test('every Space marks its own step, and the buttons hand over to the next Space', () => {
  ORDER.forEach((slug, i) => {
    const { doc, posted } = open(slug);
    const cur = doc.querySelector('[aria-current="step"]');
    assert.equal(cur.dataset.i, String(i), `${slug}: own step`);
    const next = doc.querySelector('.st-next');
    if (i === ORDER.length - 1) { assert.equal(next, null, 'last step has no Next'); return; }
    next.click();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, 'wb:handoff');
    assert.equal(posted[0].to, ORDER[i + 1]);
    assert.equal(posted[0].open, true);
  });
});

test('the hand-over to the service request Space carries the ticket for Muster Industrie AG', () => {
  const { doc, posted } = open('infra-rca');
  doc.querySelector('.st-next').click();
  const p = posted[0].payload;
  assert.equal(p.type, 'ticket');
  assert.match(p.id, /^[A-Z]{2,4}-\d{3,6}$/, 'the ticket id must pass the check of the change Space');
  assert.equal(p.customerName, 'Muster Industrie AG');
  assert.equal(p.kind, 'cert');
});

test('outside the host the bar only tells the story: no clickable steps', () => {
  const { doc } = open('it-fleet', false);
  assert.ok([...doc.querySelectorAll('#story button')].every((b) => b.disabled));
  assert.equal(doc.querySelector('.st-next'), null);
});

test('the story has one customer and one certificate through all four Spaces', () => {
  const alerts = JSON.parse(read('examples/it-operations/alerts.json')).alerts;
  const vms = JSON.parse(read('examples/it-infrastructure/vms.json'));
  const fleet = JSON.parse(read('examples/it-fleet/fleet.json'));
  const ops = JSON.parse(read('examples/infra-ops/data.json'));
  const name = 'Muster Industrie AG';
  assert.equal(vms.customer.name, name);
  assert.ok(fleet.customers.some((c) => c.name === name));
  assert.ok(ops.customers.some((c) => c.name === name));
  const vmNames = new Set(vms.vms.map((v) => v.name));
  for (const a of alerts) { assert.equal(a.customer, name, `${a.id}: customer`); assert.ok(vmNames.has(a.host), `${a.id}: host ${a.host} is a VM of Infra VM landscape`); }
  const a506 = alerts.find((a) => a.id === 'A-506'), vm = vms.vms.find((v) => v.name === a506.host);
  const days = Math.round((Date.parse(a506.text.match(/\((\d{4}-\d{2}-\d{2})\)/)[1]) - Date.parse(alerts.asOf ?? JSON.parse(read('examples/it-operations/alerts.json')).asOf)) / 864e5);
  assert.equal(vm.certExpiresInDays, days, 'A-506 and the VM wall give the same days left');
});

test('the bar starts with the SOP: one button asks the chat to read the two wiki pages with the connector tool', () => {
  const { doc, posted } = open('it-fleet');
  doc.querySelector('.st-sop').click();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, 'wb:ask');
  assert.match(posted[0].prompt, /read_wiki_page/);
  for (const page of ['renew-tls-certificate', 'patch-vm']) assert.ok(posted[0].prompt.includes(page), page);
  assert.ok(posted[0].prompt.length <= 600, 'within the host limit for Ask Joule');
  assert.doesNotMatch(posted[0].prompt, /wikipedia/i, 'the SOP is internal, not from the public Wikipedia');
  assert.equal(open('it-fleet', false).doc.querySelector('.st-sop'), null, 'outside the host there is no chat to ask');
});

test('review 14.11.2026: the Spaces that are about Muster Industrie AG name the customer for the top bar, and the ticket of the story says how many days are left', () => {
  for (const slug of ['it-infrastructure', 'it-operations', 'infra-rca']) assert.match(read(`examples/${slug}/index.html`), /<span id="wb-customer" data-wb-customer hidden>Muster Industrie AG<\/span>/, slug);
  for (const slug of ORDER) assert.match(read(`examples/${slug}/index.html`), /reasons: \['TLS certificate of edge\.muster-industrie\.example expires on 2026-10-24'\]/, `${slug}: the ticket of the story`);
  assert.doesNotMatch(read('examples/shared/infra-story.html'), /reasons: \['TLS certificate expires in days'\]/);
});

/** The data a Space embeds (its own JSON block). */
const dataOf = (slug, id) => JSON.parse(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(read(`examples/${slug}/index.html`))[1]);
const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

test('the red thread: one certificate (edge.muster-industrie.example on proxy-edge-01, expires 2026-10-24) in every Space, and the days left fit the reference date of each Space', () => {
  const EXPIRES = '2026-10-24';
  // the first days of the story, 19 Oct: Fleet, VM landscape, Alerts, RCA, Auto-fix
  const fleet = dataOf('it-fleet', 'fleet-data');
  const muster = fleet.customers.find((c) => c.id === 'musind');
  const vm = muster.vms.find((v) => v[0] === 'proxy-edge-01');
  assert.ok(vm, 'the Fleet has the edge proxy of Muster Industrie AG');
  assert.ok(!muster.vms.some((v) => v[0] === 'musind-int04'), 'the old name is gone');
  assert.equal(fleet.asOf, '2026-10-19');
  assert.equal(vm[7], days(fleet.asOf, EXPIRES), 'Fleet: days left');
  const landscape = dataOf('it-infrastructure', 'vm-data');
  const edge = landscape.vms?.find?.((v) => v.name === 'proxy-edge-01') ?? JSON.stringify(landscape).match(/"name":"proxy-edge-01"[^}]*"certExpiresInDays":(\d+)/);
  assert.equal(landscape.asOf, '2026-10-19');
  assert.equal(Number(edge.certExpiresInDays ?? edge[1]), days(landscape.asOf, EXPIRES), 'VM landscape: days left');
  const ops = dataOf('it-operations', 'ops-data');
  const a506 = ops.alerts.find((a) => a.id === 'A-506');
  assert.equal(a506.host, 'proxy-edge-01'); assert.equal(ops.asOf, '2026-10-19');
  assert.equal(a506.expiresInDays, days(ops.asOf, EXPIRES), 'Alerts: days left');
  assert.match(a506.text, new RegExp(`expires in ${a506.expiresInDays} days \\(${EXPIRES}\\)`));
  assert.equal(dataOf('infra-rca', 'rca-data').asOf, '2026-10-19');
  assert.equal(dataOf('infra-ops-control', 'ctl-data').asOf, '2026-10-19');
  // two days later, 21 Oct: Service request, Hotline, Orchestrator (and the wiki page that is read first)
  const inv = dataOf('infra-ops', 'io-data');
  const cert = inv.certs.find((c) => c.id === 'mi-edge-prd');
  assert.equal(cert.notAfter, EXPIRES); assert.deepEqual(cert.vmIds, ['proxy-edge-01']);
  assert.ok(inv.vms.some((v) => v.id === 'proxy-edge-01' && v.customer === 'mi'));
  assert.equal(inv.asOf, '2026-10-21'); assert.equal(days(inv.asOf, EXPIRES), 3, 'Service request: 3 days left, two days after the alert');
  const first = inv.certs.filter((c) => c.customer === 'mi').sort((a, b) => a.notAfter.localeCompare(b.notAfter))[0];
  assert.equal(first.id, 'mi-edge-prd', 'the ticket of the story takes the certificate of Muster Industrie AG that expires first: the edge certificate');
  const hot = dataOf('infra-hotline', 'hot-data');
  assert.equal(hot.requests.find((r) => r.id === 'SR-2090').target, 'proxy-edge-01'); assert.equal(hot.asOf, '2026-10-21');
  assert.match(hot.requests.find((r) => r.id === 'SR-2090').note, new RegExp(EXPIRES));
  const orch = dataOf('infra-orchestrator', 'orch-data');
  assert.equal(orch.asOf, '2026-10-21');
  assert.ok(!orch.findings.some((f) => f.host === 'proxy-edge-01' && f.kind === 'cert-expiry'), 'the sweep looks ahead at other certificates, not at the one of the story');
  // the ticket the story hands over, and the one the Service request builds itself, name the same host and day
  for (const slug of ORDER) assert.match(read(`examples/${slug}/index.html`), /vm: 'proxy-edge-01', kind: 'cert'/, slug);
});
