-- Recruiting: requisitions, pseudonymous candidates, the criteria a hiring manager sets, and Joule's proposals with the person's decision.
-- Same pattern as the work items and the run log: tables closed to anon/authenticated, access only through functions for service_role,
-- the person is the e-mail label (p_actor) until the sign-in is decided.
--
-- Rules the database enforces (not the app):
--  * Candidates are pseudonymous. There is no column for name, photo, date of birth, address or contact data, and a CV line that looks
--    like an e-mail address, a phone number or a web address is refused. Gaps in the CV are not stored as a field.
--  * A criterion may not name a protected trait (a guard against a slip, not a legal review).
--  * Joule can only write a PROPOSAL (move, remind, ask). It has no way to reject a candidate: the wording is refused, and the
--    proposal kinds are fixed.
--  * Only the hiring manager of a requisition can release or decline its proposals, and the decision is final. The log of proposals
--    and decisions is append only.
-- Reading: the hiring manager sees the own requisitions, the Governance board sees all. Closed requisitions only count in aggregates.

create schema if not exists recruiting;

create table if not exists recruiting.stage_target (
  stage text primary key check (stage in ('Applied', 'Screening', 'Interview', 'Offer')),
  days integer not null check (days between 1 and 60),
  ord integer not null unique
);
insert into recruiting.stage_target (stage, days, ord) values ('Applied', 3, 1), ('Screening', 5, 2), ('Interview', 7, 3), ('Offer', 4, 4)
on conflict (stage) do nothing;

-- A CV line is short text about the work, not a way to reach or identify the person.
create or replace function recruiting.cv_is_clean(p_lines text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(bool_and(
    char_length(l) <= 300
    and l !~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}'
    and l !~* '(https?://|www\.)'
    and l !~ '(\+|\m00)[0-9][0-9 ()/.-]{7,}[0-9]'
    and l !~ '(^|[^0-9])0[0-9]{2,4}[ /.-][0-9]{3,}[ /.-][0-9]{3,}'
    and l !~ '[0-9]{9,}'), true)
  from unnest(p_lines) as l
$$;

-- A guard against criteria that name a protected trait. Whole words only, so "storage" does not trip "age".
create or replace function recruiting.criterion_is_clean(p_label text, p_needles text[], p_partial text[])
returns boolean language sql immutable set search_path = '' as $$
  select (coalesce(p_label, '') || ' ' || array_to_string(coalesce(p_needles, '{}') || coalesce(p_partial, '{}'), ' '))
    !~* '\y(age|aged|young|younger|older|gender|sex|sexual|nationality|ethnicity|ethnic|religion|religious|marital|married|pregnant|pregnancy|disability|photo|born|alter|geschlecht|staatsangeh\w*|religion|familienstand|schwanger\w*|behinderung)\y'
$$;

create table if not exists recruiting.requisition (
  id text primary key check (id ~ '^[A-Za-z0-9._-]{1,40}$'),
  title text not null check (char_length(title) between 1 and 120),
  dept text not null check (char_length(dept) between 1 and 60),
  location text not null default '' check (char_length(location) <= 80),
  manager_email text not null check (manager_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(manager_email) <= 120),
  manager_role text not null default '' check (char_length(manager_role) <= 80),
  opened_on date not null,
  target_days integer not null check (target_days between 1 and 365),
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  filled_on date,
  offers_made integer not null default 0 check (offers_made >= 0),
  offers_accepted integer not null default 0 check (offers_accepted >= 0 and offers_accepted <= offers_made),
  created_at timestamptz not null default now(),
  check ((status = 'filled') = (filled_on is not null)),
  check (filled_on is null or filled_on >= opened_on)
);
create index if not exists requisition_status_idx on recruiting.requisition (status, manager_email);

create table if not exists recruiting.criterion (
  requisition_id text not null references recruiting.requisition (id) on delete cascade,
  crit_id text not null check (crit_id ~ '^[MN][0-9]{1,2}$'),
  must boolean not null,
  label text not null check (char_length(label) between 1 and 200),
  kind text not null default 'text' check (kind in ('text', 'years')),
  min_years integer check (min_years between 1 and 60),
  needles text[] not null default '{}' check (cardinality(needles) <= 10),
  partial text[] not null default '{}' check (cardinality(partial) <= 10),
  primary key (requisition_id, crit_id),
  check ((kind = 'years') = (min_years is not null)),
  check (kind = 'years' or cardinality(needles) >= 1),
  check (crit_id like case when must then 'M%' else 'N%' end),
  check (recruiting.criterion_is_clean(label, needles, partial))
);

create table if not exists recruiting.candidate (
  id text primary key check (id ~ '^C-[0-9]{3,8}$'),
  requisition_id text not null references recruiting.requisition (id) on delete restrict,
  stage text not null references recruiting.stage_target (stage),
  stage_since date not null,
  applied_on date not null,
  years integer check (years between 0 and 60),
  years_line integer check (years_line >= 1),
  cv_lines text[] not null default '{}',
  created_at timestamptz not null default now(),
  check (stage_since >= applied_on),
  check (cardinality(cv_lines) <= 60),
  check (years_line is null or years_line <= cardinality(cv_lines)),
  check (recruiting.cv_is_clean(cv_lines))
);
create index if not exists candidate_requisition_idx on recruiting.candidate (requisition_id, stage);

create table if not exists recruiting.proposal (
  id bigint generated always as identity primary key,
  requisition_id text not null references recruiting.requisition (id),
  candidate_id text not null references recruiting.candidate (id),
  kind text not null check (kind in ('move', 'remind', 'ask')),
  tool text not null check (tool ~ '^[a-z][a-z0-9_]{1,59}$'),
  body text not null check (char_length(body) between 1 and 600),
  basis text not null default '' check (char_length(basis) <= 300),
  status text not null default 'proposed' check (status in ('proposed', 'released', 'declined')),
  proposed_by text not null check (proposed_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  proposed_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 300),
  check ((status = 'proposed') = (decided_by is null and decided_at is null)),
  -- Joule proposes; it never proposes to turn a candidate down.
  check (body !~* '\y(reject\w*|turn down|disqualif\w*|eliminat\w*|screen out)\y')
);
-- One open proposal per candidate and kind: asking twice returns the first one.
create unique index if not exists proposal_one_open on recruiting.proposal (candidate_id, kind) where status = 'proposed';
create index if not exists proposal_status_idx on recruiting.proposal (requisition_id, status);

create table if not exists recruiting.proposal_event (
  id bigint generated always as identity primary key,
  proposal_id bigint not null references recruiting.proposal (id),
  event text not null check (event in ('proposed', 'released', 'declined')),
  actor text not null check (actor ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 300)
);

alter table recruiting.stage_target enable row level security;
alter table recruiting.requisition enable row level security;
alter table recruiting.criterion enable row level security;
alter table recruiting.candidate enable row level security;
alter table recruiting.proposal enable row level security;
alter table recruiting.proposal_event enable row level security;
revoke all on all tables in schema recruiting from anon, authenticated;
revoke all on schema recruiting from anon, authenticated;

-- The log can be trusted: no change, no removal, not even through a function.
create or replace function recruiting.event_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'the proposal log is append only: an entry cannot be changed or removed';
end $$;
drop trigger if exists proposal_event_no_change on recruiting.proposal_event;
create trigger proposal_event_no_change before update or delete on recruiting.proposal_event for each row execute function recruiting.event_append_only();

-- A proposal is never removed, and once decided it is final. Only the decision may be set; the content stays as proposed.
create or replace function recruiting.proposal_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a proposal cannot be removed'; end if;
  if old.status <> 'proposed' then raise exception 'a decided proposal cannot be changed'; end if;
  if (new.id, new.requisition_id, new.candidate_id, new.kind, new.tool, new.body, new.basis, new.proposed_by, new.proposed_at)
     is distinct from (old.id, old.requisition_id, old.candidate_id, old.kind, old.tool, old.body, old.basis, old.proposed_by, old.proposed_at) then
    raise exception 'only the decision of a proposal can be set';
  end if;
  return new;
end $$;
drop trigger if exists proposal_guard_trg on recruiting.proposal;
create trigger proposal_guard_trg before update or delete on recruiting.proposal for each row execute function recruiting.proposal_guard();

create or replace function recruiting.can_see(p_requisition text, p_actor text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from recruiting.requisition r
    where r.id = p_requisition and (lower(r.manager_email) = lower(p_actor) or skills.is_board_admin(p_actor)))
$$;

-- Everything the connector needs to compute the control tower and the shortlist, in the shape of the Recruiting Workbench sample data.
-- p_with_cv adds the CV text (without personal fields). p_as_of fixes "today" for tests and demos (default: today in Berlin).
create or replace function public.recruiting_snapshot(p_actor text, p_with_cv boolean default false, p_as_of date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean; v_asof date := coalesce(p_as_of, (now() at time zone 'Europe/Berlin')::date);
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  v_all := skills.is_board_admin(p_actor);
  return jsonb_build_object(
    'asOf', to_char(v_asof, 'YYYY-MM-DD'),
    'stages', (select coalesce(jsonb_agg(s.stage order by s.ord), '[]'::jsonb) from recruiting.stage_target s),
    'sla', (select coalesce(jsonb_object_agg(s.stage, s.days), '{}'::jsonb) from recruiting.stage_target s),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'dept', r.dept, 'location', r.location,
               'manager', r.manager_role, 'opened', to_char(r.opened_on, 'YYYY-MM-DD'), 'target', r.target_days) order by r.opened_on, r.id), '[]'::jsonb)
               from recruiting.requisition r where r.status = 'open' and (v_all or lower(r.manager_email) = lower(p_actor))),
    'criteria', (select coalesce(jsonb_object_agg(x.req, x.crits), '{}'::jsonb) from (
               select c.requisition_id as req, jsonb_agg(jsonb_build_object('id', c.crit_id, 'must', c.must, 'text', c.label, 'kind', c.kind,
                 'min', c.min_years, 'needles', to_jsonb(c.needles), 'partial', to_jsonb(c.partial)) order by c.crit_id) as crits
                 from recruiting.criterion c join recruiting.requisition r on r.id = c.requisition_id
                where r.status = 'open' and (v_all or lower(r.manager_email) = lower(p_actor)) group by c.requisition_id) x),
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'job', c.requisition_id, 'stage', c.stage,
               'since', to_char(c.stage_since, 'YYYY-MM-DD'), 'applied', to_char(c.applied_on, 'YYYY-MM-DD'),
               'years', c.years, 'yearsLine', c.years_line)
               || case when coalesce(p_with_cv, false) and cardinality(c.cv_lines) > 0 then jsonb_build_object('cv', to_jsonb(c.cv_lines)) else '{}'::jsonb end
               order by c.id), '[]'::jsonb)
               from recruiting.candidate c join recruiting.requisition r on r.id = c.requisition_id
              where r.status = 'open' and (v_all or lower(r.manager_email) = lower(p_actor))),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'dept', r.dept, 'days', r.filled_on - r.opened_on,
               'offers', r.offers_made, 'accepted', r.offers_accepted) order by r.id), '[]'::jsonb)
               from recruiting.requisition r where r.status = 'filled')
  );
end $$;

-- Joule writes a proposal. Nothing happens to the candidate: a person releases or declines it. A second call for the same
-- candidate and kind returns the open proposal.
create or replace function public.recruiting_proposal_create(
  p_actor text, p_requisition text, p_candidate text, p_kind text, p_tool text, p_body text, p_basis text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_new boolean := true; v_body text := btrim(coalesce(p_body, '')); v_basis text := btrim(coalesce(p_basis, ''));
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if not recruiting.can_see(p_requisition, p_actor) then raise exception 'unknown requisition or no access'; end if;
  if not exists (select 1 from recruiting.requisition where id = p_requisition and status = 'open') then raise exception 'the requisition is not open'; end if;
  if not exists (select 1 from recruiting.candidate where id = p_candidate and requisition_id = p_requisition) then raise exception 'the candidate does not belong to this requisition'; end if;
  if p_kind is null or p_kind not in ('move', 'remind', 'ask') then raise exception 'kind must be move, remind or ask'; end if;
  if werkbank.find_secret(v_body || ' ' || v_basis) is not null then raise exception 'the text looks like it contains a credential'; end if;
  select id into v_id from recruiting.proposal where candidate_id = p_candidate and kind = p_kind and status = 'proposed';
  if v_id is not null then v_new := false;
  else
    insert into recruiting.proposal (requisition_id, candidate_id, kind, tool, body, basis, proposed_by)
    values (p_requisition, p_candidate, p_kind, p_tool, v_body, left(v_basis, 300), lower(p_actor)) returning id into v_id;
    insert into recruiting.proposal_event (proposal_id, event, actor) values (v_id, 'proposed', lower(p_actor));
  end if;
  return jsonb_build_object('id', v_id, 'created', v_new, 'status', 'proposed');
end $$;

create or replace function public.recruiting_proposals_list(
  p_actor text, p_status text default 'proposed', p_requisition text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_status is not null and p_status not in ('proposed', 'released', 'declined') then raise exception 'status must be proposed, released or declined'; end if;
  v_all := skills.is_board_admin(p_actor);
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object('id', p.id, 'requisition', p.requisition_id, 'candidate', p.candidate_id, 'kind', p.kind, 'tool', p.tool,
             'text', p.body, 'basis', p.basis, 'status', p.status, 'proposedBy', p.proposed_by, 'at', p.proposed_at,
             'decidedBy', p.decided_by, 'decidedAt', p.decided_at, 'note', p.decision_note) as x
      from recruiting.proposal p join recruiting.requisition r on r.id = p.requisition_id
     where (v_all or lower(r.manager_email) = lower(p_actor))
       and (p_status is null or p.status = p_status)
       and (p_requisition is null or p.requisition_id = p_requisition)
     order by p.proposed_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500)) t), '[]'::jsonb);
end $$;

-- The decision. Only the hiring manager of the requisition may take it, and it is final. This function is NOT a tool of the agent:
-- only the Werkbank's main process calls it after the person clicks Release or Decline.
create or replace function public.recruiting_proposal_decide(p_actor text, p_id bigint, p_decision text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p recruiting.proposal; v_note text := left(btrim(coalesce(p_note, '')), 300);
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_decision is null or p_decision not in ('released', 'declined') then raise exception 'decision must be released or declined'; end if;
  select * into v_p from recruiting.proposal where id = p_id for update;
  if not found then raise exception 'unknown proposal'; end if;
  if v_p.status <> 'proposed' then raise exception 'the proposal is already decided'; end if;
  if not exists (select 1 from recruiting.requisition r where r.id = v_p.requisition_id and lower(r.manager_email) = lower(p_actor)) then
    raise exception 'only the hiring manager of this requisition can release or decline a proposal';
  end if;
  if werkbank.find_secret(v_note) is not null then v_note := '[note removed: it looked like it contained a credential]'; end if;
  update recruiting.proposal set status = p_decision, decided_by = lower(p_actor), decided_at = now(), decision_note = v_note where id = p_id;
  insert into recruiting.proposal_event (proposal_id, event, actor, note) values (p_id, p_decision, lower(p_actor), v_note);
  return jsonb_build_object('id', p_id, 'status', p_decision, 'candidate', v_p.candidate_id, 'tool', v_p.tool, 'kind', v_p.kind);
end $$;

revoke all on function recruiting.cv_is_clean(text[]), recruiting.criterion_is_clean(text, text[], text[]), recruiting.event_append_only(),
  recruiting.proposal_guard(), recruiting.can_see(text, text) from public, anon, authenticated;
revoke all on function public.recruiting_snapshot(text, boolean, date), public.recruiting_proposal_create(text, text, text, text, text, text, text),
  public.recruiting_proposals_list(text, text, text, integer), public.recruiting_proposal_decide(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.recruiting_snapshot(text, boolean, date), public.recruiting_proposal_create(text, text, text, text, text, text, text),
  public.recruiting_proposals_list(text, text, text, integer), public.recruiting_proposal_decide(text, bigint, text, text) to service_role;
