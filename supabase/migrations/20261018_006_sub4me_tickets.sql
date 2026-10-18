-- Demo tickets for the Sub4Me example Space (fictional data, temporary storage).
-- Only the two functions at the bottom are callable, and only with the server-side secret key.
create schema if not exists sub4me;
revoke all on schema sub4me from anon, authenticated;

create sequence if not exists sub4me.ticket_seq start 48214;

create table if not exists sub4me.tickets (
  id text primary key,
  title text not null check (char_length(title) between 1 and 120),
  product text not null check (char_length(product) between 1 and 80),
  priority text not null check (priority in ('Low','Medium','High','Very high')),
  status text not null default 'New' check (status in ('New','In processing','Waiting for customer','Solution provided','Closed')),
  description text not null default '' check (char_length(description) <= 2000),
  created_on date not null default current_date,
  updated_on date not null default current_date,
  created_at timestamptz not null default now()
);
alter table sub4me.tickets enable row level security;
revoke all on sub4me.tickets from anon, authenticated;
revoke all on sequence sub4me.ticket_seq from anon, authenticated;

insert into sub4me.tickets (id, title, product, priority, status, created_on, updated_on, created_at) values
  ('TKT-48213', 'Joule skill returns empty result for open purchase orders', 'Joule copilots', 'High', 'In processing', '2026-10-12', '2026-10-16', '2026-10-12 08:00+00'),
  ('TKT-48107', 'BTP AI Core deployment quota exceeded in eu10', 'BTP AI Core', 'Very high', 'Waiting for customer', '2026-10-08', '2026-10-15', '2026-10-08 08:00+00'),
  ('TKT-47888', 'Ariba approval workflow not triggering for cost centre 4711', 'Ariba AI', 'Medium', 'In processing', '2026-09-29', '2026-10-10', '2026-09-29 08:00+00'),
  ('TKT-47410', 'SuccessFactors AI job description suggestions in wrong language', 'SuccessFactors AI', 'Low', 'Solution provided', '2026-09-14', '2026-09-22', '2026-09-14 08:00+00'),
  ('TKT-46955', 'Request: increase Document AI quota for invoice backlog', 'Document AI', 'Medium', 'Closed', '2026-08-30', '2026-09-05', '2026-08-30 08:00+00')
on conflict (id) do nothing;

create or replace function public.sub4me_tickets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'title', t.title, 'product', t.product, 'priority', t.priority, 'status', t.status,
    'description', t.description, 'created', to_char(t.created_on, 'YYYY-MM-DD'), 'updated', to_char(t.updated_on, 'YYYY-MM-DD'))
    order by t.created_at desc, t.id desc), '[]'::jsonb)
  from sub4me.tickets t;
$$;

create or replace function public.sub4me_create_ticket(p_title text, p_product text, p_priority text, p_description text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id text := 'TKT-' || nextval('sub4me.ticket_seq');
  row_ sub4me.tickets;
begin
  insert into sub4me.tickets (id, title, product, priority, description)
  values (new_id, btrim(p_title), btrim(p_product), p_priority, coalesce(p_description, ''))
  returning * into row_;
  return jsonb_build_object('id', row_.id, 'title', row_.title, 'product', row_.product, 'priority', row_.priority,
    'status', row_.status, 'description', row_.description,
    'created', to_char(row_.created_on, 'YYYY-MM-DD'), 'updated', to_char(row_.updated_on, 'YYYY-MM-DD'));
end;
$$;

revoke all on function public.sub4me_tickets() from public, anon, authenticated;
revoke all on function public.sub4me_create_ticket(text, text, text, text) from public, anon, authenticated;
grant execute on function public.sub4me_tickets() to service_role;
grant execute on function public.sub4me_create_ticket(text, text, text, text) to service_role;

-- To clear the demo tickets you added later (keeps the five samples):
--   delete from sub4me.tickets where id not in ('TKT-48213','TKT-48107','TKT-47888','TKT-47410','TKT-46955');
