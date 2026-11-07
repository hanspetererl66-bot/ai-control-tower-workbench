-- Recruiting: the record of an online interview, kept for the hiring manager.
-- Holds the answers, the task text, the result per criterion (the four verdicts with a quote), the counts and a short summary.
-- It holds NO name, NO e-mail address and NO letter; a session code stands for the person. The database refuses a record with an
-- e-mail address in it. Only the hiring manager of the requisition can save or read records; a record cannot be changed or removed.
-- Run in the Supabase SQL editor after 033. Safe to run again.

create table if not exists recruiting.interview_record (
  id bigint generated always as identity primary key,
  requisition_id text not null references recruiting.requisition (id),
  session_code text not null check (session_code ~ '^[A-Z0-9-]{4,24}$'),
  mode text not null check (mode in ('ai', 'mock')),
  mode_note text not null default '' check (char_length(mode_note) <= 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and char_length(payload::text) <= 40000),
  summary text not null default '' check (char_length(summary) <= 1500),
  saved_by text not null check (saved_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  saved_at timestamptz not null default now(),
  unique (requisition_id, session_code)
);
alter table recruiting.interview_record enable row level security;
revoke all on recruiting.interview_record from anon, authenticated;

create or replace function recruiting.interview_record_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'an interview record is append only: it cannot be changed or removed';
end $$;
drop trigger if exists interview_record_no_change on recruiting.interview_record;
create trigger interview_record_no_change before update or delete on recruiting.interview_record for each row execute function recruiting.interview_record_append_only();

create or replace function public.recruiting_interview_save(
  p_actor text, p_requisition text, p_session text, p_mode text, p_mode_note text, p_payload jsonb, p_summary text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_mail text := lower(btrim(coalesce(p_actor, ''))); v_id bigint;
begin
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if not recruiting.posting_is_manager(p_requisition, v_mail) then
    raise exception 'only the hiring manager of this requisition can keep an interview record';
  end if;
  if coalesce(p_payload::text, '') ~* '[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}' or coalesce(p_summary, '') ~* '[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}' then
    raise exception 'a record holds no e-mail address';
  end if;
  insert into recruiting.interview_record (requisition_id, session_code, mode, mode_note, payload, summary, saved_by)
  values (p_requisition, coalesce(p_session, ''), coalesce(p_mode, ''), coalesce(p_mode_note, ''), coalesce(p_payload, 'null'::jsonb), coalesce(p_summary, ''), v_mail)
  on conflict (requisition_id, session_code) do nothing
  returning id into v_id;
  return jsonb_build_object('saved', v_id is not null, 'id', v_id, 'note', case when v_id is null then 'a record with this session code exists already; it is never overwritten' else '' end);
end $$;

create or replace function public.recruiting_interview_records(p_actor text, p_requisition text default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_mail text := lower(btrim(coalesce(p_actor, '')));
begin
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'requisition', x.requisition_id, 'session', x.session_code, 'mode', x.mode,
      'modeNote', x.mode_note, 'savedAt', x.saved_at, 'summary', x.summary, 'record', x.payload) order by x.saved_at desc)
    from (select r.* from recruiting.interview_record r
           where (p_requisition is null or r.requisition_id = p_requisition) and recruiting.posting_is_manager(r.requisition_id, v_mail)
           order by r.saved_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) x), '[]'::jsonb);
end $$;

revoke all on function public.recruiting_interview_save(text, text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.recruiting_interview_records(text, text, integer) from public, anon, authenticated;
grant execute on function public.recruiting_interview_save(text, text, text, text, text, jsonb, text) to service_role;
grant execute on function public.recruiting_interview_records(text, text, integer) to service_role;
