-- Recruiting: the rubric assessment of an application interview, kept for the hiring manager.
-- One assessment per session code, kept as REVISIONS: revision 1 is usually the AI proposal, later revisions are the hiring manager's
-- review. Each revision holds four levels (content, collab, rhetoric, creativity), each 1 to 5 or empty, with the AI level, the level the
-- hiring manager set, and a verbatim quote from the answers. There is no single score stored by the AI and no ranking; "overall" is the
-- equal-weight mean the app shows to the hiring manager, kept only when all four levels exist.
-- It holds NO name and NO e-mail address (the database refuses one). Only the hiring manager of the requisition can save or read it,
-- and a revision cannot be changed or removed. The agent has no tool for it.
-- Run in the Supabase SQL editor after 035. Safe to run again.

create table if not exists recruiting.interview_assessment (
  id bigint generated always as identity primary key,
  requisition_id text not null references recruiting.requisition (id),
  session_code text not null check (session_code ~ '^[A-Z0-9-]{4,24}$'),
  revision integer not null check (revision >= 1),
  profile text not null check (profile ~ '^[a-z0-9-]{2,40}$'),
  rubric_version text not null check (char_length(rubric_version) between 1 and 20),
  mode text not null check (mode in ('ai', 'fallback')),
  mode_note text not null default '' check (char_length(mode_note) <= 200),
  levels jsonb not null check (jsonb_typeof(levels) = 'array' and jsonb_array_length(levels) = 4),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and char_length(payload::text) <= 40000),
  reviewed boolean not null default false,
  reviewed_by text,
  overall numeric(2, 1) check (overall is null or overall between 1 and 5),
  saved_by text not null check (saved_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  saved_at timestamptz not null default now(),
  unique (requisition_id, session_code, revision)
);
alter table recruiting.interview_assessment enable row level security;
revoke all on recruiting.interview_assessment from anon, authenticated;

create or replace function recruiting.interview_assessment_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'an interview assessment is append only: add a new revision instead';
end $$;
drop trigger if exists interview_assessment_no_change on recruiting.interview_assessment;
create trigger interview_assessment_no_change before update or delete on recruiting.interview_assessment for each row execute function recruiting.interview_assessment_append_only();

-- The shape of the four levels. With p_final, every dimension that was answered needs a level (the hiring manager's or a rated AI level).
create or replace function recruiting.assessment_levels_ok(p_levels jsonb, p_final boolean)
returns boolean language plpgsql immutable set search_path = '' as $$
declare e jsonb; keys text[] := '{}'; st text; ai_t text; hu_t text;
begin
  if jsonb_typeof(p_levels) is distinct from 'array' or jsonb_array_length(p_levels) <> 4 then return false; end if;
  for e in select x from jsonb_array_elements(p_levels) as x loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if (e->>'key') is null or (e->>'key') not in ('content', 'collab', 'rhetoric', 'creativity') or (e->>'key') = any(keys) then return false; end if;
    keys := keys || (e->>'key');
    st := e->>'status';
    if st is null or st not in ('rated', 'no-evidence', 'no-answer', 'unrated') then return false; end if;
    ai_t := coalesce(jsonb_typeof(e->'ai'), 'null');
    hu_t := coalesce(jsonb_typeof(e->'human'), 'null');
    if ai_t not in ('null', 'number') or hu_t not in ('null', 'number') then return false; end if;
    if ai_t = 'number' and (((e->>'ai')::numeric) not between 1 and 5 or (e->>'ai')::numeric <> trunc((e->>'ai')::numeric)) then return false; end if;
    if hu_t = 'number' and (((e->>'human')::numeric) not between 1 and 5 or (e->>'human')::numeric <> trunc((e->>'human')::numeric)) then return false; end if;
    if st = 'rated' and ai_t <> 'number' then return false; end if;
    if st <> 'rated' and ai_t = 'number' then return false; end if;
    if p_final and hu_t = 'null' and st not in ('rated', 'no-answer') then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.recruiting_assessment_save(
  p_actor text, p_requisition text, p_session text, p_profile text, p_rubric text, p_mode text, p_mode_note text,
  p_levels jsonb, p_payload jsonb, p_final boolean, p_overall numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_mail text := lower(btrim(coalesce(p_actor, ''))); v_rev integer;
begin
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if not recruiting.posting_is_manager(p_requisition, v_mail) then
    raise exception 'only the hiring manager of this requisition can keep an interview assessment';
  end if;
  if coalesce(p_payload::text, '') ~* '[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}' or coalesce(p_levels::text, '') ~* '[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}' then
    raise exception 'an assessment holds no e-mail address';
  end if;
  if not recruiting.assessment_levels_ok(p_levels, coalesce(p_final, false)) then
    raise exception 'the levels are not valid: four dimensions, whole levels 1 to 5, and a level for every answered dimension when confirming';
  end if;
  select coalesce(max(revision), 0) + 1 into v_rev from recruiting.interview_assessment where requisition_id = p_requisition and session_code = coalesce(p_session, '');
  insert into recruiting.interview_assessment (requisition_id, session_code, revision, profile, rubric_version, mode, mode_note, levels, payload, reviewed, reviewed_by, overall, saved_by)
  values (p_requisition, coalesce(p_session, ''), v_rev, coalesce(p_profile, ''), coalesce(p_rubric, ''), coalesce(p_mode, ''), coalesce(p_mode_note, ''),
          p_levels, coalesce(p_payload, 'null'::jsonb), coalesce(p_final, false), case when coalesce(p_final, false) then v_mail else null end, p_overall, v_mail);
  return jsonb_build_object('saved', true, 'revision', v_rev, 'reviewed', coalesce(p_final, false));
end $$;

create or replace function public.recruiting_assessments(p_actor text, p_requisition text default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_mail text := lower(btrim(coalesce(p_actor, '')));
begin
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'requisition', x.requisition_id, 'session', x.session_code, 'revision', x.revision,
      'profile', x.profile, 'rubric', x.rubric_version, 'mode', x.mode, 'modeNote', x.mode_note, 'levels', x.levels, 'reviewed', x.reviewed,
      'reviewedBy', x.reviewed_by, 'overall', x.overall, 'savedAt', x.saved_at, 'record', x.payload) order by x.saved_at desc, x.revision desc)
    from (select r.* from recruiting.interview_assessment r
           where (p_requisition is null or r.requisition_id = p_requisition) and recruiting.posting_is_manager(r.requisition_id, v_mail)
           order by r.saved_at desc, r.revision desc limit greatest(1, least(coalesce(p_limit, 50), 200))) x), '[]'::jsonb);
end $$;

revoke all on function recruiting.assessment_levels_ok(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.recruiting_assessment_save(text, text, text, text, text, text, text, jsonb, jsonb, boolean, numeric) from public, anon, authenticated;
revoke all on function public.recruiting_assessments(text, text, integer) from public, anon, authenticated;
grant execute on function public.recruiting_assessment_save(text, text, text, text, text, text, text, jsonb, jsonb, boolean, numeric) to service_role;
grant execute on function public.recruiting_assessments(text, text, integer) to service_role;
