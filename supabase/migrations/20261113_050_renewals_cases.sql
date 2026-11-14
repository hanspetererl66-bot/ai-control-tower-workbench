-- Renewals, part 1: the autopilot and win-back cases of the Renewals Space, and their log.
-- Until now these cases lived only in the memory of the page and the host and were lost when the app closed. This migration adds the tables
-- and the functions the Werkbank's main process calls (as the stored e-mail) to load, save and archive them.
-- Rules the database enforces:
--  * A case is kept per renewal and kind (renewal = autopilot case, winback = win-back case). Only one ACTIVE case exists per renewal and
--    kind; a reset archives it (the log stays) and a later start creates a new one.
--  * Who sees what: the owner of the case (the e-mail that renewals.owner_email assigns to the owner's name), the sales managers
--    (renewals.manager) and the board admins (admin of the group "Governance board") see it. Managers only READ. Changing a case (save, reset)
--    is for the owner and the board admins. A case whose owner has no e-mail yet is "unassigned": managers and board admins see it.
--  * A save carries the revision the page last saw; if someone else saved in between, the database refuses (no silent overwriting).
--  * The state is checked: the status is one of a fixed list, at most 60 log lines of at most 600 characters, at most 64 KB.
--  * The log lines go to an append-only table (an entry cannot be changed or removed).
-- Identity is the e-mail, a label and not a protection (same as everywhere in the Werkbank). The tables are closed for anon and authenticated,
-- only service_role can call the functions (the Werkbank's main process, with the key that never leaves it).
-- The seed rows are TEST addresses on the reserved domain renewals.example (no real mailbox): the four owners of the sample data and one
-- sales manager. Real people are added by hand: insert into renewals.owner_email / renewals.manager.

create schema if not exists renewals;

create table if not exists renewals.owner_email (
  owner_name text primary key check (char_length(btrim(owner_name)) between 1 and 80),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create table if not exists renewals.manager (
  email text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create table if not exists renewals.cases (
  id bigint generated always as identity primary key,
  case_id text not null check (case_id ~ '^R-[A-Za-z0-9-]{1,40}$'),
  kind text not null check (kind in ('renewal', 'winback')),
  owner_name text not null check (char_length(btrim(owner_name)) between 1 and 80),
  owner_email text check (owner_email is null or owner_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  customer text not null default '' check (char_length(customer) <= 120),
  status text not null check (status in ('running', 'waiting-person', 'waiting-customer', 'done', 'stopped', 'lost', 'closed')),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  rev integer not null default 1 check (rev >= 1),
  created_by text not null check (created_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now(),
  updated_by text not null check (updated_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_at timestamptz not null default now(),
  archived_by text check (archived_by is null or archived_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  archived_at timestamptz,
  check ((archived_at is null) = (archived_by is null))
);
create unique index if not exists cases_one_active on renewals.cases (case_id, kind) where archived_at is null;
create index if not exists cases_owner_active on renewals.cases (owner_email) where archived_at is null;

create table if not exists renewals.case_events (
  id bigint generated always as identity primary key,
  case_pk bigint not null references renewals.cases (id),
  n integer not null check (n >= 1),
  actor text not null check (char_length(actor) between 1 and 80),
  step text not null default '' check (char_length(step) <= 30),
  message text not null check (char_length(message) <= 600),
  by_email text not null check (by_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  at timestamptz not null default now(),
  unique (case_pk, n)
);

alter table renewals.owner_email enable row level security;
alter table renewals.manager enable row level security;
alter table renewals.cases enable row level security;
alter table renewals.case_events enable row level security;
revoke all on renewals.owner_email, renewals.manager, renewals.cases, renewals.case_events from public, anon, authenticated;

create or replace function renewals.case_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'the renewal case log is append only: an entry cannot be changed or removed';
end $$;
drop trigger if exists case_events_no_change on renewals.case_events;
create trigger case_events_no_change before update or delete on renewals.case_events for each row execute function renewals.case_events_append_only();

-- May this person SEE the case? The owner, a sales manager or a board admin.
create or replace function renewals.can_see(p_actor text, p_owner_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select skills.is_board_admin(p_actor)
      or exists (select 1 from renewals.manager m where m.email = lower(p_actor))
      or (p_owner_email is not null and lower(p_owner_email) = lower(p_actor));
$$;

-- May this person CHANGE the case (save, reset)? The owner or a board admin. Sales managers only read.
create or replace function renewals.can_change(p_actor text, p_owner_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select skills.is_board_admin(p_actor)
      or (p_owner_email is not null and lower(p_owner_email) = lower(p_actor));
$$;

-- The cases this person may see (not archived), and who this person is: the owner names for the e-mail, manager, admin.
create or replace function public.renewals_cases_list(p_actor text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  return jsonb_build_object(
    'me', jsonb_build_object(
      'email', lower(p_actor),
      'owners', coalesce((select jsonb_agg(o.owner_name order by o.owner_name) from renewals.owner_email o where o.email = lower(p_actor)), '[]'::jsonb),
      'manager', exists (select 1 from renewals.manager m where m.email = lower(p_actor)),
      'admin', skills.is_board_admin(p_actor)),
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
               'caseId', c.case_id, 'kind', c.kind, 'owner', c.owner_name, 'customer', c.customer, 'status', c.status, 'rev', c.rev,
               'state', c.state, 'updatedAt', c.updated_at, 'updatedBy', c.updated_by,
               'canChange', renewals.can_change(p_actor, c.owner_email), 'unassigned', c.owner_email is null)
             order by c.updated_at desc)
        from renewals.cases c
       where c.archived_at is null and renewals.can_see(p_actor, c.owner_email)), '[]'::jsonb));
end $$;

-- Saves one case. p_expected_rev is the revision the page last saw (0 or null for a new case). The new log lines are written to the log.
create or replace function public.renewals_case_save(
  p_actor text, p_case text, p_kind text, p_owner text, p_customer text, p_state jsonb, p_expected_rev integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c renewals.cases;
  v_by text := lower(p_actor);
  v_email text;
  v_status text;
  v_last integer;
  v_n integer;
  l jsonb;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_case is null or p_case !~ '^R-[A-Za-z0-9-]{1,40}$' then raise exception 'invalid case id'; end if;
  if p_kind is null or p_kind not in ('renewal', 'winback') then raise exception 'kind must be renewal or winback'; end if;
  if p_owner is null or char_length(btrim(p_owner)) not between 1 and 80 then raise exception 'the owner is needed (1 to 80 characters)'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then raise exception 'the state must be an object'; end if;
  if octet_length(p_state::text) > 65536 then raise exception 'the case is too large (at most 64 KB)'; end if;
  v_status := p_state->>'status';
  if v_status is null or v_status not in ('running', 'waiting-person', 'waiting-customer', 'done', 'stopped', 'lost', 'closed') then
    raise exception 'invalid status'; end if;
  if jsonb_typeof(p_state->'log') is distinct from 'array' or jsonb_array_length(p_state->'log') > 60 then
    raise exception 'the log must be a list of at most 60 lines'; end if;
  if exists (select 1 from jsonb_array_elements(p_state->'log') x
              where jsonb_typeof(x.value) <> 'object' or coalesce(x.value->>'n', '') !~ '^[0-9]{1,4}$'
                 or jsonb_typeof(x.value->'actor') is distinct from 'string' or jsonb_typeof(x.value->'text') is distinct from 'string'
                 or char_length(x.value->>'actor') not between 1 and 80 or char_length(x.value->>'text') > 600) then
    raise exception 'a log line is not valid'; end if;

  select * into c from renewals.cases where case_id = p_case and kind = p_kind and archived_at is null for update;
  if not found then
    if coalesce(p_expected_rev, 0) <> 0 then raise exception 'conflict: this case no longer exists, reload'; end if;
    select o.email into v_email from renewals.owner_email o where o.owner_name = btrim(p_owner);
    if not renewals.can_change(p_actor, v_email) then raise exception 'you may not change cases of this owner'; end if;
    insert into renewals.cases (case_id, kind, owner_name, owner_email, customer, status, state, created_by, updated_by)
    values (p_case, p_kind, btrim(p_owner), v_email, left(coalesce(btrim(p_customer), ''), 120), v_status, p_state, v_by, v_by)
    returning * into c;
  else
    if not renewals.can_change(p_actor, c.owner_email) then raise exception 'you may not change this case'; end if;
    if p_expected_rev is distinct from c.rev then raise exception 'conflict: this case was changed elsewhere, reload'; end if;
    -- a case without an owner e-mail gets it as soon as the assignment exists
    update renewals.cases set
        state = p_state, status = v_status, rev = c.rev + 1, updated_by = v_by, updated_at = now(),
        customer = coalesce(nullif(left(btrim(coalesce(p_customer, '')), 120), ''), c.customer),
        owner_email = coalesce(c.owner_email, (select o.email from renewals.owner_email o where o.owner_name = c.owner_name))
      where id = c.id returning * into c;
  end if;

  -- the log lines that are not in the log table yet
  select coalesce(max(e.n), 0) into v_last from renewals.case_events e where e.case_pk = c.id;
  for l in select y.value from jsonb_array_elements(p_state->'log') y order by (y.value->>'n')::integer loop
    v_n := (l->>'n')::integer;
    if v_n > v_last then
      insert into renewals.case_events (case_pk, n, actor, step, message, by_email)
      values (c.id, v_n, l->>'actor', left(coalesce(l->>'step', ''), 30), l->>'text', v_by);
    end if;
  end loop;
  return jsonb_build_object('caseId', c.case_id, 'kind', c.kind, 'rev', c.rev);
end $$;

-- Archives the active case (a reset). The log stays; a later start creates a new case.
create or replace function public.renewals_case_reset(p_actor text, p_case text, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c renewals.cases; v_n integer;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_case is null or p_case !~ '^R-[A-Za-z0-9-]{1,40}$' then raise exception 'invalid case id'; end if;
  if p_kind is null or p_kind not in ('renewal', 'winback') then raise exception 'kind must be renewal or winback'; end if;
  select * into c from renewals.cases where case_id = p_case and kind = p_kind and archived_at is null for update;
  if not found then raise exception 'there is no active case to reset'; end if;
  if not renewals.can_change(p_actor, c.owner_email) then raise exception 'you may not change this case'; end if;
  update renewals.cases set archived_at = now(), archived_by = lower(p_actor) where id = c.id;
  select coalesce(max(e.n), 0) + 1 into v_n from renewals.case_events e where e.case_pk = c.id;
  insert into renewals.case_events (case_pk, n, actor, step, message, by_email)
  values (c.id, v_n, 'Archive', 'reset', 'Archived by ' || lower(p_actor), lower(p_actor));
  return jsonb_build_object('caseId', p_case, 'kind', p_kind, 'archived', true);
end $$;

revoke all on function renewals.case_events_append_only(), renewals.can_see(text, text), renewals.can_change(text, text) from public, anon, authenticated;
revoke all on function public.renewals_cases_list(text), public.renewals_case_save(text, text, text, text, text, jsonb, integer),
  public.renewals_case_reset(text, text, text) from public, anon, authenticated;
grant execute on function public.renewals_cases_list(text), public.renewals_case_save(text, text, text, text, text, jsonb, integer),
  public.renewals_case_reset(text, text, text) to service_role;

-- Test addresses (reserved domain, no real mailbox): the four owners of the sample data and one sales manager.
insert into renewals.owner_email (owner_name, email) values
  ('Mira Hoffmann', 'mira.hoffmann@renewals.example'),
  ('Sven Albrecht', 'sven.albrecht@renewals.example'),
  ('Clara Neumann', 'clara.neumann@renewals.example'),
  ('Katrin Lindner', 'katrin.lindner@renewals.example')
on conflict (owner_name) do nothing;
insert into renewals.manager (email) values ('vertrieb@renewals.example') on conflict (email) do nothing;
