-- Scheduler run log: one row per run of a scheduler job (agent, workflow or skill), written by the Werkbank app after the run.
-- Append only (a trigger refuses update and delete), so the log can be trusted. The person who ran it is the e-mail label (p_actor)
-- until the sign-in is decided. Same pattern as the work items: table closed to anon/authenticated, functions only for service_role.
-- Reading: every person sees their own runs; the Governance board sees all runs (who ran which job, when).

create schema if not exists werkbank;

create table if not exists werkbank.job_run (
  owner text not null check (owner ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(owner) <= 120),
  run_id text not null check (run_id ~ '^[A-Za-z0-9._-]{1,80}$'),
  job_id text not null check (char_length(job_id) between 1 and 80),
  job_name text not null check (char_length(job_name) between 1 and 120),
  target_type text not null check (target_type in ('agent', 'workflow', 'skill')),
  target_label text not null default '' check (char_length(target_label) <= 120),
  started_at timestamptz not null,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  status text not null check (status in ('ok', 'error', 'skipped')),
  trigger_kind text not null check (trigger_kind in ('schedule', 'manual')),
  note text not null default '' check (char_length(note) <= 300),
  recorded_at timestamptz not null default now(),
  primary key (owner, run_id)
);
create index if not exists job_run_started_idx on werkbank.job_run (started_at desc);

alter table werkbank.job_run enable row level security;
revoke all on werkbank.job_run from anon, authenticated;

-- Append only: no path (not even the service role through a function) may change or remove a logged run.
create or replace function werkbank.job_run_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'the run log is append only: a logged run cannot be changed or removed';
end $$;
drop trigger if exists job_run_no_change on werkbank.job_run;
create trigger job_run_no_change before update or delete on werkbank.job_run for each row execute function werkbank.job_run_append_only();

-- p_runs: [{id, jobId, jobName, targetType, targetLabel, at, ms, status, trigger, note}], at most 50 per call.
-- Sending the same run again is harmless (it is skipped), so the app can retry after a failed send.
create or replace function public.job_runs_record(p_actor text, p_runs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb; n_new integer := 0; got integer; v_note text;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_runs is null or jsonb_typeof(p_runs) <> 'array' then raise exception 'runs must be a list'; end if;
  if jsonb_array_length(p_runs) > 50 then raise exception 'at most 50 runs per call'; end if;
  for r in select * from jsonb_array_elements(p_runs) loop
    v_note := left(coalesce(r->>'note', ''), 300);
    -- A note is a short message; a credential in it is replaced instead of losing the entry.
    if werkbank.find_secret(v_note) is not null then v_note := '[note removed: it looked like it contained a credential]'; end if;
    insert into werkbank.job_run (owner, run_id, job_id, job_name, target_type, target_label, started_at, duration_ms, status, trigger_kind, note)
    values (lower(p_actor), r->>'id', r->>'jobId', left(coalesce(nullif(r->>'jobName', ''), '(unnamed)'), 120), r->>'targetType',
            left(coalesce(r->>'targetLabel', ''), 120), (r->>'at')::timestamptz, greatest(coalesce((r->>'ms')::integer, 0), 0),
            r->>'status', coalesce(r->>'trigger', 'schedule'), v_note)
    on conflict (owner, run_id) do nothing;
    get diagnostics got = row_count;
    n_new := n_new + got;
  end loop;
  return jsonb_build_object('received', jsonb_array_length(p_runs), 'stored', n_new);
end $$;

-- Newest first. p_mine true limits the Governance board to its own runs. The filters are optional.
create or replace function public.job_runs_list(
  p_actor text, p_since timestamptz default null, p_job text default null, p_status text default null,
  p_trigger text default null, p_mine boolean default false, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean; v_job text := nullif(btrim(coalesce(p_job, '')), '');
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_status is not null and p_status not in ('ok', 'error', 'skipped') then raise exception 'status must be ok, error or skipped'; end if;
  if p_trigger is not null and p_trigger not in ('schedule', 'manual') then raise exception 'trigger must be schedule or manual'; end if;
  v_all := skills.is_board_admin(p_actor) and not coalesce(p_mine, false);
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object('who', j.owner, 'id', j.run_id, 'jobId', j.job_id, 'jobName', j.job_name, 'targetType', j.target_type,
             'targetLabel', j.target_label, 'at', j.started_at, 'ms', j.duration_ms, 'status', j.status, 'trigger', j.trigger_kind, 'note', j.note) as x
      from werkbank.job_run j
     where (v_all or lower(j.owner) = lower(p_actor))
       and (p_since is null or j.started_at >= p_since)
       and (v_job is null or position(lower(v_job) in lower(j.job_name || ' ' || j.target_label)) > 0)
       and (p_status is null or j.status = p_status)
       and (p_trigger is null or j.trigger_kind = p_trigger)
     order by j.started_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 1000)) t), '[]'::jsonb);
end $$;

revoke all on function werkbank.job_run_append_only() from public, anon, authenticated;
revoke all on function public.job_runs_record(text, jsonb), public.job_runs_list(text, timestamptz, text, text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.job_runs_record(text, jsonb), public.job_runs_list(text, timestamptz, text, text, text, boolean, integer) to service_role;
