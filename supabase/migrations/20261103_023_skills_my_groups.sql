-- 023: which departments a person belongs to, for the department choice when a skill is published one level up.
-- Read only, service_role only (same pattern as the other skills_* functions). Identity is the e-mail until a real sign-in exists.
create or replace function public.skills_my_groups(p_actor text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'role', m.role) order by g.name), '[]'::jsonb)
  from werkbank.group_members m
  join werkbank.groups g on g.id = m.group_id
  where lower(m.email) = lower(p_actor) and g.name <> 'Governance board';
$$;

revoke all on function public.skills_my_groups(text) from public, anon, authenticated;
grant execute on function public.skills_my_groups(text) to service_role;
