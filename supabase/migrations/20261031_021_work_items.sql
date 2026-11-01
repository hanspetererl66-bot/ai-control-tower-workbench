-- Work items: agents, workflows and code of any kind (Python, JSON, Markdown, ...) live in the shared database,
-- every save is a new revision (full snapshot, nothing is overwritten), and skills can carry more files than SKILL.md.
-- Same pattern as the skill registry: tables closed to anon/authenticated, functions only for service_role (the connector).
-- Identity is the e-mail label (p_actor) until the sign-in is decided.

create schema if not exists werkbank;
create schema if not exists skills;

-- ---------- tables ----------
create table if not exists werkbank.work_item (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('agent', 'workflow', 'code')),
  name text not null check (char_length(name) between 1 and 120),
  owner text not null check (owner ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(owner) <= 120),
  visibility text not null default 'private' check (visibility in ('private', 'team', 'company')),
  team_id uuid references werkbank.groups(id) on delete set null,
  stage text not null default '' check (char_length(stage) <= 40),
  intent jsonb not null default '{}'::jsonb check (jsonb_typeof(intent) = 'object' and octet_length(intent::text) <= 65536),
  approved text[] not null default '{}',
  archived boolean not null default false,
  current_rev integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (visibility <> 'team' or team_id is not null)
);

create table if not exists werkbank.work_item_rev (
  item_id uuid not null references werkbank.work_item(id) on delete cascade,
  rev integer not null check (rev >= 1),
  author text not null,
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  primary key (item_id, rev)
);

create table if not exists werkbank.work_item_file (
  item_id uuid not null,
  rev integer not null,
  path text not null check (path ~ '^[A-Za-z0-9._][A-Za-z0-9._/ -]{0,199}$' and path !~ '\.\.' and path !~ '//' and path !~ '/$'),
  language text not null default '' check (char_length(language) <= 30),
  content text not null check (char_length(content) <= 1000000),
  sha256 text not null,
  primary key (item_id, rev, path),
  foreign key (item_id, rev) references werkbank.work_item_rev(item_id, rev) on delete cascade
);

-- More files for a skill than SKILL.md (scripts, templates, reference documents). One current set per skill.
create table if not exists skills.skill_file (
  slug text not null references skills.skill(slug) on delete cascade,
  path text not null check (path ~ '^[A-Za-z0-9._][A-Za-z0-9._/ -]{0,199}$' and path !~ '\.\.' and path !~ '//' and path !~ '/$' and path <> 'SKILL.md'),
  language text not null default '' check (char_length(language) <= 30),
  content text not null check (char_length(content) <= 500000),
  sha256 text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (slug, path)
);

alter table werkbank.work_item enable row level security;
alter table werkbank.work_item_rev enable row level security;
alter table werkbank.work_item_file enable row level security;
alter table skills.skill_file enable row level security;
revoke all on werkbank.work_item, werkbank.work_item_rev, werkbank.work_item_file, skills.skill_file from anon, authenticated;

-- ---------- helpers (not callable from the outside) ----------
create or replace function werkbank.work_can_read(p_id uuid, p_actor text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from werkbank.work_item w where w.id = p_id and (
       lower(w.owner) = lower(p_actor)
    or w.visibility = 'company'
    or (w.visibility = 'team' and exists (select 1 from werkbank.group_members m where m.group_id = w.team_id and lower(m.email) = lower(p_actor)))
    or skills.is_board_admin(p_actor)));
$$;

create or replace function werkbank.work_can_write(p_id uuid, p_actor text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from werkbank.work_item w where w.id = p_id and (
       lower(w.owner) = lower(p_actor)
    or (w.visibility = 'team' and exists (select 1 from werkbank.group_members m where m.group_id = w.team_id and lower(m.email) = lower(p_actor) and m.role = 'admin'))
    or skills.is_board_admin(p_actor)));
$$;

-- Same credential patterns as the skill checks (migration 019): shared code must not carry keys or passwords.
create or replace function werkbank.find_secret(p_text text)
returns text language sql immutable set search_path = '' as $$
  select substring(p_text from '(?i)(sb_secret_|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|(?:api[_-]?key|secret|password|passwort|token)\s*[:=]\s*[''"]?[A-Za-z0-9_./+-]{8,})');
$$;

-- p_files: [{path, language, content}] -> checked rows; raises a readable rule on the first problem.
create or replace function werkbank.check_files(p_files jsonb, p_max integer, p_chars integer)
returns void language plpgsql immutable set search_path = '' as $$
declare f jsonb; path text; content text;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'files must be a non-empty list of {path, content}';
  end if;
  if jsonb_array_length(p_files) > p_max then raise exception 'at most % files per save', p_max; end if;
  if (select count(distinct f2->>'path') from jsonb_array_elements(p_files) f2) <> jsonb_array_length(p_files) then
    raise exception 'a path appears twice in the list';
  end if;
  for f in select * from jsonb_array_elements(p_files) loop
    path := f->>'path'; content := f->>'content';
    if path is null or path !~ '^[A-Za-z0-9._][A-Za-z0-9._/ -]{0,199}$' or path ~ '\.\.' or path ~ '//' or path ~ '/$' then
      raise exception 'invalid file path: %', coalesce(left(path, 60), '(missing)');
    end if;
    if content is null then raise exception 'file % has no content', path; end if;
    if char_length(content) > p_chars then raise exception 'file % is larger than % characters', path, p_chars; end if;
    if werkbank.find_secret(content) is not null then
      raise exception 'file % looks like it contains a credential (key, token or password). Remove it and use a setting instead', path;
    end if;
  end loop;
end $$;

-- ---------- work items ----------
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

create or replace function public.work_get(p_actor text, p_id uuid, p_rev integer default null, p_with_content boolean default true)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare w werkbank.work_item; v_rev integer;
begin
  if not werkbank.work_can_read(p_id, p_actor) then raise exception 'This item does not exist or is not visible to you'; end if;
  select * into w from werkbank.work_item where id = p_id;
  v_rev := coalesce(p_rev, w.current_rev);
  if not exists (select 1 from werkbank.work_item_rev r where r.item_id = p_id and r.rev = v_rev) then
    raise exception 'Revision % does not exist', v_rev;
  end if;
  return jsonb_build_object(
    'id', w.id, 'kind', w.kind, 'name', w.name, 'owner', w.owner, 'visibility', w.visibility, 'team_id', w.team_id,
    'stage', w.stage, 'intent', w.intent, 'approved', to_jsonb(w.approved), 'archived', w.archived,
    'current_rev', w.current_rev, 'rev', v_rev, 'updated_at', w.updated_at,
    'can_write', werkbank.work_can_write(p_id, p_actor),
    'files', coalesce((select jsonb_agg(
        jsonb_build_object('path', f.path, 'language', f.language, 'sha256', f.sha256, 'chars', char_length(f.content))
        || case when p_with_content then jsonb_build_object('content', f.content) else '{}'::jsonb end
        order by f.path) from werkbank.work_item_file f where f.item_id = p_id and f.rev = v_rev), '[]'::jsonb));
end $$;

create or replace function public.work_list(p_actor text, p_kind text default null, p_include_archived boolean default false)
returns jsonb language sql security definer stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'kind', w.kind, 'name', w.name, 'owner', w.owner, 'visibility', w.visibility, 'stage', w.stage,
      'archived', w.archived, 'current_rev', w.current_rev, 'updated_at', w.updated_at,
      'files', (select count(*) from werkbank.work_item_file f where f.item_id = w.id and f.rev = w.current_rev))
    order by w.updated_at desc), '[]'::jsonb)
  from werkbank.work_item w
  where werkbank.work_can_read(w.id, p_actor) and (p_kind is null or w.kind = p_kind) and (p_include_archived or not w.archived);
$$;

create or replace function public.work_history(p_actor text, p_id uuid)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
begin
  if not werkbank.work_can_read(p_id, p_actor) then raise exception 'This item does not exist or is not visible to you'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('rev', r.rev, 'author', r.author, 'note', r.note, 'created_at', r.created_at,
      'files', (select count(*) from werkbank.work_item_file f where f.item_id = r.item_id and f.rev = r.rev)) order by r.rev desc)
    from werkbank.work_item_rev r where r.item_id = p_id), '[]'::jsonb);
end $$;

create or replace function public.work_archive(p_actor text, p_id uuid, p_archived boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not werkbank.work_can_read(p_id, p_actor) then raise exception 'This item does not exist or is not visible to you'; end if;
  if not werkbank.work_can_write(p_id, p_actor) then raise exception 'Only the owner, a team admin or the Governance board may archive this item'; end if;
  update werkbank.work_item set archived = p_archived, updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'archived', p_archived);
end $$;

-- ---------- skill files ----------
create or replace function public.skills_file_set(p_actor text, p_slug text, p_path text, p_language text, p_content text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from skills.skill where slug = p_slug) then raise exception 'Skill % does not exist', p_slug; end if;
  if not skills.may_manage(p_slug, p_actor) then raise exception 'Only the owner, a department admin or the Governance board may change the files of this skill'; end if;
  perform werkbank.check_files(jsonb_build_array(jsonb_build_object('path', p_path, 'content', p_content)), 1, 500000);
  if p_path = 'SKILL.md' then raise exception 'SKILL.md is the skill text itself; publish it with the skill'; end if;
  insert into skills.skill_file (slug, path, language, content, sha256, updated_by)
  values (p_slug, p_path, coalesce(left(p_language, 30), ''), p_content, encode(sha256(convert_to(p_content, 'UTF8')), 'hex'), lower(p_actor))
  on conflict (slug, path) do update set language = excluded.language, content = excluded.content,
    sha256 = excluded.sha256, updated_by = excluded.updated_by, updated_at = now();
  update skills.skill set updated_at = now() where slug = p_slug;
  return jsonb_build_object('slug', p_slug, 'path', p_path, 'chars', char_length(p_content));
end $$;

create or replace function public.skills_file_delete(p_actor text, p_slug text, p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not skills.may_manage(p_slug, p_actor) then raise exception 'Only the owner, a department admin or the Governance board may change the files of this skill'; end if;
  delete from skills.skill_file where slug = p_slug and path = p_path;
  if not found then raise exception 'The skill has no file %', p_path; end if;
  update skills.skill set updated_at = now() where slug = p_slug;
  return jsonb_build_object('slug', p_slug, 'path', p_path, 'deleted', true);
end $$;

-- Without p_path: the list of files (no content). With p_path: that one file with its content.
create or replace function public.skills_files(p_actor text, p_slug text, p_path text default null)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
begin
  if not skills.can_see(p_slug, p_actor) then raise exception 'Skill % does not exist or is not visible to you', p_slug; end if;
  if p_path is not null then
    return (select jsonb_build_object('slug', f.slug, 'path', f.path, 'language', f.language, 'sha256', f.sha256,
        'updated_by', f.updated_by, 'updated_at', f.updated_at, 'content', f.content)
      from skills.skill_file f where f.slug = p_slug and f.path = p_path);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'language', f.language, 'sha256', f.sha256,
      'chars', char_length(f.content), 'updated_by', f.updated_by, 'updated_at', f.updated_at) order by f.path)
    from skills.skill_file f where f.slug = p_slug), '[]'::jsonb);
end $$;

-- ---------- grants ----------
revoke all on function werkbank.work_can_read(uuid, text), werkbank.work_can_write(uuid, text), werkbank.find_secret(text),
  werkbank.check_files(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.work_save(text, uuid, text, text, text, uuid, text, jsonb, text[], jsonb, text, integer),
  public.work_get(text, uuid, integer, boolean), public.work_list(text, text, boolean), public.work_history(text, uuid),
  public.work_archive(text, uuid, boolean), public.skills_file_set(text, text, text, text, text),
  public.skills_file_delete(text, text, text), public.skills_files(text, text, text) from public, anon, authenticated;
grant execute on function public.work_save(text, uuid, text, text, text, uuid, text, jsonb, text[], jsonb, text, integer),
  public.work_get(text, uuid, integer, boolean), public.work_list(text, text, boolean), public.work_history(text, uuid),
  public.work_archive(text, uuid, boolean), public.skills_file_set(text, text, text, text, text),
  public.skills_file_delete(text, text, text), public.skills_files(text, text, text) to service_role;
