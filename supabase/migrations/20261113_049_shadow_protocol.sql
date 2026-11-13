-- Shadow protocol of the Orchestrator (Autonomous Operations, roadmap phase 2).
-- In shadow mode the Orchestrator plans on real findings and executes nothing. Every plan is a DECISION of the agent (would it run by
-- itself or wait for a person, does the customer have to agree, which floors held) and a person gives a VERDICT (agree, or disagree with a
-- reason). The protocol is append-only: nothing is changed or removed, a changed mind is a new verdict, the latest counts.
-- Rules the database enforces:
--  * Only known kinds, tasks, environments and modes; texts are short; one decision per finding and run.
--  * A disagreement needs a reason; "floor-missed" (a person should have decided) applies only to a decision to run by itself,
--    "over-cautious" (it could have run alone) only to a decision to wait for a person.
--  * No change or removal of any row (trigger).
-- The summary counts the latest verdict per decision; the number that matters is floorMissed: the abort criterion is any value above 0.
-- Identity is the e-mail, a label and not a protection (same as everywhere in the Werkbank). Only service_role can call the functions;
-- the tables are closed to anon and authenticated.

create schema if not exists autonomy;

create table if not exists autonomy.shadow_run (
  id bigint generated always as identity primary key,
  started_by text not null check (started_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  started_at timestamptz not null default now(),
  adapter text not null check (char_length(adapter) between 1 and 30),
  fetched_at text not null check (fetched_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  alerts integer not null check (alerts between 0 and 100000),
  findings integer not null check (findings between 0 and 100000),
  skipped integer not null check (skipped between 0 and 100000),
  withheld integer not null check (withheld between 0 and 100000)
);

create table if not exists autonomy.shadow_decision (
  id bigint generated always as identity primary key,
  run_id bigint not null references autonomy.shadow_run (id),
  finding_id text not null check (finding_id ~ '^[A-Za-z0-9._:-]{1,40}$'),
  host text not null check (host ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'),
  kind text not null check (kind in ('cert-expiry', 'patch-age', 'disk-trend', 'dns-stale')),
  template text not null check (template in ('renew-certificate', 'patch-vm', 'move-vm', 'update-dns-record')),
  env text not null check (env in ('PRD', 'QAS', 'DEV')),
  customer text not null default '' check (customer ~ '^[a-z0-9]{0,12}$'),
  deadline_days integer not null check (deadline_days between 1 and 365),
  agent_mode text not null check (agent_mode in ('auto', 'approval')),
  customer_needed boolean not null,
  floors text[] not null default '{}' check (cardinality(floors) <= 5),
  window_start text not null default '' check (window_start = '' or window_start ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  window_end text not null default '' check (window_end = '' or window_end ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  why text not null default '' check (char_length(why) <= 300),
  created_at timestamptz not null default now(),
  unique (run_id, finding_id)
);

create table if not exists autonomy.shadow_verdict (
  id bigint generated always as identity primary key,
  decision_id bigint not null references autonomy.shadow_decision (id),
  verdict text not null check (verdict in ('agree', 'disagree')),
  reason text check (reason in ('floor-missed', 'over-cautious', 'wrong-window', 'wrong-customer-rule', 'wrong-plan', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  actor text not null check (actor ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  at timestamptz not null default now(),
  check ((verdict = 'agree' and reason is null) or (verdict = 'disagree' and reason is not null))
);

alter table autonomy.shadow_run enable row level security;
alter table autonomy.shadow_decision enable row level security;
alter table autonomy.shadow_verdict enable row level security;
revoke all on autonomy.shadow_run, autonomy.shadow_decision, autonomy.shadow_verdict from public, anon, authenticated;
revoke all on schema autonomy from public, anon, authenticated;

create or replace function autonomy.shadow_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'the shadow protocol is append only: an entry cannot be changed or removed';
end $$;
drop trigger if exists shadow_run_no_change on autonomy.shadow_run;
create trigger shadow_run_no_change before update or delete on autonomy.shadow_run for each row execute function autonomy.shadow_append_only();
drop trigger if exists shadow_decision_no_change on autonomy.shadow_decision;
create trigger shadow_decision_no_change before update or delete on autonomy.shadow_decision for each row execute function autonomy.shadow_append_only();
drop trigger if exists shadow_verdict_no_change on autonomy.shadow_verdict;
create trigger shadow_verdict_no_change before update or delete on autonomy.shadow_verdict for each row execute function autonomy.shadow_append_only();

-- One run: the numbers of the load and every decision of the agent, in one call. Returns the run and the id of each decision by finding.
create or replace function public.autonomy_shadow_start(p_actor text, p_run jsonb, p_decisions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r autonomy.shadow_run; d jsonb; did bigint; ids jsonb := '{}'::jsonb;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_run is null or jsonb_typeof(p_run) <> 'object' then raise exception 'the run must be an object'; end if;
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then raise exception 'the decisions must be a list'; end if;
  if jsonb_array_length(p_decisions) > 100 then raise exception 'at most 100 decisions per run'; end if;
  insert into autonomy.shadow_run (started_by, adapter, fetched_at, alerts, findings, skipped, withheld)
  values (lower(p_actor), p_run->>'adapter', p_run->>'fetchedAt', (p_run->>'alerts')::integer, (p_run->>'findings')::integer, (p_run->>'skipped')::integer, (p_run->>'withheld')::integer)
  returning * into r;
  for d in select * from jsonb_array_elements(p_decisions) loop
    insert into autonomy.shadow_decision (run_id, finding_id, host, kind, template, env, customer, deadline_days, agent_mode, customer_needed, floors, window_start, window_end, why)
    values (r.id, d->>'findingId', d->>'host', d->>'kind', d->>'template', d->>'env', coalesce(d->>'customer', ''), (d->>'deadlineDays')::integer, d->>'mode',
            coalesce((d->>'customerNeeded')::boolean, false), coalesce(array(select jsonb_array_elements_text(coalesce(d->'floors', '[]'::jsonb))), '{}'::text[]),
            coalesce(d->>'windowStart', ''), coalesce(d->>'windowEnd', ''), left(coalesce(d->>'why', ''), 300))
    returning id into did;
    ids := ids || jsonb_build_object(d->>'findingId', did);
  end loop;
  return jsonb_build_object('runId', r.id, 'decisions', ids);
end $$;

-- A person's verdict on one decision. A new verdict on the same decision is a new row; the latest counts.
create or replace function public.autonomy_shadow_verdict(p_actor text, p_decision bigint, p_verdict text, p_reason text default null, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d autonomy.shadow_decision; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_id bigint;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  select * into d from autonomy.shadow_decision where id = p_decision;
  if not found then raise exception 'unknown decision'; end if;
  if p_verdict is null or p_verdict not in ('agree', 'disagree') then raise exception 'the verdict must be agree or disagree'; end if;
  if p_verdict = 'agree' and v_reason is not null then raise exception 'an agreement has no reason'; end if;
  if p_verdict = 'disagree' then
    if v_reason is null or v_reason not in ('floor-missed', 'over-cautious', 'wrong-window', 'wrong-customer-rule', 'wrong-plan', 'other') then raise exception 'a disagreement needs a known reason'; end if;
    if v_reason = 'floor-missed' and d.agent_mode <> 'auto' then raise exception 'floor-missed applies only to a decision to run by itself'; end if;
    if v_reason = 'over-cautious' and d.agent_mode <> 'approval' then raise exception 'over-cautious applies only to a decision to wait for a person'; end if;
  end if;
  insert into autonomy.shadow_verdict (decision_id, verdict, reason, note, actor)
  values (p_decision, p_verdict, v_reason, left(coalesce(btrim(p_note), ''), 300), lower(p_actor)) returning id into v_id;
  return jsonb_build_object('verdictId', v_id, 'decisionId', p_decision, 'verdict', p_verdict, 'reason', v_reason);
end $$;

-- The numbers of the whole protocol: how many plans, how many judged, how many agreed, and floorMissed (the abort criterion).
create or replace function public.autonomy_shadow_summary(p_actor text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out jsonb;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  with latest as (
    select distinct on (decision_id) decision_id, verdict, reason from autonomy.shadow_verdict order by decision_id, id desc
  )
  select jsonb_build_object(
    'runs', (select count(*) from autonomy.shadow_run),
    'decisions', (select count(*) from autonomy.shadow_decision),
    'auto', (select count(*) from autonomy.shadow_decision where agent_mode = 'auto'),
    'judged', (select count(*) from latest),
    'agree', (select count(*) from latest where verdict = 'agree'),
    'disagree', (select count(*) from latest where verdict = 'disagree'),
    'floorMissed', (select count(*) from latest where reason = 'floor-missed'),
    'byReason', coalesce((select jsonb_object_agg(reason, n) from (select reason, count(*) as n from latest where reason is not null group by reason) t), '{}'::jsonb),
    'lastRun', (select jsonb_build_object('id', id, 'at', started_at, 'findings', findings) from autonomy.shadow_run order by id desc limit 1)
  ) into out;
  return out;
end $$;

revoke all on function autonomy.shadow_append_only() from public, anon, authenticated;
revoke all on function public.autonomy_shadow_start(text, jsonb, jsonb), public.autonomy_shadow_verdict(text, bigint, text, text, text), public.autonomy_shadow_summary(text) from public, anon, authenticated;
grant execute on function public.autonomy_shadow_start(text, jsonb, jsonb), public.autonomy_shadow_verdict(text, bigint, text, text, text), public.autonomy_shadow_summary(text) to service_role;
