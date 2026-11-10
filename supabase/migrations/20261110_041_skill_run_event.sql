-- Usage event 'run': a skill was actually called in a conversation (until now only install, view and search_hit were counted).
-- skills_track accepts it (one count per device and skill per minute); skills_health_overview reports runs30/runs90 next to the
-- mixed uses30/uses90. Only published skills are counted (unchanged rule of skills_track). Same rights as before (service_role only).
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'skills.event'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%search_hit%';
  if c is not null then execute format('alter table skills.event drop constraint %I', c); end if;
end $$;
alter table skills.event add constraint event_kind_check check (event in ('install','view','search_hit','run'));

create or replace function public.skills_track(p_slugs text[], p_event text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if p_event not in ('install','view','search_hit','run') then raise exception 'invalid event'; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then raise exception 'invalid device'; end if;
  insert into skills.event (slug, event, device)
  select s.slug, p_event, p_device
  from skills.skill s
  where s.slug = any (p_slugs[1:25]) and s.status = 'published'
    and not exists (
      select 1 from skills.event e
      where e.slug = s.slug and e.event = p_event and e.device = p_device
        and e.at > now() - (case p_event when 'install' then interval '1 day' when 'run' then interval '1 minute' else interval '10 minutes' end));
  get diagnostics n = row_count;
  return jsonb_build_object('recorded', n);
end;
$$;
revoke all on function public.skills_track(text[], text, text) from public, anon, authenticated;
grant execute on function public.skills_track(text[], text, text) to service_role;

create or replace function public.skills_health_overview(p_actor text, p_limit integer default 1000)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with seen as (
    select s.slug, s.description, s.owner, s.meta, s.current_version, s.sunset_at, s.replaced_by, s.updated_at,
           skills.lifecycle_state(s.slug) as state, skills.scope_of(s.slug) as scope
    from skills.skill s where skills.can_see(s.slug, p_actor)
  ), use30 as (
    select e.slug, count(*) as uses, count(*) filter (where e.event = 'run') as runs, count(distinct e.device) as devices, max(e.at) as last_at
    from skills.event e where e.at >= now() - interval '30 days' group by e.slug
  ), use90 as (
    select e.slug, count(*) as uses, count(*) filter (where e.event = 'run') as runs, count(distinct e.device) as devices, max(e.at) as last_at
    from skills.event e where e.at >= now() - interval '90 days' group by e.slug
  ), lastuse as (
    select e.slug, max(e.at) as last_at from skills.event e group by e.slug
  ), born as (
    select v.slug, min(v.created_at) as created_at from skills.version v group by v.slug
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'total', (select count(*) from seen),
    'skills', (select coalesce(jsonb_agg(jsonb_build_object(
        'slug', x.slug, 'description', x.description, 'owner', x.owner, 'version', x.current_version,
        'state', x.state, 'scope', x.scope,
        'team', coalesce(x.meta->>'team', ''), 'domain', coalesce(x.meta->>'domain', ''), 'boardArea', coalesce(x.meta->>'board_area', ''),
        'sunsetAt', x.sunset_at, 'replacedBy', x.replaced_by, 'updatedAt', x.updated_at, 'createdAt', b.created_at,
        'uses30', coalesce(u30.uses, 0), 'uses90', coalesce(u90.uses, 0),
        'runs30', coalesce(u30.runs, 0), 'runs90', coalesce(u90.runs, 0),
        'devices30', coalesce(u30.devices, 0), 'devices90', coalesce(u90.devices, 0),
        'lastUsedAt', l.last_at) order by x.slug), '[]'::jsonb)
      from (select * from seen order by slug limit least(greatest(coalesce(p_limit, 1000), 1), 2000)) x
      left join use30 u30 on u30.slug = x.slug left join use90 u90 on u90.slug = x.slug
      left join lastuse l on l.slug = x.slug left join born b on b.slug = x.slug));
$$;

revoke all on function public.skills_health_overview(text, integer) from public, anon, authenticated;
grant execute on function public.skills_health_overview(text, integer) to service_role;
