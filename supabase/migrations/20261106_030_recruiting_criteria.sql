-- Recruiting: the hiring manager sets the criteria of an open requisition (must-haves and nice-to-haves).
-- Only the hiring manager of the requisition may change them (not even the Governance board), every change is logged
-- (append only), and the table checks from migration 028 still apply: no protected trait as a criterion.
-- Run in the Supabase SQL editor after 028. Safe to run again.

create table if not exists recruiting.criterion_event (
  id bigint generated always as identity primary key,
  requisition_id text not null,
  crit_id text not null,
  action text not null check (action in ('set', 'deleted')),
  actor text not null check (actor ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  at timestamptz not null default now(),
  before jsonb,
  after jsonb
);
alter table recruiting.criterion_event enable row level security;
revoke all on recruiting.criterion_event from anon, authenticated;

create or replace function recruiting.criterion_event_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'the criteria log is append only: an entry cannot be changed or removed';
end $$;
drop trigger if exists criterion_event_no_change on recruiting.criterion_event;
create trigger criterion_event_no_change before update or delete on recruiting.criterion_event for each row execute function recruiting.criterion_event_append_only();

create or replace function public.recruiting_criterion_set(
  p_actor text, p_requisition text, p_crit_id text, p_must boolean, p_label text, p_kind text,
  p_min_years integer default null, p_needles text[] default '{}', p_partial text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_mail text := lower(btrim(coalesce(p_actor, ''))); v_id text := nullif(btrim(coalesce(p_crit_id, '')), '');
  v_before jsonb; v_after jsonb; v_n int;
  v_needles text[] := coalesce(array(select btrim(x) from unnest(coalesce(p_needles, '{}')) x where btrim(x) <> ''), '{}');
  v_partial text[] := coalesce(array(select btrim(x) from unnest(coalesce(p_partial, '{}')) x where btrim(x) <> ''), '{}');
begin
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if not exists (select 1 from recruiting.requisition r where r.id = p_requisition and r.status = 'open' and lower(r.manager_email) = v_mail) then
    raise exception 'only the hiring manager of an open requisition can set its criteria';
  end if;
  if p_must is null then raise exception 'say whether the criterion is a must-have'; end if;
  if p_kind is null or p_kind not in ('text', 'years') then raise exception 'kind must be text or years'; end if;
  if werkbank.find_secret(coalesce(p_label, '') || ' ' || array_to_string(v_needles || v_partial, ' ')) is not null then
    raise exception 'the text looks like it contains a credential';
  end if;
  if v_id is not null then
    if v_id !~ '^[MN][0-9]{1,2}$' then raise exception 'unknown criterion id'; end if;
    if (v_id like 'M%') <> p_must then raise exception 'a criterion cannot change between must-have and nice-to-have: delete it and add a new one'; end if;
    select to_jsonb(c) - 'requisition_id' into v_before from recruiting.criterion c where c.requisition_id = p_requisition and c.crit_id = v_id;
    if v_before is null then raise exception 'unknown criterion id'; end if;
    update recruiting.criterion set label = btrim(p_label), kind = p_kind, min_years = case when p_kind = 'years' then p_min_years else null end,
      needles = case when p_kind = 'years' then '{}' else v_needles end, partial = case when p_kind = 'years' then '{}' else v_partial end
     where requisition_id = p_requisition and crit_id = v_id;
  else
    select count(*) into v_n from recruiting.criterion where requisition_id = p_requisition;
    if v_n >= 12 then raise exception 'a requisition can have at most 12 criteria'; end if;
    select (case when p_must then 'M' else 'N' end) || (coalesce(max(substr(crit_id, 2)::int), 0) + 1)
      into v_id from recruiting.criterion where requisition_id = p_requisition and crit_id like (case when p_must then 'M' else 'N' end) || '%';
    insert into recruiting.criterion (requisition_id, crit_id, must, label, kind, min_years, needles, partial)
    values (p_requisition, v_id, p_must, btrim(p_label), p_kind, case when p_kind = 'years' then p_min_years else null end,
            case when p_kind = 'years' then '{}' else v_needles end, case when p_kind = 'years' then '{}' else v_partial end);
  end if;
  select to_jsonb(c) - 'requisition_id' into v_after from recruiting.criterion c where c.requisition_id = p_requisition and c.crit_id = v_id;
  insert into recruiting.criterion_event (requisition_id, crit_id, action, actor, before, after) values (p_requisition, v_id, 'set', v_mail, v_before, v_after);
  return jsonb_build_object('id', v_id, 'created', v_before is null);
end $$;

create or replace function public.recruiting_criterion_delete(p_actor text, p_requisition text, p_crit_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_mail text := lower(btrim(coalesce(p_actor, ''))); v_before jsonb;
begin
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if not exists (select 1 from recruiting.requisition r where r.id = p_requisition and r.status = 'open' and lower(r.manager_email) = v_mail) then
    raise exception 'only the hiring manager of an open requisition can set its criteria';
  end if;
  select to_jsonb(c) - 'requisition_id' into v_before from recruiting.criterion c where c.requisition_id = p_requisition and c.crit_id = p_crit_id;
  if v_before is null then raise exception 'unknown criterion id'; end if;
  delete from recruiting.criterion where requisition_id = p_requisition and crit_id = p_crit_id;
  insert into recruiting.criterion_event (requisition_id, crit_id, action, actor, before) values (p_requisition, p_crit_id, 'deleted', v_mail, v_before);
  return jsonb_build_object('id', p_crit_id, 'deleted', true);
end $$;

revoke all on function recruiting.criterion_event_append_only() from public, anon, authenticated;
revoke all on function public.recruiting_criterion_set(text, text, text, boolean, text, text, integer, text[], text[]), public.recruiting_criterion_delete(text, text, text) from public, anon, authenticated;
grant execute on function public.recruiting_criterion_set(text, text, text, boolean, text, text, integer, text[], text[]), public.recruiting_criterion_delete(text, text, text) to service_role;

-- The open requisitions the actor manages, with their criteria (same shape as the snapshot). For the criteria editor.
create or replace function public.recruiting_criteria_mine(p_actor text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'dept', r.dept, 'criteria', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.crit_id, 'must', c.must, 'text', c.label, 'kind', c.kind, 'min', c.min_years,
             'needles', to_jsonb(c.needles), 'partial', to_jsonb(c.partial)) order by c.must desc, substr(c.crit_id, 2)::int)
      from recruiting.criterion c where c.requisition_id = r.id), '[]'::jsonb)) order by r.id), '[]'::jsonb)
  from recruiting.requisition r where r.status = 'open' and lower(r.manager_email) = lower(btrim(coalesce(p_actor, '')));
$$;
revoke all on function public.recruiting_criteria_mine(text) from public, anon, authenticated;
grant execute on function public.recruiting_criteria_mine(text) to service_role;
