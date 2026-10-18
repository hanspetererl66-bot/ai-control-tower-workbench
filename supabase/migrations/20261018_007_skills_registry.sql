-- Shared skills registry: SKILL.md files kept in Supabase so colleagues can sync them into their Goose agent.
-- Tables are not reachable through the API. Reading goes through two functions that only ever return
-- APPROVED skills (callable with the publishable key). Writing goes through three functions that only
-- the server-side secret key (service_role) may call.
create schema if not exists skills;
revoke all on schema skills from anon, authenticated;

create table if not exists skills.skill (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  description text not null check (char_length(description) between 1 and 240),
  owner text not null default '' check (char_length(owner) <= 80),
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  current_version integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists skills.version (
  slug text not null references skills.skill(slug) on delete cascade,
  version integer not null check (version >= 1),
  body text not null check (char_length(body) between 1 and 20000),
  sha256 text not null,
  created_at timestamptz not null default now(),
  primary key (slug, version)
);

alter table skills.skill enable row level security;
alter table skills.version enable row level security;
revoke all on skills.skill, skills.version from anon, authenticated;

-- ---------- read (approved only) ----------
create or replace function public.skills_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', s.slug, 'description', s.description, 'owner', s.owner,
    'version', v.version, 'sha256', v.sha256) order by s.slug), '[]'::jsonb)
  from skills.skill s
  join skills.version v on v.slug = s.slug and v.version = s.current_version
  where s.status = 'approved';
$$;

create or replace function public.skills_get(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('slug', s.slug, 'description', s.description, 'owner', s.owner,
    'version', v.version, 'sha256', v.sha256, 'body', v.body)
  from skills.skill s
  join skills.version v on v.slug = s.slug and v.version = s.current_version
  where s.status = 'approved' and s.slug = p_slug;
$$;

-- ---------- write (secret key only) ----------
-- Creates a new version; identical content creates nothing. A new or changed skill always goes back to 'draft'.
create or replace function public.skills_publish(p_slug text, p_description text, p_owner text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h text := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');
  cur skills.skill;
  v integer;
begin
  select * into cur from skills.skill where slug = p_slug;
  if found then
    if exists (select 1 from skills.version where slug = p_slug and version = cur.current_version and sha256 = h)
       and cur.description = btrim(p_description) then
      return jsonb_build_object('slug', p_slug, 'version', cur.current_version, 'status', cur.status, 'changed', false);
    end if;
    v := cur.current_version + 1;
    insert into skills.version (slug, version, body, sha256) values (p_slug, v, p_body, h);
    update skills.skill set description = btrim(p_description), owner = coalesce(p_owner, ''),
      current_version = v, status = 'draft', updated_at = now() where slug = p_slug;
  else
    v := 1;
    insert into skills.skill (slug, description, owner, status, current_version)
      values (p_slug, btrim(p_description), coalesce(p_owner, ''), 'draft', 0);
    insert into skills.version (slug, version, body, sha256) values (p_slug, v, p_body, h);
    update skills.skill set current_version = v where slug = p_slug;
  end if;
  return jsonb_build_object('slug', p_slug, 'version', v, 'status', 'draft', 'changed', true);
end;
$$;

create or replace function public.skills_set_status(p_slug text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('draft','approved','retired') then
    raise exception 'invalid status';
  end if;
  update skills.skill set status = p_status, updated_at = now() where slug = p_slug;
  if not found then
    raise exception 'unknown skill';
  end if;
  return jsonb_build_object('slug', p_slug, 'status', p_status);
end;
$$;

create or replace function public.skills_admin_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', s.slug, 'status', s.status, 'version', s.current_version, 'owner', s.owner,
    'updated_at', s.updated_at) order by s.slug), '[]'::jsonb)
  from skills.skill s;
$$;

revoke all on function public.skills_list(), public.skills_get(text), public.skills_publish(text,text,text,text),
  public.skills_set_status(text,text), public.skills_admin_list() from public, anon, authenticated;
grant execute on function public.skills_list(), public.skills_get(text) to anon, authenticated, service_role;
grant execute on function public.skills_publish(text,text,text,text), public.skills_set_status(text,text),
  public.skills_admin_list() to service_role;
