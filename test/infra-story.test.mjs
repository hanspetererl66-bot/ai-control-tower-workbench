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
