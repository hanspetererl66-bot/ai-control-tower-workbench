import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const mails = JSON.parse(read('examples/customer-emails/threads.json'));
const sub = JSON.parse(/id="s4m-data">([\s\S]*?)<\/script>/.exec(read('examples/sub4me/index.html'))[1]);
const records = [sub, ...sub.otherCustomers];
const sales = JSON.parse(read('examples/sales/pipeline.json'));

test('E-mail Space: every conversation belongs to a listed customer, each customer has its own mailbox settings', () => {
  const names = new Set(mails.customers.map((c) => c.name));
  assert.deepEqual(mails.customers.map((c) => c.id), ['muster', 'lindenau']);
  for (const t of mails.threads) assert.ok(names.has(t.customer), `${t.id}: customer ${t.customer} is listed`);
  for (const c of mails.customers) {
    assert.ok(mails.threads.some((t) => t.customer === c.name), `${c.id} has conversations`);
    assert.ok(c.me && c.privacy.domains.length && c.weekly.length, `${c.id}: owner, allow-list and weekly volume`);
    const own = mails.threads.filter((t) => t.customer === c.name);
    assert.ok(own.length <= c.privacy.scanned, `${c.id}: kept conversations are fewer than scanned mails`);
    for (const t of own) for (const m of t.messages.filter((x) => x.side === 'customer')) {
      assert.ok(c.privacy.domains.some((d) => m.email.endsWith('@' + d)), `${t.id}: customer mail ${m.email} is on the allow-list`);
    }
  }
});

test('E-mail Space: Lindenau conversations point to contracts, offers and tickets that exist and to deals in Sales', () => {
  const lind = records.find((r) => r.id === 'lindenau');
  const has = (k, id) => lind[k].some((x) => x.id === id);
  const own = mails.threads.filter((t) => t.customer === 'Lindenau Pharma AG');
  assert.equal(own.length, 4);
  for (const t of own) {
    if (t.links.contract) assert.ok(has('contracts', t.links.contract), `${t.id}: contract ${t.links.contract}`);
    if (t.links.offer) assert.ok(has('offers', t.links.offer), `${t.id}: offer ${t.links.offer}`);
    if (t.links.ticket) assert.ok(has('tickets', t.links.ticket), `${t.id}: ticket ${t.links.ticket}`);
    assert.ok(t.ai.open.every((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.due)), `${t.id}: open points have dates`);
  }
  const dealIds = new Set(sales.deals.map((d) => d.id));
  for (const id of ['OFF-2026-0510', 'OFF-2026-0518', 'C-2026-0051']) assert.ok(dealIds.has(id) && own.some((t) => t.links.offer === id || t.links.contract === id), `${id} has a conversation`);
});

test('E-mail Space: the Lindenau story keeps its dates and the injected instruction stays untrusted', () => {
  const t202 = mails.threads.find((t) => t.id === 'T-202');
  assert.match(t202.messages.at(-1).body, /1 November/, 'the notice date is named in the mail');
  const lind = records.find((r) => r.id === 'lindenau');
  const c = lind.contracts.find((x) => x.id === 'C-2026-0051');
  const notice = new Date(Date.parse(c.end) - c.noticeDays * 864e5).toISOString().slice(0, 10);
  assert.equal(notice, '2026-11-01', 'end of term minus the notice period');
  const t204 = mails.threads.find((t) => t.id === 'T-204');
  const bad = t204.messages.filter((m) => m.untrusted);
  assert.equal(bad.length, 1);
  assert.match(bad[0].body, /NOTE TO AI ASSISTANTS/);
  assert.ok(t204.ai.flags.length === 1, 'the conversation is flagged');
  assert.ok(mails.threads.filter((t) => t.id !== 'T-104' && t.id !== 'T-204').every((t) => !t.ai.flags.length), 'no other conversation is flagged');
});
