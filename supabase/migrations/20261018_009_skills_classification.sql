-- Skills marketplace: classification by Board Area, LOB, team and reach ("scope").
-- Board areas: Finance, Sales, Marketing, Engineering. LOBs (all under Engineering): BTP, Concur, SuccessFactors.
-- Scope ladder: individual -> team -> lob -> board-area -> company. New skills start as 'individual'.
-- Teams stay free text. Only function bodies change, no table, grant or signature: existing grants stay.
-- Existing approved skills keep their stored profile until they are published again with the new fields.

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
  ba text := coalesce(btrim(m->>'board_area'), '');
  lob text := coalesce(btrim(m->>'lob'), '');
  sc text := coalesce(nullif(btrim(m->>'scope'), ''), 'individual');
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
  if ba not in ('', 'Finance', 'Sales', 'Marketing', 'Engineering') then raise exception 'invalid board_area: %', ba; end if;
  if lob not in ('', 'BTP', 'Concur', 'SuccessFactors') then raise exception 'invalid lob: %', lob; end if;
  -- the LOBs belong to Engineering; a LOB fills in the board area, a different board area is a contradiction
  if lob <> '' and ba = '' then ba := 'Engineering'; end if;
  if lob <> '' and ba <> 'Engineering' then raise exception 'lob % belongs to Engineering, not %', lob, ba; end if;
  if sc not in ('individual', 'team', 'lob', 'board-area', 'company') then raise exception 'invalid scope: %', sc; end if;
  if sc = 'team' and team = '' then raise exception 'scope team needs a team'; end if;
  if sc = 'lob' and lob = '' then raise exception 'scope lob needs a lob'; end if;
  if sc = 'board-area' and ba = '' then raise exception 'scope board-area needs a board_area'; end if;
  if vo is not null and vo !~ '^[a-z0-9][a-z0-9-]{1,48}$' then raise exception 'invalid variant_of'; end if;
  select coalesce(jsonb_agg(distinct t order by t), '[]'::jsonb) into tl
    from jsonb_array_elements_text(coalesce(m->'tools', '[]'::jsonb)) t;
  if jsonb_array_length(tl) > 20 then raise exception 'too many tools'; end if;
  if exists (select 1 from jsonb_array_elements_text(tl) t where t !~ '^[a-z][a-z0-9_]{1,60}$') then
    raise exception 'invalid tool name';
  end if;
  return jsonb_build_object('domain', dom, 'process', proc, 'data_class', dc, 'language', lang,
    'team', team, 'contact', contact, 'board_area', ba, 'lob', lob, 'scope', sc, 'tools', tl, 'variant_of', vo, 'variant_reason', vr);
end;
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
    'boardArea', coalesce(meta->>'board_area', ''), 'lob', coalesce(meta->>'lob', ''), 'scope', coalesce(meta->>'scope', 'individual'),
    'dataClass', meta->>'data_class', 'tools', coalesce(meta->'tools', '[]'::jsonb),
    'matchedTools', hit_tools, 'score', round(score::numeric, 3)) order by score desc, slug), '[]'::jsonb)
  from ranked;
$$;
