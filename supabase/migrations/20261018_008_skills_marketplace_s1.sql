-- Skills marketplace, stage 1: profile metadata per skill, tool dependencies, full-text search,
-- and a similarity check used before publishing (to avoid building the same skill twice).
-- Reads (list/get/search) return approved skills only and work with the publishable key.
-- Everything that writes or inspects drafts is service_role only.

alter table skills.version add column if not exists meta jsonb not null default '{}'::jsonb;
alter table skills.skill add column if not exists meta jsonb not null default '{}'::jsonb;
alter table skills.skill add column if not exists maturity text not null default 'pilot'
  check (maturity in ('pilot','empfohlen'));

-- Tool dependencies (skill -> connector tool). These rows become the edges of the graph in stage 2.
create table if not exists skills.skill_tool (
  slug text not null references skills.skill(slug) on delete cascade,
  tool text not null check (tool ~ '^[a-z][a-z0-9_]{1,60}$'),
  primary key (slug, tool)
);
alter table skills.skill_tool enable row level security;
revoke all on skills.skill_tool from anon, authenticated;

-- ---------- internal helpers (not reachable through the API) ----------
create or replace function skills.normalize_meta(m jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  dom text := coalesce(nullif(btrim(m->>'domain'), ''), 'Sonstiges');
  dc text := coalesce(nullif(btrim(m->>'data_class'), ''), 'intern');
  lang text := coalesce(nullif(btrim(m->>'language'), ''), 'de');
  proc text := coalesce(btrim(m->>'process'), '');
  team text := coalesce(btrim(m->>'team'), '');
  contact text := coalesce(btrim(m->>'contact'), '');
  vo text := nullif(btrim(m->>'variant_of'), '');
  vr text := coalesce(btrim(m->>'variant_reason'), '');
  tl jsonb;
begin
  if dom not in ('Governance & Risiko','Service & Support','Finanzen','HR','Entwicklung','Betrieb','Sonstiges') then
    raise exception 'invalid domain: %', dom;
  end if;
  if dc not in ('öffentlich','intern','vertraulich') then raise exception 'invalid data_class: %', dc; end if;
  if lang not in ('de','en') then raise exception 'invalid language: %', lang; end if;
  if char_length(proc) > 80 or char_length(team) > 80 or char_length(contact) > 120 or char_length(vr) > 200 then
    raise exception 'metadata field too long';
  end if;
  if vo is not null and vo !~ '^[a-z0-9][a-z0-9-]{1,48}$' then raise exception 'invalid variant_of'; end if;
  select coalesce(jsonb_agg(distinct t order by t), '[]'::jsonb) into tl
    from jsonb_array_elements_text(coalesce(m->'tools', '[]'::jsonb)) t;
  if jsonb_array_length(tl) > 20 then raise exception 'too many tools'; end if;
  if exists (select 1 from jsonb_array_elements_text(tl) t where t !~ '^[a-z][a-z0-9_]{1,60}$') then
    raise exception 'invalid tool name';
  end if;
  return jsonb_build_object('domain', dom, 'process', proc, 'data_class', dc, 'language', lang,
    'team', team, 'contact', contact, 'tools', tl, 'variant_of', vo, 'variant_reason', vr);
end;
$$;

-- "reisekosten prüfen" -> 'reisekost' | 'prüf'  (any word may match; ranking sorts the rest)
create or replace function skills.or_query(p text, minlen int default 3)
returns tsquery
language plpgsql
stable
set search_path = ''
as $$
declare s text;
begin
  select string_agg(w, ' | ') into s from (
    select distinct w from regexp_split_to_table(
      lower(regexp_replace(coalesce(p, ''), '[^[:alnum:]äöüß]+', ' ', 'g')), ' ') w
    where char_length(w) >= minlen limit 40) x;
  if s is null then return ''::tsquery; end if;
  return to_tsquery('german', s);
end;
$$;

create or replace function skills.doc(p_slug text, p_description text, p_meta jsonb)
returns tsvector
language sql
stable
set search_path = ''
as $$
  select setweight(to_tsvector('german', replace(p_slug, '-', ' ')), 'A')
      || setweight(to_tsvector('german', coalesce(p_description, '')), 'B')
      || setweight(to_tsvector('german',
           coalesce(p_meta->>'domain', '') || ' ' || coalesce(p_meta->>'process', '') || ' ' ||
           replace(coalesce((select string_agg(t, ' ') from jsonb_array_elements_text(coalesce(p_meta->'tools', '[]'::jsonb)) t), ''), '_', ' ')), 'C');
$$;

revoke all on function skills.normalize_meta(jsonb), skills.or_query(text,int), skills.doc(text,text,jsonb) from public, anon, authenticated;

-- ---------- reads (approved only) ----------
create or replace function public.skills_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', s.slug, 'description', s.description, 'owner', s.owner, 'maturity', s.maturity,
    'meta', s.meta, 'version', v.version, 'sha256', v.sha256) order by s.slug), '[]'::jsonb)
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
  select jsonb_build_object('slug', s.slug, 'description', s.description, 'owner', s.owner, 'maturity', s.maturity,
    'meta', s.meta, 'version', v.version, 'sha256', v.sha256, 'body', v.body)
  from skills.skill s
  join skills.version v on v.slug = s.slug and v.version = s.current_version
  where s.status = 'approved' and s.slug = p_slug;
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
    where s.status = 'approved'
  ), ranked as (
    select *, rank + 0.3 * jsonb_array_length(hit_tools) as score
    from scored where rank > 0 or jsonb_array_length(hit_tools) > 0
    order by score desc, slug
    limit least(greatest(coalesce(p_limit, 10), 1), 25)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', slug, 'description', description, 'owner', owner, 'maturity', maturity, 'version', version,
    'domain', meta->>'domain', 'process', meta->>'process', 'team', meta->>'team', 'contact', meta->>'contact',
    'dataClass', meta->>'data_class', 'tools', coalesce(meta->'tools', '[]'::jsonb),
    'matchedTools', hit_tools, 'score', round(score::numeric, 3)) order by score desc, slug), '[]'::jsonb)
  from ranked;
$$;

-- ---------- writes and draft inspection (secret key only) ----------
drop function if exists public.skills_publish(text, text, text, text);

-- Any change to body, description or metadata creates a new version that goes back to 'draft'.
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
      current_version = v, status = 'draft', maturity = 'pilot', updated_at = now() where slug = p_slug;
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

-- Candidates that look like the skill about to be published (drafts included, retired excluded).
create or replace function public.skills_similar(p_slug text, p_description text, p_domain text, p_tools text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (select skills.or_query(p_description, 4) as tsq),
  scored as (
    select s.slug, s.description, s.status, s.owner, s.meta,
      ts_rank(skills.doc(s.slug, s.description, s.meta), mine.tsq) as rank,
      (select coalesce(jsonb_agg(t), '[]'::jsonb)
         from jsonb_array_elements_text(coalesce(s.meta->'tools', '[]'::jsonb)) t
        where t = any (coalesce(p_tools, '{}'::text[]))) as shared_tools,
      (s.meta->>'domain' = p_domain) as same_domain
    from skills.skill s cross join mine
    where s.status <> 'retired' and s.slug <> p_slug
  ), ranked as (
    select *, rank + 0.3 * jsonb_array_length(shared_tools) + (case when same_domain then 0.1 else 0 end) as score,
      (jsonb_array_length(shared_tools) >= 2
        or (jsonb_array_length(shared_tools) >= 1 and same_domain)
        or rank >= 0.25) as similar
    from scored
    order by score desc, slug
    limit 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', slug, 'description', description, 'status', status, 'owner', owner,
    'domain', meta->>'domain', 'team', meta->>'team', 'sharedTools', shared_tools,
    'textRank', round(rank::numeric, 3), 'score', round(score::numeric, 3), 'similar', similar)
    order by score desc, slug), '[]'::jsonb)
  from ranked where score > 0;
$$;

create or replace function public.skills_set_maturity(p_slug text, p_maturity text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_maturity not in ('pilot','empfohlen') then raise exception 'invalid maturity'; end if;
  update skills.skill set maturity = p_maturity, updated_at = now() where slug = p_slug;
  if not found then raise exception 'unknown skill'; end if;
  return jsonb_build_object('slug', p_slug, 'maturity', p_maturity);
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
    'owner', s.owner, 'domain', s.meta->>'domain', 'updated_at', s.updated_at) order by s.slug), '[]'::jsonb)
  from skills.skill s;
$$;

revoke all on function public.skills_list(), public.skills_get(text), public.skills_search(text,integer),
  public.skills_publish(text,text,text,text,jsonb), public.skills_similar(text,text,text,text[]),
  public.skills_set_maturity(text,text), public.skills_set_status(text,text), public.skills_admin_list()
  from public, anon, authenticated;
grant execute on function public.skills_list(), public.skills_get(text), public.skills_search(text,integer)
  to anon, authenticated, service_role;
grant execute on function public.skills_publish(text,text,text,text,jsonb), public.skills_similar(text,text,text,text[]),
  public.skills_set_maturity(text,text), public.skills_set_status(text,text), public.skills_admin_list()
  to service_role;
