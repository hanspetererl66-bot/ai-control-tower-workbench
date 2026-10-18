-- Skill marketplace: maturity ladder Pilot -> Empfohlen -> Approved, release status renamed, usage counters and ranking.
--
-- 1. Publication status: draft -> published -> retired. The old value 'approved' becomes 'published', so that
--    "approved" only names the highest maturity level (an official review with a recorded approver).
-- 2. Maturity: pilot, empfohlen, approved. 'approved' is only set through skills_approve, which records who, when and
--    for which version; any new version of a skill falls back to pilot and clears the approval.
-- 3. Usage counters (install, view, search_hit) per anonymous device hash, and skills_ranking over a time window.
--    Counting needs no personal data; one device is counted at most once per slug and event within a short window.
-- Reads stay executable with the publishable key (published skills only). skills_approve stays service_role only.

-- ---------- status and maturity ----------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'skills.skill'::regclass and contype = 'c'
             and (pg_get_constraintdef(oid) like '%status%' or pg_get_constraintdef(oid) like '%maturity%') loop
    execute format('alter table skills.skill drop constraint %I', c.conname);
  end loop;
end $$;

update skills.skill set status = 'published' where status = 'approved';
alter table skills.skill add constraint skill_status_check check (status in ('draft','published','retired'));
alter table skills.skill add constraint skill_maturity_check check (maturity in ('pilot','empfohlen','approved'));
alter table skills.skill add column if not exists approved_by text not null default '';
alter table skills.skill add column if not exists approved_at timestamptz;
alter table skills.skill add column if not exists approved_version integer;

-- ---------- usage counters ----------
create table if not exists skills.event (
  id bigint generated always as identity primary key,
  slug text not null references skills.skill(slug) on delete cascade,
  event text not null check (event in ('install','view','search_hit')),
  device text not null check (char_length(device) between 8 and 64),
  at timestamptz not null default now()
);
create index if not exists skill_event_slug_at on skills.event (slug, at desc);
alter table skills.event enable row level security;
revoke all on skills.event from anon, authenticated;

-- ---------- reads (published only) ----------
create or replace function public.skills_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', s.slug, 'description', s.description, 'owner', s.owner, 'maturity', s.maturity,
    'meta', s.meta, 'approvedBy', s.approved_by, 'approvedAt', s.approved_at, 'approvedVersion', s.approved_version, 'version', v.version, 'sha256', v.sha256) order by s.slug), '[]'::jsonb)
  from skills.skill s
  join skills.version v on v.slug = s.slug and v.version = s.current_version
  where s.status = 'published';
$$;

create or replace function public.skills_get(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('slug', s.slug, 'description', s.description, 'owner', s.owner, 'maturity', s.maturity,
    'meta', s.meta, 'approvedBy', s.approved_by, 'approvedAt', s.approved_at, 'approvedVersion', s.approved_version, 'version', v.version, 'sha256', v.sha256, 'body', v.body)
  from skills.skill s
  join skills.version v on v.slug = s.slug and v.version = s.current_version
  where s.status = 'published' and s.slug = p_slug;
$$;

create or replace function public.skills_search(p_query text, p_limit integer default 10)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select lower(btrim(coalesce(p_query, ''))) as raw, skills.or_query(p_query, 3) as tsq
  ), scored as (
    select s.slug, s.description, s.owner, s.maturity, s.meta, v.version,
      ts_rank(skills.doc(s.slug, s.description, s.meta), q.tsq) as rank,
      (select coalesce(jsonb_agg(t), '[]'::jsonb)
         from jsonb_array_elements_text(coalesce(s.meta->'tools', '[]'::jsonb)) t
        where position(t in q.raw) > 0 or position(replace(t, '_', ' ') in q.raw) > 0) as hit_tools
    from skills.skill s
    join skills.version v on v.slug = s.slug and v.version = s.current_version
    cross join q
    where s.status = 'published'
  ), ranked as (
    select *, rank + 0.3 * jsonb_array_length(hit_tools) as score
    from scored where rank > 0 or jsonb_array_length(hit_tools) > 0
    order by score desc, slug
    limit least(greatest(coalesce(p_limit, 10), 1), 25)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', slug, 'description', description, 'owner', owner, 'maturity', maturity, 'version', version,
    'domain', meta->>'domain', 'process', meta->>'process', 'team', meta->>'team', 'contact', meta->>'contact',
    'boardArea', coalesce(meta->>'board_area', ''), 'lob', coalesce(meta->>'lob', ''), 'scope', coalesce(meta->>'scope', 'individual'),
    'dataClass', meta->>'data_class', 'tools', coalesce(meta->'tools', '[]'::jsonb),
    'matchedTools', hit_tools, 'score', round(score::numeric, 3)) order by score desc, slug), '[]'::jsonb)
  from ranked;
$$;

create or replace function public.skills_ranking(p_days integer default 30, p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with w as (select make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365)) as span),
  cur as (
    select e.slug,
      count(*) filter (where e.event = 'install') as installs,
      count(*) filter (where e.event = 'view') as views,
      count(*) filter (where e.event = 'search_hit') as hits,
      count(distinct e.device) as devices
    from skills.event e cross join w where e.at >= now() - w.span group by e.slug
  ), prev as (
    select e.slug, sum(case e.event when 'install' then 3 when 'view' then 1 else 0.5 end) as score
    from skills.event e cross join w
    where e.at < now() - w.span and e.at >= now() - 2 * w.span group by e.slug
  ), r as (
    select s.slug, s.description, s.owner, s.maturity, s.meta, v.version,
      coalesce(c.installs, 0) as installs, coalesce(c.views, 0) as views, coalesce(c.hits, 0) as hits,
      coalesce(c.devices, 0) as devices,
      3 * coalesce(c.installs, 0) + coalesce(c.views, 0) + 0.5 * coalesce(c.hits, 0) as score,
      coalesce(p.score, 0) as prev_score
    from skills.skill s
    join skills.version v on v.slug = s.slug and v.version = s.current_version
    left join cur c on c.slug = s.slug
    left join prev p on p.slug = s.slug
    where s.status = 'published'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', slug, 'description', description, 'owner', owner, 'maturity', maturity, 'version', version,
    'boardArea', coalesce(meta->>'board_area', ''), 'lob', coalesce(meta->>'lob', ''),
    'team', coalesce(meta->>'team', ''), 'scope', coalesce(meta->>'scope', 'individual'),
    'domain', coalesce(meta->>'domain', ''),
    'installs', installs, 'views', views, 'searchHits', hits, 'devices', devices,
    'score', score, 'previousScore', prev_score,
    'trendPct', case when prev_score > 0 then round(((score - prev_score) / prev_score * 100)::numeric, 0) else null end
  ) order by score desc, slug), '[]'::jsonb)
  from (select * from r order by score desc, slug limit least(greatest(coalesce(p_limit, 100), 1), 200)) top;
$$;

-- ---------- counting (publishable key) ----------
create or replace function public.skills_track(p_slugs text[], p_event text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if p_event not in ('install','view','search_hit') then raise exception 'invalid event'; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then raise exception 'invalid device'; end if;
  insert into skills.event (slug, event, device)
  select s.slug, p_event, p_device
  from skills.skill s
  where s.slug = any (p_slugs[1:25]) and s.status = 'published'
    and not exists (
      select 1 from skills.event e
      where e.slug = s.slug and e.event = p_event and e.device = p_device
        and e.at > now() - (case p_event when 'install' then interval '1 day' else interval '10 minutes' end));
  get diagnostics n = row_count;
  return jsonb_build_object('recorded', n);
end;
$$;

-- ---------- writes (secret key only) ----------
create or replace function public.skills_publish(p_slug text, p_description text, p_owner text, p_body text, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h text := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');
  nm jsonb := skills.normalize_meta(coalesce(p_meta, '{}'::jsonb));
  cur skills.skill;
  v integer;
begin
  if nm->>'variant_of' is not null and (nm->>'variant_of' = p_slug
     or not exists (select 1 from skills.skill where slug = nm->>'variant_of')) then
    raise exception 'variant_of must name another existing skill';
  end if;
  select * into cur from skills.skill where slug = p_slug;
  if found then
    if exists (select 1 from skills.version where slug = p_slug and version = cur.current_version and sha256 = h)
       and cur.description = btrim(p_description) and cur.meta = nm then
      return jsonb_build_object('slug', p_slug, 'version', cur.current_version, 'status', cur.status, 'changed', false);
    end if;
    v := cur.current_version + 1;
    insert into skills.version (slug, version, body, sha256, meta) values (p_slug, v, p_body, h, nm);
    update skills.skill set description = btrim(p_description), owner = coalesce(p_owner, ''), meta = nm,
      current_version = v, status = 'draft', maturity = 'pilot',
      approved_by = '', approved_at = null, approved_version = null, updated_at = now() where slug = p_slug;
  else
    v := 1;
    insert into skills.skill (slug, description, owner, status, current_version, meta)
      values (p_slug, btrim(p_description), coalesce(p_owner, ''), 'draft', 0, nm);
    insert into skills.version (slug, version, body, sha256, meta) values (p_slug, v, p_body, h, nm);
    update skills.skill set current_version = v where slug = p_slug;
  end if;
  delete from skills.skill_tool where slug = p_slug;
  insert into skills.skill_tool (slug, tool) select p_slug, t from jsonb_array_elements_text(nm->'tools') t;
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
  if p_status not in ('draft','published','retired') then
    raise exception 'invalid status';
  end if;
  update skills.skill set status = p_status, updated_at = now() where slug = p_slug;
  if not found then
    raise exception 'unknown skill';
  end if;
  return jsonb_build_object('slug', p_slug, 'status', p_status);
end;
$$;

-- pilot <-> empfohlen. 'approved' is only reachable through skills_approve; leaving it clears the approval record.
create or replace function public.skills_set_maturity(p_slug text, p_maturity text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_maturity not in ('pilot','empfohlen') then raise exception 'use skills_approve for approved'; end if;
  update skills.skill set maturity = p_maturity, approved_by = '', approved_at = null, approved_version = null,
    updated_at = now() where slug = p_slug;
  if not found then raise exception 'unknown skill'; end if;
  return jsonb_build_object('slug', p_slug, 'maturity', p_maturity);
end;
$$;

create or replace function public.skills_approve(p_slug text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare cur skills.skill;
begin
  if p_by is null or btrim(p_by) = '' or char_length(p_by) > 80 then raise exception 'approver name required (at most 80 characters)'; end if;
  select * into cur from skills.skill where slug = p_slug;
  if not found then raise exception 'unknown skill'; end if;
  if cur.status <> 'published' then raise exception 'only a published skill can be approved'; end if;
  update skills.skill set maturity = 'approved', approved_by = btrim(p_by), approved_at = now(),
    approved_version = current_version, updated_at = now() where slug = p_slug;
  return jsonb_build_object('slug', p_slug, 'maturity', 'approved', 'approvedBy', btrim(p_by), 'version', cur.current_version);
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
    'slug', s.slug, 'status', s.status, 'maturity', s.maturity, 'version', s.current_version,
    'owner', s.owner, 'approvedBy', s.approved_by, 'approvedAt', s.approved_at, 'approvedVersion', s.approved_version, 'domain', s.meta->>'domain', 'updated_at', s.updated_at) order by s.slug), '[]'::jsonb)
  from skills.skill s;
$$;

revoke all on function public.skills_list(), public.skills_get(text), public.skills_search(text,integer),
  public.skills_ranking(integer,integer), public.skills_track(text[],text,text),
  public.skills_approve(text,text), public.skills_publish(text,text,text,text,jsonb),
  public.skills_set_maturity(text,text), public.skills_set_status(text,text), public.skills_admin_list()
  from public, anon, authenticated;
grant execute on function public.skills_list(), public.skills_get(text), public.skills_search(text,integer),
  public.skills_ranking(integer,integer), public.skills_track(text[],text,text)
  to anon, authenticated, service_role;
grant execute on function public.skills_approve(text,text), public.skills_publish(text,text,text,text,jsonb),
  public.skills_set_maturity(text,text), public.skills_set_status(text,text), public.skills_admin_list()
  to service_role;
