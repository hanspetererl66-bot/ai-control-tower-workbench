import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { allCustomers, buildCustomersMigrationSql, embedPortfolio, MIGRATION_CUSTOMERS, PAGE, PORTFOLIO } from '../scripts/sync-sub4me.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const portfolio = JSON.parse(read(PORTFOLIO));
const page = JSON.parse(/id="s4m-data">\n([\s\S]*?)\n<\/script>/.exec(read(PAGE))[1]);
const customers = allCustomers(portfolio, page.customer);
const AS_OF = page.asOf;

test('the portfolio has two customers with complete, consistent data', () => {
  assert.deepEqual(customers.map((c) => c.id), ['muster', 'hanse']);
  assert.equal(new Set(customers.map((c) => c.customer.number)).size, customers.length);
  for (const c of customers) {
    assert.ok(c.profile.industry && c.profile.employees > 0 && c.profile.accountTeam.length >= 3 && c.profile.contacts.length >= 3, `${c.id}: profile`);
    for (const x of [...c.contracts, ...c.offers]) assert.equal(x.lines.reduce((a, l) => a + l.annualEur, 0), x.annualEur, `${x.id}: lines add up`);
    for (const o of c.offers) {
      assert.ok(Math.abs(o.listPriceEur * (1 - o.discountPct / 100) - o.annualEur) / o.annualEur < 0.01, `${o.id}: list price and discount`);
      if (o.contractId) assert.ok(c.contracts.some((k) => k.id === o.contractId), `${o.id}: renews a contract of the same customer`);
    }
    for (const k of c.contracts) assert.ok(k.usedUnits <= k.licensedUnits, k.id);
  }
});

test('ids are unique across customers and nothing points to another customer by accident', () => {
  const ids = (list) => list.map((x) => x.id);
  for (const key of ['contracts', 'offers', 'invoices']) {
    const all = customers.flatMap((c) => ids(c[key]));
    assert.equal(new Set(all).size, all.length, `${key}: unique ids`);
  }
  const tickets = [...page.tickets, ...portfolio.otherCustomers.flatMap((c) => c.tickets)];
  assert.equal(new Set(ids(tickets)).size, tickets.length, 'tickets: unique ids');
});

test('the second customer AI units add up like the first', () => {
  for (const c of portfolio.otherCustomers) {
    const total = c.aiUnits.monthly;
    assert.equal(c.products.reduce((a, p) => a + p.allotment, 0), c.aiUnits.allotment);
    assert.equal(c.products.reduce((a, p) => a + p.consumed, 0), total.reduce((a, b) => a + b, 0));
    total.forEach((m, i) => assert.equal(c.products.reduce((a, p) => a + p.monthly[i], 0), m, `month ${i + 1}`));
    for (const p of c.products) assert.equal(p.monthly.reduce((a, b) => a + b, 0), p.consumed, p.name);
  }
});

test('invoices belong to a contract of the customer, match its billing and agree with the contract invoicing block', () => {
  for (const c of customers) {
    for (const i of c.invoices) {
      const k = c.contracts.find((x) => x.id === i.contractId);
      assert.ok(k, `${i.id}: contract ${i.contractId}`);
      assert.equal(i.poNumber, k.poNumber, `${i.id}: PO number from the contract`);
      assert.equal(i.grossEur, Math.round(i.netEur * (1 + i.vatPct / 100) * 100) / 100, `${i.id}: gross`);
      assert.equal(i.type === 'Credit note', i.netEur < 0, `${i.id}: credit notes are negative`);
      if (i.type === 'Invoice') assert.ok(i.netEur <= k.annualEur, `${i.id}: not more than a year`);
      const paid = i.status === 'Paid' || i.status === 'Settled';
      assert.equal(Boolean(i.paidOn), paid, `${i.id}: paid date only when paid`);
      if (!paid) assert.equal(i.status, i.due < AS_OF ? 'Overdue' : 'Open', `${i.id}: open or overdue by due date`);
      assert.ok(i.issued <= AS_OF && i.due >= i.issued, `${i.id}: dates`);
    }
    for (const k of c.contracts) {
      const open = c.invoices.filter((i) => i.contractId === k.id && (i.status === 'Open' || i.status === 'Overdue'));
      assert.equal(k.invoicing.openInvoices, open.length, `${k.id}: open invoice count`);
      assert.equal(k.invoicing.openAmountEur, open.reduce((a, i) => a + i.netEur, 0), `${k.id}: open amount`);
    }
  }
});

test('customer data uses reserved .example domains only', () => {
  const emails = JSON.stringify(portfolio).match(/[\w.+-]+@[\w.-]+/g) ?? [];
  for (const e of emails) assert.match(e, /@(example\.com|[\w-]+\.example)$/, e);
});

test('sample SAP notes are clearly fictional and every scenario has a defined outcome', () => {
  const k = portfolio.knowledge;
  assert.match(k.note, /not SAP Notes/);
  for (const n of k.sapNotes) assert.match(n.id, /^SAMPLE-\d{4}$/);
  for (const s of k.scenarios) assert.ok(customers.some((c) => c.id === s.customer));
});

test('the page and the migration are generated and the migration only exposes service-role functions', () => {
  assert.equal(embedPortfolio(read(PAGE), portfolio), read(PAGE), 'run: npm run sync:sub4me');
  const sql = buildCustomersMigrationSql(portfolio, page.customer);
  assert.equal(sql, read(MIGRATION_CUSTOMERS), 'run: npm run sync:sub4me');
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/i);
  for (const fn of ['sub4me_portfolio(text)', 'sub4me_tickets(text)', 'sub4me_create_ticket(text, text, text, text, text)', 'sub4me_link_ticket(text, text, text, text)', 'sub4me_invoices(text)']) {
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role`), fn);
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
  }
  assert.match(sql, /drop function if exists public\.sub4me_tickets\(\)/);
  for (const c of customers) for (const i of c.invoices) assert.ok(sql.includes(`'${i.id}'`), i.id);
});
