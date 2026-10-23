/**
 * Sub4Me contracts and offers: examples/sub4me/portfolio.json is the single source.
 * This script embeds it into the Space page and writes the Supabase migration that creates and seeds the same data.
 *   npm run sync:sub4me           write both
 *   npm run sync:sub4me -- --check  fail when either is out of date
 * Fictional sample data.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PORTFOLIO = 'examples/sub4me/portfolio.json';
export const PAGE = 'examples/sub4me/index.html';
export const MIGRATION = 'supabase/migrations/20261019_011_sub4me_contracts_offers.sql';
export const MIGRATION_CUSTOMERS = 'supabase/migrations/20261021_015_sub4me_customers.sql';
const BLOCK = /(<script type="application\/json" id="s4m-data">\n)([\s\S]*?)(\n<\/script>)/;

export function embedPortfolio(html, portfolio) {
  const match = BLOCK.exec(html);
  if (!match) throw new Error('Sub4Me data block not found');
  const data = JSON.parse(match[2]);
  data.customer = { id: 'muster', ...data.customer };
  data.contracts = portfolio.contracts;
  data.offers = portfolio.offers;
  data.invoices = portfolio.invoices;
  data.profile = portfolio.profile;
  data.otherCustomers = portfolio.otherCustomers;
  data.knowledge = portfolio.knowledge;
  return html.replace(BLOCK, (_all, open, _body, close) => `${open}${JSON.stringify(data, null, 2).replace(/<\//g, '<\\/')}${close}`);
}

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? 'null' : String(Number(v)));
const j = (v) => `${q(JSON.stringify(v))}::jsonb`;
const bool = (v) => (v ? 'true' : 'false');

const CONTRACT_COLS = ['id', 'sort_order', 'product', 'scope', 'start_date', 'end_date', 'annual_eur', 'status', 'notice_days', 'contract_type', 'signed_on', 'currency', 'billing_cycle', 'payment_terms', 'po_number', 'cost_center', 'legal_entity', 'governing_law', 'auto_renew', 'renewal_term_months', 'price_uplift_cap_pct', 'discount_pct', 'sap_owner', 'csm', 'customer_owner', 'sla', 'data_center', 'deployment', 'licensed_units', 'used_units', 'unit', 'invoicing', 'termination', 'notes'];
const OFFER_COLS = ['id', 'sort_order', 'type', 'product', 'contract_id', 'scope', 'start_date', 'end_date', 'annual_eur', 'current_annual_eur', 'valid_until', 'status', 'created_on', 'owner', 'stage', 'probability_pct', 'list_price_eur', 'discount_pct', 'billing_cycle', 'payment_terms', 'term_months', 'auto_renew', 'price_uplift_cap_pct', 'price_guarantee_months', 'approval', 'competitor', 'next_step', 'conditions'];

const contractRow = (c, i) => [q(c.id), i, q(c.product), q(c.scope), q(c.start), q(c.end), n(c.annualEur), q(c.status), n(c.noticeDays), q(c.contractType), q(c.signedOn), q('EUR'), q(c.billingCycle), q(c.paymentTerms), q(c.poNumber), q(c.costCenter), q(c.legalEntity), q(c.governingLaw), bool(c.autoRenew), n(c.renewalTermMonths), n(c.priceUpliftCapPct), n(c.discountPct), j(c.sapOwner), j(c.csm), j(c.customerOwner), j(c.sla), q(c.dataCenter), q(c.deployment), n(c.licensedUnits), n(c.usedUnits), q(c.unit), j(c.invoicing), q(c.termination), q(c.notes)];
const offerRow = (o, i) => [q(o.id), i, q(o.type), q(o.product), q(o.contractId), q(o.scope), q(o.start), q(o.end), n(o.annualEur), n(o.currentAnnualEur), q(o.validUntil), q(o.status), q(o.createdOn), j(o.owner), q(o.stage), n(o.probabilityPct), n(o.listPriceEur), n(o.discountPct), q(o.billingCycle), q(o.paymentTerms), n(o.termMonths), bool(o.autoRenew), n(o.upliftCapPct), n(o.priceGuaranteeMonths), q(o.approval), q(o.competitor), q(o.nextStep), q(o.conditions)];

const upsert = (table, cols, rows) =>
  `insert into ${table} (${cols.join(', ')}) values\n${rows.map((r) => `  (${r.join(', ')})`).join(',\n')}\non conflict (id) do update set\n${cols.slice(1).map((c) => `  ${c} = excluded.${c}`).join(',\n')};\n`;

const lineInserts = (table, fk, owner, lines) =>
  lines.length ? `insert into ${table} (${fk}, position, component, quantity, unit, unit_price_eur, annual_eur) values\n${lines.map((l, i) => `  (${q(owner)}, ${i + 1}, ${q(l.component)}, ${n(l.quantity)}, ${q(l.unit)}, ${n(l.unitPriceEur)}, ${n(l.annualEur)})`).join(',\n')};\n` : '';

function portfolioFunctionSql(byCustomer) {
  const d = (col) => `to_char(${col}, 'YYYY-MM-DD')`;
  const lineJson = (table, fk, alias) => `coalesce((select jsonb_agg(jsonb_build_object('component', l.component, 'quantity', l.quantity, 'unit', l.unit, 'unitPriceEur', l.unit_price_eur, 'annualEur', l.annual_eur) order by l.position) from ${table} l where l.${fk} = ${alias}.id), '[]'::jsonb)`;
  return `
create or replace function public.sub4me_portfolio(${byCustomer ? "p_customer text default 'muster'" : ''})
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contracts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'product', c.product, 'scope', c.scope, 'start', ${d('c.start_date')}, 'end', ${d('c.end_date')},
      'annualEur', c.annual_eur, 'status', c.status, 'noticeDays', c.notice_days, 'contractType', c.contract_type,
      'signedOn', ${d('c.signed_on')}, 'currency', c.currency, 'billingCycle', c.billing_cycle, 'paymentTerms', c.payment_terms,
      'poNumber', c.po_number, 'costCenter', c.cost_center, 'legalEntity', c.legal_entity, 'governingLaw', c.governing_law,
      'autoRenew', c.auto_renew, 'renewalTermMonths', c.renewal_term_months, 'priceUpliftCapPct', c.price_uplift_cap_pct,
      'discountPct', c.discount_pct, 'sapOwner', c.sap_owner, 'csm', c.csm, 'customerOwner', c.customer_owner, 'sla', c.sla,
      'dataCenter', c.data_center, 'deployment', c.deployment, 'licensedUnits', c.licensed_units, 'usedUnits', c.used_units,
      'unit', c.unit, 'invoicing', c.invoicing, 'termination', c.termination, 'notes', c.notes,
      'lines', ${lineJson('sub4me.contract_lines', 'contract_id', 'c')}) order by c.sort_order, c.id) from sub4me.contracts c${byCustomer ? ' where c.customer_id = p_customer' : ''}), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'type', o.type, 'product', o.product, 'contractId', o.contract_id, 'scope', o.scope,
      'start', ${d('o.start_date')}, 'end', ${d('o.end_date')}, 'annualEur', o.annual_eur, 'currentAnnualEur', o.current_annual_eur,
      'validUntil', ${d('o.valid_until')}, 'status', o.status, 'createdOn', ${d('o.created_on')}, 'owner', o.owner, 'stage', o.stage,
      'probabilityPct', o.probability_pct, 'listPriceEur', o.list_price_eur, 'discountPct', o.discount_pct,
      'billingCycle', o.billing_cycle, 'paymentTerms', o.payment_terms, 'termMonths', o.term_months, 'autoRenew', o.auto_renew,
      'upliftCapPct', o.price_uplift_cap_pct, 'priceGuaranteeMonths', o.price_guarantee_months, 'approval', o.approval,
      'competitor', o.competitor, 'nextStep', o.next_step, 'conditions', o.conditions,
      'lines', ${lineJson('sub4me.offer_lines', 'offer_id', 'o')}) order by o.sort_order, o.id) from sub4me.offers o${byCustomer ? ' where o.customer_id = p_customer' : ''}), '[]'::jsonb)${byCustomer ? `,
    'invoices', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'contractId', i.contract_id, 'type', i.type, 'period', i.period, 'issued', ${d('i.issued_on')}, 'due', ${d('i.due_on')},
      'netEur', i.net_eur, 'vatPct', i.vat_pct, 'grossEur', i.gross_eur, 'status', i.status, 'paidOn', ${d('i.paid_on')},
      'poNumber', i.po_number, 'description', i.description) order by i.issued_on desc, i.id) from sub4me.invoices i where i.customer_id = p_customer), '[]'::jsonb),
    'customer', (select jsonb_build_object('id', k.id, 'name', k.name, 'number', k.number, 'contact', k.contact, 'country', k.country, 'profile', k.profile) from sub4me.customers k where k.id = p_customer)` : ''}
  );
$$;

${byCustomer ? "drop function if exists public.sub4me_portfolio();\n" : ''}revoke all on function public.sub4me_portfolio(${byCustomer ? 'text' : ''}) from public, anon, authenticated;
grant execute on function public.sub4me_portfolio(${byCustomer ? 'text' : ''}) to service_role;
`;
}

export function buildMigrationSql(p) {
  const ids = (list) => list.map((x) => q(x.id)).join(', ');
  const parts = [];
  parts.push(`-- Sub4Me contracts and offers with extended attributes (fictional sample data).
-- GENERATED by scripts/sync-sub4me.mjs from examples/sub4me/portfolio.json. Do not edit by hand: change the JSON and run npm run sync:sub4me.
-- Safe to run more than once: tables are created if missing, the sample rows are upserted.
-- Only public.sub4me_portfolio() is callable, and only with the server-side secret key.
create schema if not exists sub4me;
revoke all on schema sub4me from anon, authenticated;

create table if not exists sub4me.contracts (
  id text primary key,
  sort_order int not null default 0,
  product text not null,
  scope text not null default '',
  start_date date not null,
  end_date date not null,
  annual_eur numeric(14,2) not null,
  status text not null check (status in ('Active','Renewal due','Expired')),
  notice_days int not null default 0,
  contract_type text,
  signed_on date,
  currency text not null default 'EUR',
  billing_cycle text,
  payment_terms text,
  po_number text,
  cost_center text,
  legal_entity text,
  governing_law text,
  auto_renew boolean not null default false,
  renewal_term_months int,
  price_uplift_cap_pct numeric(5,2),
  discount_pct numeric(5,2),
  sap_owner jsonb,
  csm jsonb,
  customer_owner jsonb,
  sla jsonb,
  data_center text,
  deployment text,
  licensed_units numeric,
  used_units numeric,
  unit text,
  invoicing jsonb,
  termination text,
  notes text
);
create table if not exists sub4me.contract_lines (
  contract_id text not null references sub4me.contracts(id) on delete cascade,
  position int not null,
  component text not null,
  quantity numeric not null,
  unit text not null,
  unit_price_eur numeric(14,2) not null,
  annual_eur numeric(14,2) not null,
  primary key (contract_id, position)
);
create table if not exists sub4me.offers (
  id text primary key,
  sort_order int not null default 0,
  type text not null check (type in ('Renewal','New product')),
  product text not null,
  contract_id text references sub4me.contracts(id),
  scope text not null default '',
  start_date date not null,
  end_date date not null,
  annual_eur numeric(14,2) not null,
  current_annual_eur numeric(14,2) not null default 0,
  valid_until date not null,
  status text not null check (status in ('Open','In negotiation','Accepted','Declined','Expired')),
  created_on date,
  owner jsonb,
  stage text,
  probability_pct int check (probability_pct between 0 and 100),
  list_price_eur numeric(14,2),
  discount_pct numeric(5,2),
  billing_cycle text,
  payment_terms text,
  term_months int,
  auto_renew boolean not null default false,
  price_uplift_cap_pct numeric(5,2),
  price_guarantee_months int,
  approval text,
  competitor text,
  next_step text,
  conditions text
);
create table if not exists sub4me.offer_lines (
  offer_id text not null references sub4me.offers(id) on delete cascade,
  position int not null,
  component text not null,
  quantity numeric not null,
  unit text not null,
  unit_price_eur numeric(14,2) not null,
  annual_eur numeric(14,2) not null,
  primary key (offer_id, position)
);
alter table sub4me.contracts enable row level security;
alter table sub4me.contract_lines enable row level security;
alter table sub4me.offers enable row level security;
alter table sub4me.offer_lines enable row level security;
revoke all on sub4me.contracts, sub4me.contract_lines, sub4me.offers, sub4me.offer_lines from anon, authenticated;
`);
  parts.push(upsert('sub4me.contracts', CONTRACT_COLS, p.contracts.map(contractRow)));
  parts.push(`delete from sub4me.contract_lines where contract_id in (${ids(p.contracts)});\n`);
  for (const c of p.contracts) parts.push(lineInserts('sub4me.contract_lines', 'contract_id', c.id, c.lines));
  parts.push(upsert('sub4me.offers', OFFER_COLS, p.offers.map(offerRow)));
  parts.push(`delete from sub4me.offer_lines where offer_id in (${ids(p.offers)});\n`);
  for (const o of p.offers) parts.push(lineInserts('sub4me.offer_lines', 'offer_id', o.id, o.lines));
  const lineJson = (table, fk, alias) => `coalesce((select jsonb_agg(jsonb_build_object('component', l.component, 'quantity', l.quantity, 'unit', l.unit, 'unitPriceEur', l.unit_price_eur, 'annualEur', l.annual_eur) order by l.position) from ${table} l where l.${fk} = ${alias}.id), '[]'::jsonb)`;
  parts.push(portfolioFunctionSql(false));
  return parts.join('\n');
}

/** Every customer of the portfolio in one list: the primary (Muster, from the page data) first. */
export function allCustomers(p, primary) {
  return [{ id: 'muster', customer: primary, profile: p.profile, contracts: p.contracts, offers: p.offers, invoices: p.invoices }, ...p.otherCustomers];
}

const INVOICE_COLS = ['id', 'customer_id', 'contract_id', 'type', 'period', 'issued_on', 'due_on', 'net_eur', 'vat_pct', 'gross_eur', 'status', 'paid_on', 'po_number', 'description'];
const invoiceRow = (customerId) => (i) => [q(i.id), q(customerId), q(i.contractId), q(i.type), q(i.period), q(i.issued), q(i.due), n(i.netEur), n(i.vatPct), n(i.grossEur), q(i.status), q(i.paidOn), q(i.poNumber), q(i.description)];

/** Migration 015: second customer, invoices, customer-aware functions, ticket linking. Primary customer data comes from the page. */
export function buildCustomersMigrationSql(p, primary) {
  const customers = allCustomers(p, primary);
  const others = p.otherCustomers;
  const parts = [];
  parts.push(`-- Sub4Me: several customers, invoices and ticket linking (fictional sample data).
-- GENERATED by scripts/sync-sub4me.mjs from examples/sub4me/portfolio.json. Do not edit by hand: change the JSON and run npm run sync:sub4me.
-- Run after 006 and 011. Safe to run more than once. Existing rows belong to the customer 'muster'.
-- All functions are callable with the server-side secret key only.
create table if not exists sub4me.customers (
  id text primary key,
  name text not null,
  number text not null,
  contact text,
  country text,
  profile jsonb not null default '{}'::jsonb
);
alter table sub4me.customers enable row level security;
revoke all on sub4me.customers from anon, authenticated;
`);
  parts.push(upsert('sub4me.customers', ['id', 'name', 'number', 'contact', 'country', 'profile'], customers.map((c) => [q(c.id), q(c.customer.name), q(c.customer.number), q(c.customer.contact), q(c.customer.country), j(c.profile)])));
  parts.push(`alter table sub4me.contracts add column if not exists customer_id text not null default 'muster' references sub4me.customers(id);
alter table sub4me.offers add column if not exists customer_id text not null default 'muster' references sub4me.customers(id);
alter table sub4me.tickets add column if not exists customer_id text not null default 'muster' references sub4me.customers(id);

create table if not exists sub4me.invoices (
  id text primary key,
  customer_id text not null references sub4me.customers(id),
  contract_id text not null references sub4me.contracts(id),
  type text not null check (type in ('Invoice','Credit note')),
  period text,
  issued_on date not null,
  due_on date not null,
  net_eur numeric(14,2) not null,
  vat_pct numeric(5,2) not null default 19,
  gross_eur numeric(14,2) not null,
  status text not null check (status in ('Paid','Open','Overdue','Settled')),
  paid_on date,
  po_number text,
  description text
);
alter table sub4me.invoices enable row level security;
revoke all on sub4me.invoices from anon, authenticated;

-- A ticket can be followed by another customer (no new ticket) or linked to a new ticket (related).
create table if not exists sub4me.ticket_links (
  ticket_id text not null references sub4me.tickets(id),
  customer_id text not null references sub4me.customers(id),
  kind text not null check (kind in ('follows','related')),
  new_ticket_id text references sub4me.tickets(id),
  created_at timestamptz not null default now(),
  primary key (ticket_id, customer_id, kind)
);
alter table sub4me.ticket_links enable row level security;
revoke all on sub4me.ticket_links from anon, authenticated;
`);
  const withCustomer = (cols, rows, customerId) => ({ cols: [...cols, 'customer_id'], rows: rows.map((r) => [...r, q(customerId)]) });
  for (const c of others) {
    const k = withCustomer(CONTRACT_COLS, c.contracts.map((x, i) => contractRow(x, 100 + i)), c.id);
    parts.push(upsert('sub4me.contracts', k.cols, k.rows));
    parts.push(`delete from sub4me.contract_lines where contract_id in (${c.contracts.map((x) => q(x.id)).join(', ')});\n`);
    for (const x of c.contracts) parts.push(lineInserts('sub4me.contract_lines', 'contract_id', x.id, x.lines));
    const o = withCustomer(OFFER_COLS, c.offers.map((x, i) => offerRow(x, 100 + i)), c.id);
    parts.push(upsert('sub4me.offers', o.cols, o.rows));
    parts.push(`delete from sub4me.offer_lines where offer_id in (${c.offers.map((x) => q(x.id)).join(', ')});\n`);
    for (const x of c.offers) parts.push(lineInserts('sub4me.offer_lines', 'offer_id', x.id, x.lines));
  }
  for (const c of customers) parts.push(upsert('sub4me.invoices', INVOICE_COLS, c.invoices.map(invoiceRow(c.id))));
  for (const c of others) {
    parts.push(`insert into sub4me.tickets (id, title, product, priority, status, description, created_on, updated_on, created_at, customer_id) values\n${c.tickets.map((t) => `  (${[q(t.id), q(t.title), q(t.product), q(t.priority), q(t.status), q(t.description), q(t.created), q(t.updated), q(t.created + ' 08:00+00'), q(c.id)].join(', ')})`).join(',\n')}\non conflict (id) do nothing;\n`);
  }
  parts.push(portfolioFunctionSql(true));
  parts.push(`
drop function if exists public.sub4me_tickets();
drop function if exists public.sub4me_create_ticket(text, text, text, text);

-- Tickets of one customer (plus tickets it follows), or all tickets when p_customer is null.
create or replace function public.sub4me_tickets(p_customer text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'title', t.title, 'product', t.product, 'priority', t.priority, 'status', t.status,
    'description', t.description, 'created', to_char(t.created_on, 'YYYY-MM-DD'), 'updated', to_char(t.updated_on, 'YYYY-MM-DD'),
    'customer', t.customer_id,
    'shared', t.customer_id <> coalesce(p_customer, t.customer_id),
    'followers', (select count(*) from sub4me.ticket_links l where l.ticket_id = t.id and l.kind = 'follows'),
    'relatedTo', (select l.ticket_id from sub4me.ticket_links l where l.new_ticket_id = t.id limit 1))
    order by t.created_at desc, t.id desc), '[]'::jsonb)
  from sub4me.tickets t
  where p_customer is null
     or t.customer_id = p_customer
     or exists (select 1 from sub4me.ticket_links l where l.ticket_id = t.id and l.customer_id = p_customer and l.kind = 'follows');
$$;

create or replace function public.sub4me_create_ticket(p_title text, p_product text, p_priority text, p_description text default '', p_customer text default 'muster')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id text := 'TKT-' || nextval('sub4me.ticket_seq');
  row_ sub4me.tickets;
begin
  insert into sub4me.tickets (id, title, product, priority, description, customer_id)
  values (new_id, btrim(p_title), btrim(p_product), p_priority, coalesce(p_description, ''), p_customer)
  returning * into row_;
  return jsonb_build_object('id', row_.id, 'title', row_.title, 'product', row_.product, 'priority', row_.priority,
    'status', row_.status, 'description', row_.description, 'customer', row_.customer_id,
    'created', to_char(row_.created_on, 'YYYY-MM-DD'), 'updated', to_char(row_.updated_on, 'YYYY-MM-DD'));
end;
$$;

-- Link a customer to an existing ticket instead of opening a new one ('follows'),
-- or record that a new ticket belongs to an existing one ('related').
create or replace function public.sub4me_link_ticket(p_ticket text, p_customer text, p_kind text default 'follows', p_new_ticket text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('follows','related') then raise exception 'kind must be follows or related'; end if;
  if p_kind = 'related' and p_new_ticket is null then raise exception 'a related link needs the new ticket'; end if;
  insert into sub4me.ticket_links (ticket_id, customer_id, kind, new_ticket_id)
  values (p_ticket, p_customer, p_kind, p_new_ticket)
  on conflict (ticket_id, customer_id, kind) do update set new_ticket_id = excluded.new_ticket_id;
  update sub4me.tickets set updated_on = current_date where id = p_ticket;
  return jsonb_build_object('ticket', p_ticket, 'customer', p_customer, 'kind', p_kind, 'newTicket', p_new_ticket,
    'followers', (select count(*) from sub4me.ticket_links l where l.ticket_id = p_ticket and l.kind = 'follows'));
end;
$$;

create or replace function public.sub4me_invoices(p_customer text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'customer', i.customer_id, 'contractId', i.contract_id, 'type', i.type, 'period', i.period,
    'issued', to_char(i.issued_on, 'YYYY-MM-DD'), 'due', to_char(i.due_on, 'YYYY-MM-DD'), 'netEur', i.net_eur, 'vatPct', i.vat_pct,
    'grossEur', i.gross_eur, 'status', i.status, 'paidOn', to_char(i.paid_on, 'YYYY-MM-DD'), 'poNumber', i.po_number, 'description', i.description)
    order by i.issued_on desc, i.id), '[]'::jsonb)
  from sub4me.invoices i where p_customer is null or i.customer_id = p_customer;
$$;

create or replace function public.sub4me_customers()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'number', k.number, 'contact', k.contact, 'country', k.country) order by k.name), '[]'::jsonb)
  from sub4me.customers k;
$$;

revoke all on function public.sub4me_tickets(text) from public, anon, authenticated;
revoke all on function public.sub4me_create_ticket(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.sub4me_link_ticket(text, text, text, text) from public, anon, authenticated;
revoke all on function public.sub4me_invoices(text) from public, anon, authenticated;
revoke all on function public.sub4me_customers() from public, anon, authenticated;
grant execute on function public.sub4me_tickets(text) to service_role;
grant execute on function public.sub4me_create_ticket(text, text, text, text, text) to service_role;
grant execute on function public.sub4me_link_ticket(text, text, text, text) to service_role;
grant execute on function public.sub4me_invoices(text) to service_role;
grant execute on function public.sub4me_customers() to service_role;
`);
  return parts.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const portfolio = JSON.parse(readFileSync(join(ROOT, PORTFOLIO), 'utf8'));
  const html = readFileSync(join(ROOT, PAGE), 'utf8');
  const embedded = embedPortfolio(html, portfolio);
  const primary = JSON.parse(BLOCK.exec(embedded)[2]).customer;
  const next = { [PAGE]: embedded, [MIGRATION]: buildMigrationSql(portfolio), [MIGRATION_CUSTOMERS]: buildCustomersMigrationSql(portfolio, primary) };
  const check = process.argv.includes('--check');
  let stale = false;
  for (const [rel, content] of Object.entries(next)) {
    let current = '';
    try { current = readFileSync(join(ROOT, rel), 'utf8'); } catch { /* new file */ }
    if (current !== content) {
      stale = true;
      if (!check) writeFileSync(join(ROOT, rel), content);
    }
  }
  if (check && stale) {
    console.error('Sub4Me contracts/offers are out of sync — run: npm run sync:sub4me');
    process.exit(1);
  }
  console.log(check ? 'Sub4Me contracts/offers are in sync.' : 'Embedded portfolio and wrote the Supabase migration.');
}
