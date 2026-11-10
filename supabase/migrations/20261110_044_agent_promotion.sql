-- Studio agents move up (private -> team -> company) through a request with automatic checks and a decision by another person,
-- the same roles and rules as skills (migration 019): the requester never decides; a department needs an admin of that department,
-- the whole organization needs an admin of the group 'Governance board'; a request for company needs the agent to be in a department first.
-- The checks are the five skill checks (skills.run_checks) on the agent text: purpose, instruction, sources; an agent that may write counts as a tool that changes data.
-- 1. work_save refuses to widen the visibility of a studio agent (stage 'studio-agent'): the owner could otherwise publish without a request.
-- 2. werkbank.work_promotion(+_check) and the functions work_promotion_request/_decide/_withdraw/_list. Service role only, like all work item functions.
-- Other work items (projects) are unchanged: their visibility can still be set directly.

create or replace function public.work_save(
  p_actor text, p_id uuid, p_kind text, p_name text, p_visibility text, p_team uuid, p_stage text,
  p_intent jsonb, p_approved text[], p_files jsonb, p_note text, p_expected_rev integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w werkbank.work_item; v_id uuid := p_id; v_rev integer; f jsonb;
begin
  if p_kind not in ('agent', 'workflow', 'code') then raise exception 'kind must be agent, workflow or code'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'name must have 1 to 120 characters'; end if;
  perform werkbank.check_files(p_files, 200, 1000000);
  if p_visibility not in ('private', 'team', 'company') then raise exception 'visibility must be private, team or company'; end if;
  -- A studio agent moves up (private -> team -> company) only through a request (work_promotion_*), never by saving it with a wider visibility.
  -- Lowering the visibility, or saving with the visibility the item already has, stays allowed.
  if coalesce(p_stage, '') = 'studio-agent' or (v_id is not null and exists (select 1 from werkbank.work_item x where x.id = v_id and x.stage = 'studio-agent')) then
    if (case p_visibility when 'company' then 2 when 'team' then 1 else 0 end) >
       (case when v_id is null then 0 else coalesce((select case x.visibility when 'company' then 2 when 'team' then 1 else 0 end from werkbank.work_item x where x.id = v_id), 0) end) then
      raise exception 'A studio agent moves up only through a request (request_agent_promotion)';
    end if;
  end if;
  if p_visibility = 'team' and (p_team is null or not exists (
       select 1 from werkbank.group_members m where m.group_id = p_team and lower(m.email) = lower(p_actor))) then
    raise exception 'To share with a team you must be a member of that team';
  end if;
  if v_id is null then
    insert into werkbank.work_item (kind, name, owner, visibility, team_id, stage, intent, approved)
    values (p_kind, p_name, lower(p_actor), p_visibility, case when p_visibility = 'team' then p_team end,
            coalesce(p_stage, ''), coalesce(p_intent, '{}'::jsonb), coalesce(p_approved, '{}'))
    returning id into v_id;
    v_rev := 0;
  else
    select * into w from werkbank.work_item where id = v_id for update;
    if not found or not werkbank.work_can_read(v_id, p_actor) then raise exception 'This item does not exist or is not visible to you'; end if;
    if not werkbank.work_can_write(v_id, p_actor) then raise exception 'Only the owner, a team admin or the Governance board may change this item'; end if;
    if w.kind <> p_kind then raise exception 'The kind of an item cannot change (it is %)', w.kind; end if;
    if p_expected_rev is distinct from w.current_rev then
      raise exception 'The item was changed meanwhile (now revision %). Load it again and merge before saving', w.current_rev;
    end if;
    v_rev := w.current_rev;
    update werkbank.work_item set name = p_name, visibility = p_visibility,
      team_id = case when p_visibility = 'team' then p_team end,
      stage = coalesce(p_stage, ''), intent = coalesce(p_intent, '{}'::jsonb), approved = coalesce(p_approved, '{}'),
      updated_at = now() where id = v_id;
  end if;
  v_rev := v_rev + 1;
  insert into werkbank.work_item_rev (item_id, rev, author, note) values (v_id, v_rev, lower(p_actor), coalesce(left(p_note, 300), ''));
  for f in select * from jsonb_array_elements(p_files) loop
    insert into werkbank.work_item_file (item_id, rev, path, language, content, sha256)
    values (v_id, v_rev, f->>'path', coalesce(left(f->>'language', 30), ''), f->>'content',
            encode(sha256(convert_to(f->>'content', 'UTF8')), 'hex'));
  end loop;
  update werkbank.work_item set current_rev = v_rev where id = v_id;
  return jsonb_build_object('id', v_id, 'rev', v_rev, 'files', jsonb_array_length(p_files));
end $$;

create table if not exists werkbank.work_promotion (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references werkbank.work_item(id) on delete cascade,
  rev integer not null,
  to_visibility text not null check (to_visibility in ('team', 'company')),
  group_id uuid references werkbank.groups(id) on delete set null,
  requested_by text not null check (char_length(requested_by) between 3 and 120),
  note text not null default '' check (char_length(note) <= 400),
  status text not null default 'review' check (status in ('blocked', 'review', 'approved', 'rejected', 'withdrawn')),
  decided_by text,
  decided_at timestamptz,
  reason text not null default '' check (char_length(reason) <= 400),
  created_at timestamptz not null default now(),
  check ((to_visibility = 'team') = (group_id is not null))
);
create table if not exists werkbank.work_promotion_check (
  promotion_id uuid not null references werkbank.work_promotion(id) on delete cascade,
  check_id text not null check (check_id in ('secrets', 'scripts', 'permissions', 'harness', 'data')),
  status text not null check (status in ('pass', 'warn', 'fail')),
  detail text not null default '',
  primary key (promotion_id, check_id)
);
create unique index if not exists work_promotion_one_open on werkbank.work_promotion (item_id) where status in ('blocked', 'review');
alter table werkbank.work_promotion enable row level security;
alter table werkbank.work_promotion_check enable row level security;
revoke all on werkbank.work_promotion, werkbank.work_promotion_check from anon, authenticated;

-- Text and tools the checks read: the readable agent (purpose, instruction, sources) and, when the agent may write, one tool that changes data.
create or replace function werkbank.agent_check_input(p_item uuid, p_rev integer)
returns table (body text, tools jsonb)
language sql stable security definer set search_path = '' as $$
  select coalesce(md.content, '') || E'\n' || coalesce(j.content::jsonb #>> '{agent,instruction}', ''),
         case when j.content::jsonb #>> '{agent,canWrite}' = 'true' then '["write_access"]'::jsonb else '[]'::jsonb end
  from (select 1) o
  left join werkbank.work_item_file md on md.item_id = p_item and md.rev = p_rev and md.path = 'agent.md'
  left join werkbank.work_item_file j on j.item_id = p_item and j.rev = p_rev and j.path = 'studio-agent.json';
$$;

create or replace function public.work_promotion_request(p_actor text, p_id uuid, p_to text, p_group uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w werkbank.work_item; pid uuid; st text; b text; t jsonb;
begin
  select * into w from werkbank.work_item where id = p_id;
  if not found or not werkbank.work_can_read(p_id, p_actor) then raise exception 'This item does not exist or is not visible to you'; end if;
  if w.kind <> 'agent' or w.stage <> 'studio-agent' then raise exception 'Only studio agents can be requested for a higher level'; end if;
  if w.archived then raise exception 'An archived agent cannot be requested'; end if;
  if not werkbank.work_can_write(p_id, p_actor) then raise exception 'Only the owner may ask to share this agent'; end if;
  if p_to not in ('team', 'company') then raise exception 'invalid target level'; end if;
  if p_to = 'team' then
    if w.visibility <> 'private' then raise exception 'the agent is already shared with a department or the organization'; end if;
    if p_group is null or not exists (select 1 from werkbank.group_members m where m.group_id = p_group and lower(m.email) = lower(p_actor)) then
      raise exception 'the requester must be a member of the department';
    end if;
  else
    p_group := null;
    if w.visibility <> 'team' then raise exception 'share it with the department first'; end if;
  end if;
  if exists (select 1 from werkbank.work_promotion where item_id = p_id and status in ('blocked', 'review')) then
    raise exception 'there is already an open request for this agent';
  end if;
  select i.body, i.tools into b, t from werkbank.agent_check_input(p_id, w.current_rev) i;
  insert into werkbank.work_promotion (item_id, rev, to_visibility, group_id, requested_by, note, status)
    values (p_id, w.current_rev, p_to, p_group, lower(p_actor), coalesce(p_note, ''), 'review') returning id into pid;
  insert into werkbank.work_promotion_check (promotion_id, check_id, status, detail)
    select pid, c.check_id, c.status, c.detail from skills.run_checks(coalesce(b, ''), t, 'intern', p_to) c
    where c.check_id in ('secrets', 'scripts', 'permissions', 'harness', 'data');
  if exists (select 1 from werkbank.work_promotion_check where promotion_id = pid and status = 'fail') then
    update werkbank.work_promotion set status = 'blocked' where id = pid; st := 'blocked';
  else st := 'review'; end if;
  return jsonb_build_object('id', pid, 'status', st, 'rev', w.current_rev);
end $$;

create or replace function public.work_promotion_decide(p_actor text, p_id uuid, p_approve boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p werkbank.work_promotion; cur integer;
begin
  select * into p from werkbank.work_promotion where id = p_id for update;
  if not found then raise exception 'unknown request'; end if;
  if p.status <> 'review' then raise exception 'the request is not waiting for a decision (%)', p.status; end if;
  if lower(p_actor) = p.requested_by then raise exception 'the requester cannot decide their own request'; end if;
  if p.to_visibility = 'team' then
    if not exists (select 1 from werkbank.group_members m where m.group_id = p.group_id and lower(m.email) = lower(p_actor) and m.role = 'admin') then
      raise exception 'only an admin of the department may decide';
    end if;
  elsif not exists (
    select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id
    where g.name = 'Governance board' and lower(m.email) = lower(p_actor) and m.role = 'admin') then
    raise exception 'only the Governance board may decide';
  end if;
  if not p_approve and btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is needed to reject'; end if;
  select current_rev into cur from werkbank.work_item where id = p.item_id;
  if p_approve and cur <> p.rev then raise exception 'the agent changed after the request (revision % now %). Request again.', p.rev, cur; end if;
  update werkbank.work_promotion set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = lower(p_actor), decided_at = now(), reason = coalesce(p_reason, '') where id = p_id;
  if p_approve then
    update werkbank.work_item set visibility = p.to_visibility, team_id = case when p.to_visibility = 'team' then p.group_id end, updated_at = now()
      where id = p.item_id;
  end if;
  return jsonb_build_object('id', p_id, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;

create or replace function public.work_promotion_withdraw(p_actor text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update werkbank.work_promotion set status = 'withdrawn', decided_by = lower(p_actor), decided_at = now()
    where id = p_id and status in ('blocked', 'review') and requested_by = lower(p_actor);
  if not found then raise exception 'nothing to withdraw'; end if;
  return jsonb_build_object('id', p_id, 'status', 'withdrawn');
end $$;

create or replace function public.work_promotion_list(p_actor text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'item_id', p.item_id, 'name', w.name, 'rev', p.rev, 'to', p.to_visibility, 'status', p.status,
    'requested_by', p.requested_by, 'note', p.note, 'created_at', p.created_at,
    'decided_by', p.decided_by, 'decided_at', p.decided_at, 'reason', p.reason,
    'can_decide', p.status = 'review' and lower(p_actor) <> p.requested_by and (
      (p.to_visibility = 'team' and exists (select 1 from werkbank.group_members m where m.group_id = p.group_id and lower(m.email) = lower(p_actor) and m.role = 'admin'))
      or (p.to_visibility = 'company' and exists (select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id where g.name = 'Governance board' and lower(m.email) = lower(p_actor) and m.role = 'admin'))),
    'checks', (select coalesce(jsonb_agg(jsonb_build_object('id', c.check_id, 'status', c.status, 'detail', c.detail) order by c.check_id), '[]'::jsonb)
               from werkbank.work_promotion_check c where c.promotion_id = p.id)
  ) order by p.created_at desc), '[]'::jsonb)
  from (select * from werkbank.work_promotion order by created_at desc limit 100) p
  join werkbank.work_item w on w.id = p.item_id
  where lower(p_actor) = p.requested_by
     or exists (select 1 from werkbank.group_members m where lower(m.email) = lower(p_actor) and m.role = 'admin');
$$;

revoke all on function werkbank.agent_check_input(uuid, integer) from public, anon, authenticated;
revoke all on function public.work_promotion_request(text, uuid, text, uuid, text), public.work_promotion_decide(text, uuid, boolean, text),
  public.work_promotion_withdraw(text, uuid), public.work_promotion_list(text) from public, anon, authenticated;
grant execute on function public.work_promotion_request(text, uuid, text, uuid, text), public.work_promotion_decide(text, uuid, boolean, text),
  public.work_promotion_withdraw(text, uuid), public.work_promotion_list(text) to service_role;
