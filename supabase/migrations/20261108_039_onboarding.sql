-- Onboarding, part 1: the handover from a signed hiring contract and the status of every onboarding step.
-- After the candidate signed (migration 038), HR hands the hire over to onboarding (recruiting_onboarding_handover, called only by the
-- Werkbank's main process after the click, or by n8n with the service key). The database then holds one case per hiring request and one
-- row per step of the fixed process (recruiting.onboarding_step_def). A step is open, done, blocked (with a reason) or not applicable.
-- Rules the database enforces:
--  * A case exists only for a request whose contract is SIGNED, one case per request, and only the HR approver (or a board admin) opens it.
--  * Only steps of the fixed process exist; "blocked" needs a reason; every change is written to an append-only log.
--  * People involved in the request (requester, approvers, manager of the requisition) and board admins can see and update a case.
--    Identity is the e-mail, a label and not a protection (same as everywhere in the Werkbank). The new hire's name stays in the recruiting system.
-- Only service_role can call the functions.

create table if not exists recruiting.onboarding_step_def (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  phase text not null check (phase in ('pre', 'day1', 'week1', 'd90', 'probation')),
  owner text not null check (owner in ('HR', 'Payroll', 'IT', 'Facilities', 'Manager', 'Buddy', 'New hire')),
  day_offset integer not null,
  before_contract boolean not null default false
);
insert into recruiting.onboarding_step_def (id, phase, owner, day_offset, before_contract) values
  ('works_council', 'pre', 'HR', -21, true),
  ('master_data', 'pre', 'HR', -14, false),
  ('new_hire_forms', 'pre', 'New hire', -10, false),
  ('right_to_work', 'pre', 'HR', -10, false),
  ('payroll_setup', 'pre', 'Payroll', -7, false),
  ('it_accounts', 'pre', 'IT', -7, false),
  ('it_hardware', 'pre', 'IT', -5, false),
  ('facilities', 'pre', 'Facilities', -5, false),
  ('buddy', 'pre', 'Manager', -7, false),
  ('plan', 'pre', 'Manager', -5, false),
  ('welcome', 'pre', 'Manager', -3, false),
  ('handover', 'day1', 'IT', 0, false),
  ('reception', 'day1', 'Manager', 0, false),
  ('acknowledgements', 'day1', 'New hire', 0, false),
  ('buddy_walk', 'week1', 'Buddy', 1, false),
  ('training', 'week1', 'New hire', 5, false),
  ('week1_check', 'week1', 'Manager', 5, false),
  ('check30', 'd90', 'Manager', 30, false),
  ('benefits', 'd90', 'New hire', 30, false),
  ('pulse', 'd90', 'New hire', 30, false),
  ('check60', 'd90', 'Manager', 60, false),
  ('check90', 'd90', 'Manager', 90, false),
  ('probation', 'probation', 'HR', 150, false)
on conflict (id) do nothing;

create table if not exists recruiting.onboarding_case (
  id bigint generated always as identity primary key,
  request_id bigint not null unique references recruiting.hire_request (id),
  start_date date not null,
  created_by text not null check (created_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);

create table if not exists recruiting.onboarding_step (
  case_id bigint not null references recruiting.onboarding_case (id),
  step_id text not null references recruiting.onboarding_step_def (id),
  status text not null default 'open' check (status in ('open', 'done', 'blocked', 'na')),
  note text not null default '' check (char_length(note) <= 300),
  changed_by text check (changed_by is null or changed_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  changed_at timestamptz,
  primary key (case_id, step_id),
  check (status <> 'blocked' or char_length(btrim(note)) > 0)
);

create table if not exists recruiting.onboarding_event (
  id bigint generated always as identity primary key,
  case_id bigint not null references recruiting.onboarding_case (id),
  step_id text not null default '',
  event text not null check (event in ('handover', 'open', 'done', 'blocked', 'na')),
  actor text not null check (actor ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 300)
);

alter table recruiting.onboarding_step_def enable row level security;
alter table recruiting.onboarding_case enable row level security;
alter table recruiting.onboarding_step enable row level security;
alter table recruiting.onboarding_event enable row level security;
revoke all on recruiting.onboarding_step_def, recruiting.onboarding_case, recruiting.onboarding_step, recruiting.onboarding_event from public, anon, authenticated;

create or replace function recruiting.onboarding_event_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'the onboarding log is append only: an entry cannot be changed or removed';
end $$;
drop trigger if exists onboarding_event_no_change on recruiting.onboarding_event;
create trigger onboarding_event_no_change before update or delete on recruiting.onboarding_event for each row execute function recruiting.onboarding_event_append_only();

-- May this person see and update the case of the request?
create or replace function recruiting.onboarding_involved(p_actor text, p_request bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select skills.is_board_admin(p_actor)
      or exists (select 1 from recruiting.hire_request h join recruiting.requisition r on r.id = h.requisition_id
                  where h.id = p_request and (lower(h.created_by) = lower(p_actor) or lower(r.manager_email) = lower(p_actor)))
      or exists (select 1 from recruiting.hire_step s where s.request_id = p_request and s.approver = lower(p_actor));
$$;

-- The handover. p_start is the first working day.
create or replace function public.recruiting_onboarding_handover(p_actor text, p_id bigint, p_start date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c recruiting.hire_contract; k recruiting.onboarding_case;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  select * into c from recruiting.hire_contract where request_id = p_id;
  if not found then raise exception 'no contract exists for this request'; end if;
  if not (skills.is_board_admin(p_actor) or exists (select 1 from recruiting.hire_step s where s.request_id = p_id and s.role = 'hr' and s.approver = lower(p_actor))) then
    raise exception 'only the HR approver of this request can hand the hire over to onboarding';
  end if;
  select * into k from recruiting.onboarding_case where request_id = p_id;
  if found then return jsonb_build_object('id', p_id, 'caseId', k.id, 'created', false); end if;
  if c.status <> 'signed' then raise exception 'the contract is %, onboarding starts only after the signature', c.status; end if;
  if p_start is null or p_start < current_date - 30 or p_start > current_date + 365 then raise exception 'the start date must be within the next year'; end if;
  insert into recruiting.onboarding_case (request_id, start_date, created_by) values (p_id, p_start, lower(p_actor)) returning * into k;
  insert into recruiting.onboarding_step (case_id, step_id) select k.id, d.id from recruiting.onboarding_step_def d;
  insert into recruiting.onboarding_event (case_id, event, actor) values (k.id, 'handover', lower(p_actor));
  return jsonb_build_object('id', p_id, 'caseId', k.id, 'created', true);
end $$;

-- Mark one step open, done, blocked (reason needed) or not applicable.
create or replace function public.recruiting_onboarding_set(p_actor text, p_id bigint, p_step text, p_status text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k recruiting.onboarding_case; v_note text := left(coalesce(btrim(p_note), ''), 300);
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_status is null or p_status not in ('open', 'done', 'blocked', 'na') then raise exception 'status must be open, done, blocked or na'; end if;
  select * into k from recruiting.onboarding_case where request_id = p_id for update;
  if not found then raise exception 'this hire has not been handed over to onboarding yet'; end if;
  if not recruiting.onboarding_involved(p_actor, p_id) then raise exception 'you are not involved in this hire'; end if;
  if not exists (select 1 from recruiting.onboarding_step where case_id = k.id and step_id = p_step) then raise exception 'unknown onboarding step'; end if;
  if p_status = 'blocked' and v_note = '' then raise exception 'a reason is needed to mark a step as blocked'; end if;
  update recruiting.onboarding_step set status = p_status, note = v_note, changed_by = lower(p_actor), changed_at = now()
   where case_id = k.id and step_id = p_step;
  insert into recruiting.onboarding_event (case_id, step_id, event, actor, note) values (k.id, p_step, p_status, lower(p_actor), v_note);
  return jsonb_build_object('id', p_id, 'step', p_step, 'status', p_status);
end $$;

-- The cases this person may see, with every step. p_ready lists signed hires that have not been handed over yet (what HR still has to start).
create or replace function public.recruiting_onboarding_list(p_actor text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  return jsonb_build_object(
    'cases', coalesce((select jsonb_agg(x order by x->>'start') from (
      select jsonb_build_object(
               'id', h.id, 'requisition', h.requisition_id, 'title', r.title, 'dept', r.dept, 'candidate', h.candidate_id,
               'start', k.start_date, 'handedOverAt', k.created_at, 'handedOverBy', k.created_by,
               'contract', jsonb_build_object('status', c.status, 'signedAt', c.signed_at),
               'steps', (select jsonb_agg(jsonb_build_object('id', s.step_id, 'status', s.status, 'note', s.note, 'by', s.changed_by, 'at', s.changed_at) order by d.day_offset, s.step_id)
                           from recruiting.onboarding_step s join recruiting.onboarding_step_def d on d.id = s.step_id where s.case_id = k.id)) as x
        from recruiting.onboarding_case k join recruiting.hire_request h on h.id = k.request_id
        join recruiting.requisition r on r.id = h.requisition_id join recruiting.hire_contract c on c.request_id = h.id
       where recruiting.onboarding_involved(p_actor, h.id)) t), '[]'::jsonb),
    'ready', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'requisition', h.requisition_id, 'title', r.title, 'dept', r.dept, 'signedAt', c.signed_at) order by c.signed_at)
        from recruiting.hire_contract c join recruiting.hire_request h on h.id = c.request_id join recruiting.requisition r on r.id = h.requisition_id
       where c.status = 'signed' and not exists (select 1 from recruiting.onboarding_case k where k.request_id = h.id)
         and recruiting.onboarding_involved(p_actor, h.id)), '[]'::jsonb));
end $$;

revoke all on function recruiting.onboarding_event_append_only(), recruiting.onboarding_involved(text, bigint) from public, anon, authenticated;
revoke all on function public.recruiting_onboarding_handover(text, bigint, date), public.recruiting_onboarding_set(text, bigint, text, text, text),
  public.recruiting_onboarding_list(text) from public, anon, authenticated;
grant execute on function public.recruiting_onboarding_handover(text, bigint, date), public.recruiting_onboarding_set(text, bigint, text, text, text),
  public.recruiting_onboarding_list(text) to service_role;
