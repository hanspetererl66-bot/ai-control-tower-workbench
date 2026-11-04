-- Sample customer with a poor payment record (fictional), so the late-payment forecast has something to show.
-- Muster and Hanse pay about three days early on average; Nordlicht pays 9 to 35 days after the due date.
insert into sub4me.customers (id, name, number, sap_customer_id, contact, country, profile) values
  ('nordlicht', 'Nordlicht Maschinenbau GmbH', '100-845-217', '0010084217', 'K. Brandt', 'Germany',
   '{"industry":"Mechanical engineering","employees":1900,"headquarters":"Kiel, Germany","customerSince":2023,"segment":"Mid-size enterprise","fiscalYearEnd":"12-31","legalEntities":["Nordlicht Maschinenbau GmbH, Kiel"],"accountTeam":[{"name":"Sven Albrecht","role":"Account Executive, SAP","email":"sven.albrecht@example.com"}],"contacts":[{"name":"Katrin Brandt","role":"Head of Accounts Payable","email":"k.brandt@nordlicht-maschinenbau.example"}],"landscape":["S/4HANA Cloud Public Edition for two plants"],"notes":"Sample customer with a poor payment record. Payments arrive 9 to 35 days after the due date; reminders usually trigger payment within a week.","sapCustomerId":"0010084217"}'::jsonb)
on conflict (id) do nothing;

insert into sub4me.contracts (id, sort_order, product, scope, start_date, end_date, annual_eur, status, notice_days, contract_type, signed_on, currency, billing_cycle, payment_terms, po_number, cost_center, legal_entity, governing_law, auto_renew, renewal_term_months, unit, invoicing, customer_id) values
  ('C-2024-0820', 20, 'S/4HANA Cloud Public Edition', '300 users, 1 tenant set', '2024-07-01', '2027-06-30', 336000, 'Active', 90, 'Subscription', '2024-05-15', 'EUR', 'Quarterly in advance', '30 days net', 'PO-8800820017', 'CC-1000 Finance', 'Nordlicht Maschinenbau GmbH, Kiel', 'German law', false, 12, 'users',
   '{"openInvoices":2,"openAmountEur":200200,"paymentStatus":"Overdue"}'::jsonb, 'nordlicht')
on conflict (id) do nothing;

-- Ten quarterly invoices of 84,000 EUR net, 30 days net. The first eight were paid late, the ninth is overdue, the tenth is open.
insert into sub4me.invoices (id, customer_id, contract_id, type, period, issued_on, due_on, net_eur, vat_pct, gross_eur, status, paid_on, po_number, description)
select
  'INV-' || to_char(q.issued, 'YYYY') || '-N' || lpad(q.n::text, 4, '0'),
  'nordlicht', 'C-2024-0820', 'Invoice',
  to_char(q.issued, 'YYYY-MM-DD') || ' to ' || to_char((q.issued + interval '3 months' - interval '1 day')::date, 'YYYY-MM-DD'),
  q.issued, (q.issued + 30), 84000, 19, 99960,
  case when q.n <= 8 then 'Paid' when q.n = 9 then 'Overdue' else 'Open' end,
  case when q.n <= 8 then q.issued + 30 + (array[14,21,9,28,35,18,26,31])[q.n] end,
  'PO-8800820017', 'S/4HANA Cloud Public Edition, quarterly in advance'
from (
  select n, case when n = 10 then date '2026-10-15' else (date '2024-07-01' + ((n - 1) * interval '3 months'))::date end as issued
  from generate_series(1, 10) as n
) q
on conflict (id) do nothing;
