-- Ontology Manager: shared governance (owners, declared users, agent views, change plans) in the database.
-- One shared document with a revision number; every save appends a snapshot, nothing is overwritten.
-- A save names the revision it was based on; if somebody saved in between the database refuses (nothing is merged silently).
-- Same pattern as migrations 019/021: tables closed to anon/authenticated, functions only for service_role (the app's main process).
-- Identity is the e-mail label (p_actor) until the sign-in is decided: anyone who has the key and an e-mail can save.

create schema if not exists werkbank;

create table if not exists werkbank.ontology_governance (
  scope text primary key default 'default' check (scope = 'default'),
  rev integer not null default 0,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1048576),
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists werkbank.ontology_governance_rev (
  rev integer primary key check (rev >= 1),
  data jsonb not null,
  author text not null check (author ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(author) <= 120),
  created_at timestamptz not null default now()
);

alter table werkbank.ontology_governance enable row level security;
alter table werkbank.ontology_governance_rev enable row level security;
revoke all on werkbank.ontology_governance, werkbank.ontology_governance_rev from public, anon, authenticated;

-- Append only: a saved revision cannot be changed or removed.
create or replace function werkbank.ontology_governance_rev_lock() returns trigger language plpgsql as $$
begin raise exception 'Saved governance revisions cannot be changed.' using errcode = 'P0001'; end $$;
drop trigger if exists ontology_governance_rev_lock on werkbank.ontology_governance_rev;
create trigger ontology_governance_rev_lock before update or delete on werkbank.ontology_governance_rev
  for each row execute function werkbank.ontology_governance_rev_lock();

-- Current shared state: { rev, data, updatedBy, updatedAt }. Revision 0 means nothing was saved yet.
create or replace function public.ontology_governance_get(p_actor text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r werkbank.ontology_governance;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'An e-mail address is needed.' using errcode = 'P0001'; end if;
  select * into r from werkbank.ontology_governance where scope = 'default';
  if not found then return jsonb_build_object('rev', 0, 'data', '{}'::jsonb, 'updatedBy', '', 'updatedAt', null); end if;
  return jsonb_build_object('rev', r.rev, 'data', r.data, 'updatedBy', r.updated_by, 'updatedAt', r.updated_at);
end $$;

-- Save on top of revision p_base_rev. If another revision exists, nothing is written and the current state comes back with conflict = true.
create or replace function public.ontology_governance_set(p_actor text, p_base_rev integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r werkbank.ontology_governance; next_rev integer;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_actor) > 120 then raise exception 'An e-mail address is needed.' using errcode = 'P0001'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'The governance data must be an object.' using errcode = 'P0001'; end if;
  if octet_length(p_data::text) > 1048576 then raise exception 'The governance data is larger than 1 MB.' using errcode = 'P0001'; end if;
  insert into werkbank.ontology_governance (scope) values ('default') on conflict do nothing;
  select * into r from werkbank.ontology_governance where scope = 'default' for update;
  if r.rev <> coalesce(p_base_rev, 0) then
    return jsonb_build_object('conflict', true, 'rev', r.rev, 'data', r.data, 'updatedBy', r.updated_by, 'updatedAt', r.updated_at);
  end if;
  next_rev := r.rev + 1;
  insert into werkbank.ontology_governance_rev (rev, data, author) values (next_rev, p_data, p_actor);
  update werkbank.ontology_governance set rev = next_rev, data = p_data, updated_by = p_actor, updated_at = now() where scope = 'default';
  return jsonb_build_object('conflict', false, 'rev', next_rev, 'data', p_data, 'updatedBy', p_actor, 'updatedAt', now());
end $$;

revoke all on function public.ontology_governance_get(text) from public, anon, authenticated;
revoke all on function public.ontology_governance_set(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.ontology_governance_get(text) to service_role;
grant execute on function public.ontology_governance_set(text, integer, jsonb) to service_role;
