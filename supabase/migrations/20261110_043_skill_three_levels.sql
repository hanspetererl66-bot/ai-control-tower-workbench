-- Three levels only: a skill is individual, team (department) or company. 'lob' and 'board-area' were scopes nobody could reach:
-- the promotion table only knows team and company, and visibility (skills.can_see) only looks at team and company.
-- LOB and board area stay as classification fields; they no longer widen the audience.
-- 1. Existing skills with scope lob or board-area become scope team (team = their team, else the LOB, else the board area, else
--    'Unassigned'). NOTE: team scope is visible only to members of the matching department group, so such a skill gets narrower.
-- 2. skills.normalize_meta accepts the three scopes and keeps `requires` (connector ids) which it dropped before.
update skills.skill
   set meta = meta || jsonb_build_object('scope', 'team', 'team',
         coalesce(nullif(btrim(meta->>'team'), ''), nullif(btrim(meta->>'lob'), ''), nullif(btrim(meta->>'board_area'), ''), 'Unassigned'))
 where meta->>'scope' in ('lob', 'board-area');
update skills.version
   set meta = meta || jsonb_build_object('scope', 'team', 'team',
         coalesce(nullif(btrim(meta->>'team'), ''), nullif(btrim(meta->>'lob'), ''), nullif(btrim(meta->>'board_area'), ''), 'Unassigned'))
 where meta->>'scope' in ('lob', 'board-area');

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
  rq jsonb;
begin
  if dom not in ('Governance & Risiko','Service & Support','Finanzen','Vertrieb','HR','Entwicklung','Betrieb','Automatisierung','Sicherheit & Zugriff','Skill-Management','Sonstiges') then
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
  if sc not in ('individual', 'team', 'company') then raise exception 'invalid scope: % (use individual, team or company)', sc; end if;
  if sc = 'team' and team = '' then raise exception 'scope team needs a team'; end if;
  if vo is not null and vo !~ '^[a-z0-9][a-z0-9-]{1,48}$' then raise exception 'invalid variant_of'; end if;
  select coalesce(jsonb_agg(distinct t order by t), '[]'::jsonb) into tl
    from jsonb_array_elements_text(coalesce(m->'tools', '[]'::jsonb)) t;
  if jsonb_array_length(tl) > 20 then raise exception 'too many tools'; end if;
  if exists (select 1 from jsonb_array_elements_text(tl) t where t !~ '^[a-z][a-z0-9_]{1,60}$') then
    raise exception 'invalid tool name';
  end if;
  -- connector ids the skill needs (front matter `requires:`); kept so the app can warn about a missing connector
  select coalesce(jsonb_agg(distinct t order by t), '[]'::jsonb) into rq
    from jsonb_array_elements_text(coalesce(m->'requires', '[]'::jsonb)) t;
  if jsonb_array_length(rq) > 20 then raise exception 'too many required connectors'; end if;
  if exists (select 1 from jsonb_array_elements_text(rq) t where t !~ '^[a-z0-9][a-z0-9_-]{1,60}$') then
    raise exception 'invalid connector id in requires';
  end if;
  return jsonb_build_object('domain', dom, 'process', proc, 'data_class', dc, 'language', lang,
    'team', team, 'contact', contact, 'board_area', ba, 'lob', lob, 'scope', sc, 'tools', tl, 'variant_of', vo, 'variant_reason', vr, 'requires', rq);
end;
$$;
