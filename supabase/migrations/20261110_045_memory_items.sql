-- Memory entries in the shared database. Only entries someone asks to share ever arrive here; private notes stay on the computer.
-- 1. werkbank.work_item may have kind 'memory' (text, kind and Space of one entry in memory.json, a readable memory.md).
-- 2. work_save refuses to widen the visibility of a memory entry (like a studio agent): sharing goes through work_promotion_request,
--    the same roles and rules as skills and agents (the requester never decides; department admin; Governance board; company only via the department).
-- 3. The request runs the five skill checks on the entry text, and the 'secrets' check also fails on a password, key, card number or IBAN.
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'werkbank.work_item'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%workflow%' and pg_get_constraintdef(oid) like '%kind%';
  if c is not null then execute format('alter table werkbank.work_item drop constraint %I', c); end if;
end $$;
alter table werkbank.work_item add constraint work_item_kind_ok check (kind in ('agent', 'workflow', 'code', 'memory'));

create or replace function werkbank.agent_check_input(p_item uuid, p_rev integer)
returns table (body text, tools jsonb)
language sql stable security definer set search_path = '' as $$
  select coalesce(md.content, '') || E'\n' || coalesce(j.content::jsonb #>> '{agent,instruction}', '') || E'\n' || coalesce(m.content::jsonb #>> '{entry,text}', ''),
         case when j.content::jsonb #>> '{agent,canWrite}' = 'true' then '["write_access"]'::jsonb else '[]'::jsonb end
  from (select 1) o
  left join werkbank.work_item_file md on md.item_id = p_item and md.rev = p_rev and md.path = 'agent.md'
  left join werkbank.work_item_file j on j.item_id = p_item and j.rev = p_rev and j.path = 'studio-agent.json'
  left join werkbank.work_item_file m on m.item_id = p_item and m.rev = p_rev and m.path = 'memory.json';
$$;

create or replace function public.work_save(
  p_actor text, p_id uuid, p_kind text, p_name text, p_visibility text, p_team uuid, p_stage text,
  p_intent jsonb, p_approved text[], p_files jsonb, p_note text, p_expected_rev integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w werkbank.work_item; v_id uuid := p_id; v_rev integer; f jsonb;
begin
  if p_kind not in ('agent', 'workflow', 'code', 'memory') then raise exception 'kind must be agent, workflow, code or memory'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'name must have 1 to 120 characters'; end if;
  perform werkbank.check_files(p_files, 200, 1000000);
  if p_visibility not in ('private', 'team', 'company') then raise exception 'visibility must be private, team or company'; end if;
  -- A studio agent or a memory entry moves up (private -> team -> company) only through a request (work_promotion_*), never by saving it with a wider visibility.
  -- Lowering the visibility, or saving with the visibility the item already has, stays allowed.
  if coalesce(p_stage, '') = 'studio-agent' or p_kind = 'memory' or (v_id is not null and exists (select 1 from werkbank.work_item x where x.id = v_id and (x.stage = 'studio-agent' or x.kind = 'memory'))) then
    if (case p_visibility when 'company' then 2 when 'team' then 1 else 0 end) >
       (case when v_id is null then 0 else coalesce((select case x.visibility when 'company' then 2 when 'team' then 1 else 0 end from werkbank.work_item x where x.id = v_id), 0) end) then
      raise exception 'A studio agent or a memory entry moves up only through a request (request_agent_promotion)';
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

create or replace function public.work_promotion_request(p_actor text, p_id uuid, p_to text, p_group uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w werkbank.work_item; pid uuid; st text; b text; t jsonb;
begin
  select * into w from werkbank.work_item where id = p_id;
  if not found or not werkbank.work_can_read(p_id, p_actor) then raise exception 'This item does not exist or is not visible to you'; end if;
  if not ((w.kind = 'agent' and w.stage = 'studio-agent') or w.kind = 'memory') then raise exception 'Only studio agents and memory entries can be requested for a higher level'; end if;
  if w.archived then raise exception 'An archived agent cannot be requested'; end if;
  if not werkbank.work_can_write(p_id, p_actor) then raise exception 'Only the owner may ask to share this item'; end if;
  if p_to not in ('team', 'company') then raise exception 'invalid target level'; end if;
  if p_to = 'team' then
    if w.visibility <> 'private' then raise exception 'it is already shared with a department or the organization'; end if;
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
  -- A memory entry is shared with other people: no password, key, card number or IBAN (the same words the app refuses, src/memory.ts looksSecret).
  if w.kind = 'memory' and coalesce(b, '') ~* '(password|passwort|kennwort|api[ _-]?key|secret|token|bearer|iban|kreditkarte|credit card|\mpin\M|sk-[a-z0-9]{10,}|sb_secret|\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4})' then
    update werkbank.work_promotion_check set status = 'fail', detail = 'Looks like a password, key, card number or IBAN. A memory entry shared with others must not contain it.'
      where promotion_id = pid and check_id = 'secrets';
  end if;
  if exists (select 1 from werkbank.work_promotion_check where promotion_id = pid and status = 'fail') then
    update werkbank.work_promotion set status = 'blocked' where id = pid; st := 'blocked';
  else st := 'review'; end if;
  return jsonb_build_object('id', pid, 'status', st, 'rev', w.current_rev);
end $$;
