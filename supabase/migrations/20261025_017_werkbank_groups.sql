-- Werkbank groups: a shared area with members and roles, shared Spaces, shared configuration and team memory.
-- Safe to run more than once. Same pattern as werkbank.preferences (016): the tables are closed to anon and
-- authenticated; only the public.werkbank_group_* functions are callable, and only with the server-side secret key
-- (service_role) through the AI Control Tower connector.
-- Identity in this prototype is the e-mail address the app sends as p_actor. The functions check the ROLE of that
-- address on the server, but they do not prove who is calling. For production, map the sign-in (SSO / Supabase Auth)
-- to p_actor and keep these functions unchanged.
-- Roles: admin (everything), member (publish Spaces, add memory), viewer (read only).
create schema if not exists werkbank;
revoke all on schema werkbank from anon, authenticated;

create table if not exists werkbank.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 65536),
  created_by text not null,
  created_at timestamptz not null default now(),
  rev integer not null default 1
);
create table if not exists werkbank.group_members (
  group_id uuid not null references werkbank.groups(id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 120),
  name text not null default '' check (char_length(name) <= 80),
  role text not null check (role in ('admin', 'member', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (group_id, email)
);
create table if not exists werkbank.group_spaces (
  group_id uuid not null references werkbank.groups(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  title text not null check (char_length(title) between 1 and 80),
  package text not null check (octet_length(package) <= 5242880),
  version integer not null default 1,
  published_by text not null,
  published_at timestamptz not null default now(),
  primary key (group_id, slug)
);
create table if not exists werkbank.group_memory (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references werkbank.groups(id) on delete cascade,
  kind text not null default 'fact' check (kind in ('fact', 'decision', 'rule')),
  text text not null check (char_length(text) between 1 and 600),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists werkbank.group_audit (
  id bigserial primary key,
  group_id uuid not null references werkbank.groups(id) on delete cascade,
  actor text not null,
  action text not null,
  detail text not null default '',
  at timestamptz not null default now()
);
create index if not exists group_members_email on werkbank.group_members (email);
create index if not exists group_audit_group on werkbank.group_audit (group_id, id desc);
create index if not exists group_memory_group on werkbank.group_memory (group_id, created_at desc);

alter table werkbank.groups enable row level security;
alter table werkbank.group_members enable row level security;
alter table werkbank.group_spaces enable row level security;
alter table werkbank.group_memory enable row level security;
alter table werkbank.group_audit enable row level security;
revoke all on werkbank.groups, werkbank.group_members, werkbank.group_spaces, werkbank.group_memory, werkbank.group_audit from anon, authenticated;
revoke all on sequence werkbank.group_audit_id_seq from anon, authenticated;

-- helpers (not callable from outside)
create or replace function werkbank.g_ts(t timestamptz) returns text language sql immutable set search_path = ''
as $$ select to_char(t at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

create or replace function werkbank.g_role(p_group uuid, p_actor text) returns text language sql stable set search_path = ''
as $$ select role from werkbank.group_members where group_id = p_group and email = lower(trim(p_actor)) $$;

create or replace function werkbank.g_err(p_code text, p_message text) returns jsonb language sql immutable set search_path = ''
as $$ select jsonb_build_object('ok', false, 'error', p_code, 'message', p_message) $$;

create or replace function werkbank.g_touch(p_group uuid, p_actor text, p_action text, p_detail text default '') returns void
language plpgsql set search_path = ''
as $$
begin
  update werkbank.groups set rev = rev + 1 where id = p_group;
  insert into werkbank.group_audit (group_id, actor, action, detail) values (p_group, lower(trim(p_actor)), p_action, left(p_detail, 200));
end;
$$;

-- create a group; the creator becomes its first admin
create or replace function public.werkbank_group_create(p_actor text, p_name text, p_description text default '', p_actor_name text default '')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare g werkbank.groups; a text := lower(trim(p_actor));
begin
  if a !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return werkbank.g_err('bad_email', 'A valid e-mail address is needed as identity.'); end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 60 then return werkbank.g_err('bad_name', 'The group name needs 1 to 60 characters.'); end if;
  insert into werkbank.groups (name, description, created_by) values (trim(p_name), left(coalesce(p_description, ''), 300), a) returning * into g;
  insert into werkbank.group_members (group_id, email, name, role) values (g.id, a, left(coalesce(p_actor_name, ''), 80), 'admin');
  perform werkbank.g_touch(g.id, a, 'group_created', g.name);
  return jsonb_build_object('ok', true, 'id', g.id, 'name', g.name, 'rev', g.rev + 1);
end;
$$;

-- the groups of one person, with role and revision (cheap enough to poll)
create or replace function public.werkbank_group_list(p_actor text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'groups', coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'name', g.name, 'description', g.description, 'role', m.role, 'rev', g.rev,
    'members', (select count(*) from werkbank.group_members x where x.group_id = g.id),
    'spaces', (select count(*) from werkbank.group_spaces s where s.group_id = g.id),
    'memory', (select count(*) from werkbank.group_memory y where y.group_id = g.id)
  ) order by g.name), '[]'::jsonb))
  from werkbank.group_members m join werkbank.groups g on g.id = m.group_id
  where m.email = lower(trim(p_actor));
$$;

-- everything of one group (members only); Space packages are NOT included, they are fetched one by one
create or replace function public.werkbank_group_get(p_actor text, p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare g werkbank.groups; r text := werkbank.g_role(p_group, p_actor);
begin
  if r is null then return werkbank.g_err('not_member', 'You are not a member of this group.'); end if;
  select * into g from werkbank.groups where id = p_group;
  return jsonb_build_object('ok', true, 'role', r,
    'group', jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'rev', g.rev, 'createdBy', g.created_by, 'createdAt', werkbank.g_ts(g.created_at)),
    'config', g.config,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('email', m.email, 'name', m.name, 'role', m.role) order by m.role, m.email), '[]'::jsonb) from werkbank.group_members m where m.group_id = g.id),
    'spaces', (select coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'title', s.title, 'version', s.version, 'publishedBy', s.published_by, 'publishedAt', werkbank.g_ts(s.published_at), 'bytes', octet_length(s.package)) order by s.title), '[]'::jsonb) from werkbank.group_spaces s where s.group_id = g.id),
    'memory', (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'kind', y.kind, 'text', y.text, 'createdBy', y.created_by, 'createdAt', werkbank.g_ts(y.created_at)) order by y.created_at desc), '[]'::jsonb) from werkbank.group_memory y where y.group_id = g.id),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('actor', a.actor, 'action', a.action, 'detail', a.detail, 'at', werkbank.g_ts(a.at)) order by a.id desc), '[]'::jsonb) from (select * from werkbank.group_audit where group_id = g.id order by id desc limit 15) a));
end;
$$;

-- add a member or change a role (admin only); the last admin cannot be demoted
create or replace function public.werkbank_group_set_member(p_actor text, p_group uuid, p_email text, p_role text, p_name text default '')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare e text := lower(trim(p_email)); old text;
begin
  if werkbank.g_role(p_group, p_actor) is distinct from 'admin' then return werkbank.g_err('forbidden', 'Only an admin can change members.'); end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return werkbank.g_err('bad_email', 'That e-mail address looks wrong.'); end if;
  if p_role not in ('admin', 'member', 'viewer') then return werkbank.g_err('bad_role', 'Role must be admin, member or viewer.'); end if;
  old := werkbank.g_role(p_group, e);
  if old = 'admin' and p_role <> 'admin' and (select count(*) from werkbank.group_members where group_id = p_group and role = 'admin') <= 1
    then return werkbank.g_err('last_admin', 'A group needs at least one admin.'); end if;
  insert into werkbank.group_members (group_id, email, name, role) values (p_group, e, left(coalesce(p_name, ''), 80), p_role)
  on conflict (group_id, email) do update set role = excluded.role, name = case when excluded.name <> '' then excluded.name else werkbank.group_members.name end;
  perform werkbank.g_touch(p_group, p_actor, case when old is null then 'member_added' else 'role_changed' end, e || ' → ' || p_role);
  return jsonb_build_object('ok', true, 'email', e, 'role', p_role);
end;
$$;

-- remove a member (admin) or leave (yourself); the last admin cannot leave
create or replace function public.werkbank_group_remove_member(p_actor text, p_group uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare e text := lower(trim(p_email)); a text := lower(trim(p_actor)); r text := werkbank.g_role(p_group, p_actor);
begin
  if r is null then return werkbank.g_err('not_member', 'You are not a member of this group.'); end if;
  if e <> a and r <> 'admin' then return werkbank.g_err('forbidden', 'Only an admin can remove other members.'); end if;
  if werkbank.g_role(p_group, e) is null then return werkbank.g_err('not_found', 'That person is not a member.'); end if;
  if werkbank.g_role(p_group, e) = 'admin' and (select count(*) from werkbank.group_members where group_id = p_group and role = 'admin') <= 1
    then return werkbank.g_err('last_admin', 'The last admin cannot leave. Make someone else admin first, or delete the group.'); end if;
  delete from werkbank.group_members where group_id = p_group and email = e;
  perform werkbank.g_touch(p_group, a, case when e = a then 'member_left' else 'member_removed' end, e);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.werkbank_group_delete(p_actor text, p_group uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if werkbank.g_role(p_group, p_actor) is distinct from 'admin' then return werkbank.g_err('forbidden', 'Only an admin can delete the group.'); end if;
  delete from werkbank.groups where id = p_group;
  return jsonb_build_object('ok', true);
end;
$$;

-- shared Spaces: admin and member publish (a new version replaces the old one); everybody in the group reads
create or replace function public.werkbank_group_publish_space(p_actor text, p_group uuid, p_slug text, p_title text, p_package text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r text := werkbank.g_role(p_group, p_actor); v integer;
begin
  if r is null then return werkbank.g_err('not_member', 'You are not a member of this group.'); end if;
  if r = 'viewer' then return werkbank.g_err('forbidden', 'Viewers cannot publish Spaces.'); end if;
  if p_slug !~ '^[a-z0-9][a-z0-9._-]{0,59}$' then return werkbank.g_err('bad_slug', 'The Space name is not valid.'); end if;
  if char_length(coalesce(p_title, '')) not between 1 and 80 then return werkbank.g_err('bad_title', 'The Space title needs 1 to 80 characters.'); end if;
  if octet_length(coalesce(p_package, '')) > 5242880 then return werkbank.g_err('too_big', 'The Space is larger than 5 MB.'); end if;
  insert into werkbank.group_spaces (group_id, slug, title, package, published_by) values (p_group, p_slug, p_title, p_package, lower(trim(p_actor)))
  on conflict (group_id, slug) do update set title = excluded.title, package = excluded.package, version = werkbank.group_spaces.version + 1, published_by = excluded.published_by, published_at = now()
  returning version into v;
  perform werkbank.g_touch(p_group, p_actor, 'space_published', p_title || ' v' || v);
  return jsonb_build_object('ok', true, 'slug', p_slug, 'version', v);
end;
$$;

create or replace function public.werkbank_group_get_space(p_actor text, p_group uuid, p_slug text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s werkbank.group_spaces;
begin
  if werkbank.g_role(p_group, p_actor) is null then return werkbank.g_err('not_member', 'You are not a member of this group.'); end if;
  select * into s from werkbank.group_spaces where group_id = p_group and slug = p_slug;
  if not found then return werkbank.g_err('not_found', 'This Space is not in the group.'); end if;
  return jsonb_build_object('ok', true, 'slug', s.slug, 'title', s.title, 'version', s.version, 'package', s.package);
end;
$$;

create or replace function public.werkbank_group_remove_space(p_actor text, p_group uuid, p_slug text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare t text;
begin
  if werkbank.g_role(p_group, p_actor) is distinct from 'admin' then return werkbank.g_err('forbidden', 'Only an admin can remove a shared Space.'); end if;
  delete from werkbank.group_spaces where group_id = p_group and slug = p_slug returning title into t;
  if t is null then return werkbank.g_err('not_found', 'This Space is not in the group.'); end if;
  perform werkbank.g_touch(p_group, p_actor, 'space_removed', t);
  return jsonb_build_object('ok', true);
end;
$$;

-- shared configuration (connector names, rules, instructions; never secrets): admin only
create or replace function public.werkbank_group_save_config(p_actor text, p_group uuid, p_config jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if werkbank.g_role(p_group, p_actor) is distinct from 'admin' then return werkbank.g_err('forbidden', 'Only an admin can change the group configuration.'); end if;
  if jsonb_typeof(p_config) <> 'object' or octet_length(p_config::text) > 65536 then return werkbank.g_err('bad_config', 'The configuration must be an object of at most 64 KB.'); end if;
  update werkbank.groups set config = p_config where id = p_group;
  perform werkbank.g_touch(p_group, p_actor, 'config_saved', '');
  return jsonb_build_object('ok', true);
end;
$$;

-- team memory: admin and member add; the author or an admin edits and deletes
create or replace function public.werkbank_group_memory_add(p_actor text, p_group uuid, p_kind text, p_text text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r text := werkbank.g_role(p_group, p_actor); id_ uuid;
begin
  if r is null then return werkbank.g_err('not_member', 'You are not a member of this group.'); end if;
  if r = 'viewer' then return werkbank.g_err('forbidden', 'Viewers cannot add to the team memory.'); end if;
  if p_kind not in ('fact', 'decision', 'rule') then return werkbank.g_err('bad_kind', 'Kind must be fact, decision or rule.'); end if;
  if char_length(trim(coalesce(p_text, ''))) not between 1 and 600 then return werkbank.g_err('bad_text', 'A memory entry needs 1 to 600 characters.'); end if;
  insert into werkbank.group_memory (group_id, kind, text, created_by) values (p_group, p_kind, trim(p_text), lower(trim(p_actor))) returning id into id_;
  perform werkbank.g_touch(p_group, p_actor, 'memory_added', p_text);
  return jsonb_build_object('ok', true, 'id', id_);
end;
$$;

create or replace function public.werkbank_group_memory_update(p_actor text, p_group uuid, p_id uuid, p_kind text, p_text text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r text := werkbank.g_role(p_group, p_actor); owner_ text;
begin
  if r is null then return werkbank.g_err('not_member', 'You are not a member of this group.'); end if;
  select created_by into owner_ from werkbank.group_memory where id = p_id and group_id = p_group;
  if owner_ is null then return werkbank.g_err('not_found', 'That memory entry does not exist.'); end if;
  if r <> 'admin' and owner_ <> lower(trim(p_actor)) then return werkbank.g_err('forbidden', 'Only the author or an admin can change this entry.'); end if;
  if p_kind not in ('fact', 'decision', 'rule') then return werkbank.g_err('bad_kind', 'Kind must be fact, decision or rule.'); end if;
  if char_length(trim(coalesce(p_text, ''))) not between 1 and 600 then return werkbank.g_err('bad_text', 'A memory entry needs 1 to 600 characters.'); end if;
  update werkbank.group_memory set kind = p_kind, text = trim(p_text), updated_at = now() where id = p_id;
  perform werkbank.g_touch(p_group, p_actor, 'memory_changed', p_text);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.werkbank_group_memory_delete(p_actor text, p_group uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r text := werkbank.g_role(p_group, p_actor); owner_ text;
begin
  if r is null then return werkbank.g_err('not_member', 'You are not a member of this group.'); end if;
  select created_by into owner_ from werkbank.group_memory where id = p_id and group_id = p_group;
  if owner_ is null then return werkbank.g_err('not_found', 'That memory entry does not exist.'); end if;
  if r <> 'admin' and owner_ <> lower(trim(p_actor)) then return werkbank.g_err('forbidden', 'Only the author or an admin can delete this entry.'); end if;
  delete from werkbank.group_memory where id = p_id;
  perform werkbank.g_touch(p_group, p_actor, 'memory_deleted', '');
  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'werkbank\_group\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
