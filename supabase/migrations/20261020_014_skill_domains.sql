-- Skills marketplace: the domain list now matches the bundled example skills.
-- Added: Vertrieb, Automatisierung, Sicherheit & Zugriff, Skill-Management (the example skills already use them and
-- could not be published before). Only the body of skills.normalize_meta changes: no table, grant or signature.

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
