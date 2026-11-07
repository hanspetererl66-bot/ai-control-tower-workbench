-- Hiring approvals: the approval of a hire for a candidate who went through the whole recruiting process (stage Offer).
-- Joule prepares the request (the hiring manager's e-mail is the author); the approvers decide, one after the other:
-- hiring manager -> HR business partner -> finance -> (optional) department head. Same pattern as the proposals in migration 028:
-- tables closed to anon/authenticated, access through functions for service_role only, the person is the e-mail label (p_actor).
--
-- Rules the database enforces (not the app):
--  * A request needs an open requisition and a candidate of it who is in stage Offer, and only the hiring manager of the requisition
--    may start it. Only one request per candidate can wait at a time.
--  * The steps run in order. Only the approver of the CURRENT step can decide, and nobody holds two steps (four eyes).
--  * "Return" and "Decline" need a reason. Any of them ends the request; a changed request is a new request. An approval is final.
--  * The terms hold a level, a band, a start date, a kind of contract and a short note. There is no column for a salary figure or a person.
--  * The log of requests and decisions is append only.
-- Reading: the hiring manager, the approvers of a request and the Governance board.

create table if not exists recruiting.hire_request (
  id bigint generated always as identity primary key,
  requisition_id text not null references recruiting.requisition (id),
  candidate_id text not null references recruiting.candidate (id),
  terms jsonb not null,
  evidence text not null default '' check (char_length(evidence) <= 600),
  status text not null default 'pending' check (status in ('pending', 'approved', 'returned', 'declined')),
  current_step integer not null default 1 check (current_step between 1 and 4),
  created_by text not null check (created_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists hire_request_one_pending on recruiting.hire_request (candidate_id) where status = 'pending';

create table if not exists recruiting.hire_step (
  request_id bigint not null references recruiting.hire_request (id),
  ord integer not null check (ord between 1 and 4),
  role text not null check (role in ('hiring_manager', 'hr', 'finance', 'department_head')),
  approver text not null check (approver ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status text not null default 'waiting' check (status in ('waiting', 'approved')),
  decided_at timestamptz,
  note text not null default '' check (char_length(note) <= 300),
  primary key (request_id, ord),
  unique (request_id, role),
  unique (request_id, approver)
);

create table if not exists recruiting.hire_event (
  id bigint generated always as identity primary key,
  request_id bigint not null references recruiting.hire_request (id),
  event text not null check (event in ('requested', 'approved', 'returned', 'declined')),
  role text not null default '',
  actor text not null check (actor ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 300)
);

alter table recruiting.hire_request enable row level security;
alter table recruiting.hire_step enable row level security;
alter table recruiting.hire_event enable row level security;
revoke all on recruiting.hire_request, recruiting.hire_step, recruiting.hire_event from public, anon, authenticated;

create or replace function recruiting.hire_event_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'the hiring approval log is append only: an entry cannot be changed or removed';
end $$;
drop trigger if exists hire_event_no_change on recruiting.hire_event;
create trigger hire_event_no_change before update or delete on recruiting.hire_event for each row execute function recruiting.hire_event_append_only();

-- A request is never removed. Once it is no longer pending it is final; while pending only status, current_step and decided_at move.
create or replace function recruiting.hire_request_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a hiring request cannot be removed'; end if;
  if old.status <> 'pending' then raise exception 'a decided hiring request cannot be changed'; end if;
  if (new.id, new.requisition_id, new.candidate_id, new.terms, new.evidence, new.created_by, new.created_at)
     is distinct from (old.id, old.requisition_id, old.candidate_id, old.terms, old.evidence, old.created_by, old.created_at) then
    raise exception 'the content of a hiring request cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists hire_request_guard on recruiting.hire_request;
create trigger hire_request_guard before update or delete on recruiting.hire_request for each row execute function recruiting.hire_request_guard();

-- Joule prepares a request. p_approvers: {"hr": "...", "finance": "...", "department_head": "..." (optional)}; the hiring manager is step 1.
-- p_terms: {"level": "...", "band": "...", "start_on": "YYYY-MM-DD", "contract": "permanent"|"fixed-term", "note": "..."}.
create or replace function public.recruiting_hire_request_create(
  p_actor text, p_requisition text, p_candidate text, p_terms jsonb, p_evidence text, p_approvers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req recruiting.requisition; v_cand recruiting.candidate; v_id bigint;
  v_terms jsonb; v_evidence text := left(btrim(coalesce(p_evidence, '')), 600); v_note text;
  v_hr text; v_fin text; v_head text; v_mail text := '^[^@\s]+@[^@\s]+\.[^@\s]+$'; v_ord integer := 1; v_start date;
begin
  if p_actor is null or p_actor !~ v_mail then raise exception 'actor must be an e-mail address'; end if;
  select * into v_req from recruiting.requisition where id = p_requisition;
  if not found then raise exception 'unknown requisition'; end if;
  if lower(v_req.manager_email) <> lower(p_actor) then raise exception 'only the hiring manager of this requisition can start a hiring request'; end if;
  if v_req.status <> 'open' then raise exception 'the requisition is not open'; end if;
  select * into v_cand from recruiting.candidate where id = p_candidate and requisition_id = p_requisition;
  if not found then raise exception 'unknown candidate for this requisition'; end if;
  if v_cand.stage <> 'Offer' then raise exception 'a hiring request needs a candidate in the stage Offer (this one is in %)', v_cand.stage; end if;
  if exists (select 1 from recruiting.hire_request where candidate_id = p_candidate and status = 'pending') then
    raise exception 'a hiring request for this candidate is already waiting';
  end if;

  if p_terms is null or jsonb_typeof(p_terms) <> 'object' then raise exception 'terms must be an object'; end if;
  if exists (select 1 from jsonb_object_keys(p_terms) k where k not in ('level', 'band', 'start_on', 'contract', 'note')) then
    raise exception 'terms may only hold level, band, start_on, contract and note';
  end if;
  if coalesce(btrim(p_terms->>'level'), '') = '' or char_length(p_terms->>'level') > 40 then raise exception 'terms need a level (up to 40 characters)'; end if;
  if coalesce(btrim(p_terms->>'band'), '') = '' or char_length(p_terms->>'band') > 40 then raise exception 'terms need a band (up to 40 characters)'; end if;
  if (p_terms->>'band') ~ '[0-9]{4,}' then raise exception 'the band names a band, not an amount'; end if;
  if coalesce(p_terms->>'contract', '') not in ('permanent', 'fixed-term') then raise exception 'contract must be permanent or fixed-term'; end if;
  begin v_start := (p_terms->>'start_on')::date; exception when others then raise exception 'start_on must be a date (YYYY-MM-DD)'; end;
  if v_start is null or v_start < current_date then raise exception 'start_on must be today or later'; end if;
  v_note := left(btrim(coalesce(p_terms->>'note', '')), 300);
  if not recruiting.cv_is_clean(array[v_evidence, v_note]) or not recruiting.criterion_is_clean(v_evidence || ' ' || v_note, '{}', '{}') then
    raise exception 'the evidence and the note may not contain contact data or protected traits';
  end if;
  if werkbank.find_secret(v_evidence || ' ' || v_note) is not null then raise exception 'the evidence and the note look like they contain a credential'; end if;
  v_terms := jsonb_build_object('level', btrim(p_terms->>'level'), 'band', btrim(p_terms->>'band'), 'start_on', v_start, 'contract', p_terms->>'contract', 'note', v_note);

  if p_approvers is null or jsonb_typeof(p_approvers) <> 'object' then raise exception 'approvers must be an object'; end if;
  if exists (select 1 from jsonb_object_keys(p_approvers) k where k not in ('hr', 'finance', 'department_head')) then
    raise exception 'approvers may only name hr, finance and department_head';
  end if;
  v_hr := lower(btrim(coalesce(p_approvers->>'hr', ''))); v_fin := lower(btrim(coalesce(p_approvers->>'finance', '')));
  v_head := nullif(lower(btrim(coalesce(p_approvers->>'department_head', ''))), '');
  if v_hr !~ v_mail or v_fin !~ v_mail then raise exception 'the approvers hr and finance are needed (e-mail addresses)'; end if;
  if v_head is not null and v_head !~ v_mail then raise exception 'department_head must be an e-mail address'; end if;
  if lower(v_req.manager_email) in (v_hr, v_fin) or v_hr = v_fin or (v_head is not null and v_head in (lower(v_req.manager_email), v_hr, v_fin)) then
    raise exception 'nobody can hold two steps: the approvers must be different people';
  end if;

  insert into recruiting.hire_request (requisition_id, candidate_id, terms, evidence, created_by)
  values (p_requisition, p_candidate, v_terms, v_evidence, lower(p_actor)) returning id into v_id;
  insert into recruiting.hire_step (request_id, ord, role, approver) values
    (v_id, 1, 'hiring_manager', lower(v_req.manager_email)), (v_id, 2, 'hr', v_hr), (v_id, 3, 'finance', v_fin);
  if v_head is not null then insert into recruiting.hire_step (request_id, ord, role, approver) values (v_id, 4, 'department_head', v_head); end if;
  insert into recruiting.hire_event (request_id, event, role, actor) values (v_id, 'requested', '', lower(p_actor));
  return jsonb_build_object('id', v_id, 'status', 'pending', 'steps', case when v_head is null then 3 else 4 end);
end $$;

create or replace function public.recruiting_hire_requests_list(p_actor text, p_status text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'returned', 'declined') then raise exception 'status must be pending, approved, returned or declined'; end if;
  v_all := skills.is_board_admin(p_actor);
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object(
             'id', h.id, 'requisition', h.requisition_id, 'title', r.title, 'dept', r.dept, 'candidate', h.candidate_id,
             'terms', h.terms, 'evidence', h.evidence, 'status', h.status, 'currentStep', h.current_step,
             'createdBy', h.created_by, 'at', h.created_at, 'decidedAt', h.decided_at,
             'mine', h.status = 'pending' and exists (select 1 from recruiting.hire_step s where s.request_id = h.id and s.ord = h.current_step and s.approver = lower(p_actor)),
             'steps', (select jsonb_agg(jsonb_build_object('ord', s.ord, 'role', s.role, 'approver', s.approver, 'status', s.status, 'decidedAt', s.decided_at, 'note', s.note) order by s.ord)
                         from recruiting.hire_step s where s.request_id = h.id),
             'events', (select jsonb_agg(jsonb_build_object('event', e.event, 'role', e.role, 'actor', e.actor, 'at', e.at, 'note', e.note) order by e.id)
                          from recruiting.hire_event e where e.request_id = h.id)) as x
      from recruiting.hire_request h join recruiting.requisition r on r.id = h.requisition_id
     where (v_all or lower(r.manager_email) = lower(p_actor) or exists (select 1 from recruiting.hire_step s where s.request_id = h.id and s.approver = lower(p_actor)))
       and (p_status is null or h.status = p_status)
     order by h.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500)) t), '[]'::jsonb);
end $$;

-- The decision. NOT a tool of the agent: only the Werkbank's main process calls it after the person clicks.
create or replace function public.recruiting_hire_decide(p_actor text, p_id bigint, p_decision text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_h recruiting.hire_request; v_s recruiting.hire_step; v_note text := left(btrim(coalesce(p_note, '')), 300); v_last integer; v_event text;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_decision is null or p_decision not in ('approve', 'return', 'decline') then raise exception 'decision must be approve, return or decline'; end if;
  select * into v_h from recruiting.hire_request where id = p_id for update;
  if not found then raise exception 'unknown hiring request'; end if;
  if v_h.status <> 'pending' then raise exception 'the hiring request is already decided'; end if;
  select * into v_s from recruiting.hire_step where request_id = p_id and ord = v_h.current_step;
  if v_s.approver <> lower(p_actor) then raise exception 'it is not your turn: this step belongs to the % (%)', replace(v_s.role, '_', ' '), 'another person'; end if;
  if p_decision <> 'approve' and char_length(v_note) < 5 then raise exception 'a reason is needed to return or decline a hiring request'; end if;
  if werkbank.find_secret(v_note) is not null then v_note := '[note removed: it looked like it contained a credential]'; end if;
  v_event := case p_decision when 'approve' then 'approved' when 'return' then 'returned' else 'declined' end;
  select max(ord) into v_last from recruiting.hire_step where request_id = p_id;
  if p_decision = 'approve' then
    update recruiting.hire_step set status = 'approved', decided_at = now(), note = v_note where request_id = p_id and ord = v_h.current_step;
    if v_h.current_step = v_last then
      update recruiting.hire_request set status = 'approved', decided_at = now() where id = p_id;
    else
      update recruiting.hire_request set current_step = current_step + 1 where id = p_id;
    end if;
  else
    update recruiting.hire_request set status = v_event, decided_at = now() where id = p_id;
  end if;
  insert into recruiting.hire_event (request_id, event, role, actor, note) values (p_id, v_event, v_s.role, lower(p_actor), v_note);
  return jsonb_build_object('id', p_id, 'event', v_event, 'step', v_h.current_step, 'final', p_decision <> 'approve' or v_h.current_step = v_last,
    'status', (select status from recruiting.hire_request where id = p_id));
end $$;

revoke all on function recruiting.hire_event_append_only(), recruiting.hire_request_guard() from public, anon, authenticated;
revoke all on function public.recruiting_hire_request_create(text, text, text, jsonb, text, jsonb), public.recruiting_hire_requests_list(text, text, integer),
  public.recruiting_hire_decide(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.recruiting_hire_request_create(text, text, text, jsonb, text, jsonb), public.recruiting_hire_requests_list(text, text, integer),
  public.recruiting_hire_decide(text, bigint, text, text) to service_role;
