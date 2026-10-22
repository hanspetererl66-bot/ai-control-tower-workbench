-- Werkbank personal settings: one row per settings set (look, profiles, starter prompts, assistant instructions, storage locations).
-- Safe to run more than once. No policies: the table is closed to anon and authenticated; only the two functions below
-- are callable, and only with the server-side secret key (service_role), through the AI Control Tower connector.
-- Settings only: the connector refuses keys, tokens and passwords before they reach this table.
create schema if not exists werkbank;
revoke all on schema werkbank from anon, authenticated;

create table if not exists werkbank.preferences (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536),
  updated_at timestamptz not null default now()
);
alter table werkbank.preferences enable row level security;
revoke all on werkbank.preferences from anon, authenticated;

create or replace function public.werkbank_get_preferences(p_key text default 'default')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('data', p.data, 'updatedAt', to_char(p.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
       from werkbank.preferences p where p.key = p_key),
    'null'::jsonb);
$$;

create or replace function public.werkbank_save_preferences(p_key text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_ werkbank.preferences;
begin
  insert into werkbank.preferences (key, data, updated_at) values (p_key, p_data, now())
  on conflict (key) do update set data = excluded.data, updated_at = now()
  returning * into row_;
  return jsonb_build_object('key', row_.key, 'updatedAt', to_char(row_.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end;
$$;

revoke all on function public.werkbank_get_preferences(text) from public, anon, authenticated;
revoke all on function public.werkbank_save_preferences(text, jsonb) from public, anon, authenticated;
grant execute on function public.werkbank_get_preferences(text) to service_role;
grant execute on function public.werkbank_save_preferences(text, jsonb) to service_role;
