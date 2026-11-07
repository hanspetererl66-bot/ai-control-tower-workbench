-- Recruiting: import from an applicant tracking system (SmartRecruiters, first as a mock).
-- The import carries NO personal data: the caller (scripts/connector) removes names, e-mail and phone before sending, and the
-- tables reject what slips through (migration 028). A candidate gets a pseudonym (C-5001 ...) here; the id the source system uses
-- is kept only as an opaque reference so that a second import updates instead of duplicating.
-- Run in the Supabase SQL editor. Safe to run again.

alter table recruiting.requisition add column if not exists source_ref text;
alter table recruiting.candidate add column if not exists source_ref text;
create unique index if not exists requisition_source_ref on recruiting.requisition (source_ref) where source_ref is not null;
create unique index if not exists candidate_source_ref on recruiting.candidate (source_ref) where source_ref is not null;
alter table recruiting.requisition drop constraint if exists requisition_source_ref_ok;
alter table recruiting.requisition add constraint requisition_source_ref_ok check (source_ref is null or source_ref ~ '^[A-Za-z0-9:._-]{1,80}$');
alter table recruiting.candidate drop constraint if exists candidate_source_ref_ok;
alter table recruiting.candidate add constraint candidate_source_ref_ok check (source_ref is null or source_ref ~ '^[A-Za-z0-9:._-]{1,80}$');

create sequence if not exists recruiting.candidate_seq start 5001;

create or replace function public.recruiting_import(p_actor text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; c jsonb; v_id text; v_cid text; v_job text;
  n_req_new int := 0; n_req_upd int := 0; n_c_new int := 0; n_c_upd int := 0; n_skip int := 0;
  v_mail text := lower(btrim(coalesce(p_actor, '')));
begin
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'requisitions') <> 'array' or jsonb_typeof(p_payload->'candidates') <> 'array' then
    raise exception 'payload must hold the lists requisitions and candidates';
  end if;
  if jsonb_array_length(p_payload->'requisitions') > 200 or jsonb_array_length(p_payload->'candidates') > 5000 then
    raise exception 'payload is too large for one import';
  end if;

  for r in select * from jsonb_array_elements(p_payload->'requisitions') loop
    v_id := 'SR-' || left(regexp_replace(r->>'ref', '[^A-Za-z0-9]', '', 'g'), 30);
    if (r->>'ref') is null or length(v_id) < 4 then raise exception 'a requisition has no usable reference'; end if;
    if exists (select 1 from recruiting.requisition where source_ref = 'sr:' || (r->>'ref') and lower(manager_email) <> v_mail)
       and not skills.is_board_admin(v_mail) then
      raise exception 'requisition % belongs to another hiring manager', v_id;
    end if;
    if exists (select 1 from recruiting.requisition where source_ref = 'sr:' || (r->>'ref')) then
      update recruiting.requisition set title = left(r->>'title', 120), dept = left(coalesce(nullif(r->>'dept', ''), 'Unknown'), 60),
        location = left(coalesce(r->>'location', ''), 80), manager_role = left(coalesce(r->>'managerRole', ''), 80),
        opened_on = (r->>'openedOn')::date, target_days = coalesce((r->>'targetDays')::int, target_days)
       where source_ref = 'sr:' || (r->>'ref') and status = 'open';
      n_req_upd := n_req_upd + 1;
    else
      insert into recruiting.requisition (id, title, dept, location, manager_email, manager_role, opened_on, target_days, status, source_ref)
      values (v_id, left(r->>'title', 120), left(coalesce(nullif(r->>'dept', ''), 'Unknown'), 60), left(coalesce(r->>'location', ''), 80), v_mail,
              left(coalesce(r->>'managerRole', ''), 80), (r->>'openedOn')::date, coalesce((r->>'targetDays')::int, 45), 'open', 'sr:' || (r->>'ref'));
      n_req_new := n_req_new + 1;
    end if;
  end loop;

  for c in select * from jsonb_array_elements(p_payload->'candidates') loop
    select id into v_job from recruiting.requisition
     where source_ref = 'sr:' || (c->>'requisitionRef') and status = 'open' and (lower(manager_email) = v_mail or skills.is_board_admin(v_mail));
    if v_job is null then n_skip := n_skip + 1; continue; end if;
    select id into v_cid from recruiting.candidate where source_ref = 'sr:' || (c->>'ref');
    if v_cid is not null then
      update recruiting.candidate set requisition_id = v_job, stage = c->>'stage',
        stage_since = case when stage <> c->>'stage' then (c->>'stageSince')::date else stage_since end,
        years = nullif(c->>'years', '')::int, years_line = nullif(c->>'yearsLine', '')::int,
        cv_lines = coalesce(array(select jsonb_array_elements_text(c->'cv')), '{}')
       where id = v_cid;
      n_c_upd := n_c_upd + 1;
    else
      insert into recruiting.candidate (id, requisition_id, stage, stage_since, applied_on, years, years_line, cv_lines, source_ref)
      values ('C-' || nextval('recruiting.candidate_seq'), v_job, c->>'stage', (c->>'stageSince')::date, (c->>'appliedOn')::date,
              nullif(c->>'years', '')::int, nullif(c->>'yearsLine', '')::int, coalesce(array(select jsonb_array_elements_text(c->'cv')), '{}'), 'sr:' || (c->>'ref'));
      n_c_new := n_c_new + 1;
    end if;
  end loop;

  return jsonb_build_object('requisitionsNew', n_req_new, 'requisitionsUpdated', n_req_upd, 'candidatesNew', n_c_new,
                            'candidatesUpdated', n_c_upd, 'candidatesSkipped', n_skip);
end $$;

revoke all on function public.recruiting_import(text, jsonb) from public, anon, authenticated;
grant execute on function public.recruiting_import(text, jsonb) to service_role;
