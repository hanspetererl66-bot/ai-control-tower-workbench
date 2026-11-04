-- Skill Health: one read for the manager dashboard (usage, owner, department, lifecycle) of every skill the actor may see.
-- Usage comes from skills.event (install, view, search_hit per anonymous device hash), so "users" are distinct devices.
-- Only service_role may call it (connector pattern, see migration 022). Changes go through skills_lifecycle_change (020).
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
    select e.slug, count(*) as uses, count(distinct e.device) as devices, max(e.at) as last_at
    from skills.event e where e.at >= now() - interval '30 days' group by e.slug
  ), use90 as (
    select e.slug, count(*) as uses, count(distinct e.device) as devices, max(e.at) as last_at
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
        'devices30', coalesce(u30.devices, 0), 'devices90', coalesce(u90.devices, 0),
        'lastUsedAt', l.last_at) order by x.slug), '[]'::jsonb)
      from (select * from seen order by slug limit least(greatest(coalesce(p_limit, 1000), 1), 2000)) x
      left join use30 u30 on u30.slug = x.slug left join use90 u90 on u90.slug = x.slug
      left join lastuse l on l.slug = x.slug left join born b on b.slug = x.slug));
$$;

revoke all on function public.skills_health_overview(text, integer) from public, anon, authenticated;
grant execute on function public.skills_health_overview(text, integer) to service_role;
