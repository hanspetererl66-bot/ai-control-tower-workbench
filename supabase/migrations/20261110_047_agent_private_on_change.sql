-- Studio agents: once shared (team or company) an agent that is saved with other content falls back to private. The checks and the
-- decision were for the approved text; without this the owner could change an approved agent for everybody (migration 044 only
-- stopped widening the visibility). The same content saved again, or a save that lowers the visibility, changes nothing.
-- The save answers with the visibility the item has afterwards. Only the body of public.work_save changes.

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
    -- A studio agent that is shared (team or company) and gets other content falls back to private: the checks and the decision were for the
    -- text that was approved. Saving the same content again (or only lowering the visibility) changes nothing.
    if w.stage = 'studio-agent' and w.visibility <> 'private' and p_visibility <> 'private' and (
         (select count(*) from werkbank.work_item_file x where x.item_id = v_id and x.rev = w.current_rev) <> jsonb_array_length(p_files)
         or exists (select 1 from jsonb_array_elements(p_files) pf where not exists (
              select 1 from werkbank.work_item_file x where x.item_id = v_id and x.rev = w.current_rev and x.path = pf->>'path' and x.content = pf->>'content'))) then
      p_visibility := 'private';
      p_team := null;
    end if;
    -- A shared memory entry is fixed text: changing it would reach the department or the company without the checks and the decision.
    -- Lowering to private is allowed (and may change the text at the same time); then it can be requested again.
    if w.kind = 'memory' and w.visibility <> 'private' and p_visibility <> 'private' then
      raise exception 'A shared memory entry cannot be changed. Make it private first, then ask to share it again';
    end if;
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
  return jsonb_build_object('id', v_id, 'rev', v_rev, 'files', jsonb_array_length(p_files), 'visibility', p_visibility);
end $$;
