-- Skill lifecycle management on top of the promotion flow (019).
-- States (derived, nothing new to keep in sync): draft, department, in_review, blocked, published, deprecated, retired.
--   draft       Individual: only the owner sees it.
--   department  Approved for a department (scope 'team'); members see it.
--   in_review   A promotion request waits for a person who is not the requester.
--   blocked     The automatic checks of a promotion request failed; fix and request again.
--   published   Approved for the whole organization (scope 'company').
--   deprecated  Still usable, but with a sunset date and (optionally) a replacement.
--   retired     Not offered any more. Restoring it returns it to Individual; it needs a new approval to be shared again.
-- 1. Every step is written to skills.lifecycle_event (who, when, why). Nothing deletes events.
-- 2. A skill needs a marketplace card before it can be shared: description of at least 40 characters, when to use it,
--    inputs, outputs and an example prompt (organization level also a contact and a domain). A missing card fails the check.
-- 3. Before a skill is shared it is compared with the skills that are already shared (text, tools, domain). An identical
--    copy fails the check; a similar skill is a warning for the reviewer unless the skill declares itself a variant
--    (variant_of and variant_reason, see skills.normalize_meta). Individual skills of other people are not compared.
-- 4. Deprecate, retire and restore are done by the owner, an admin of the department or the Governance board. A skill that is
--    published for everyone is deprecated first and may be retired by its owner after the sunset date; the board may retire it
--    at any time. A skill with active variants cannot be retired.
-- Same pattern as 007, 017 and 019: tables are closed to anon and authenticated, functions are service_role only (the Skill
-- Marketplace connector). Identity is the e-mail the connector sends as p_actor; for production map the sign-in to p_actor.

alter table skills.skill add column if not exists sunset_at date;
alter table skills.skill add column if not exists replaced_by text references skills.skill(slug) on delete set null;
alter table skills.skill add column if not exists lifecycle_note text not null default '' check (char_length(lifecycle_note) <= 400);
alter table skills.skill drop constraint if exists skill_not_own_replacement;
alter table skills.skill add constraint skill_not_own_replacement check (replaced_by is distinct from slug);

create table if not exists skills.skill_card (
  slug text primary key references skills.skill(slug) on delete cascade,
  use_when text not null default '' check (char_length(use_when) <= 400),
  not_for text not null default '' check (char_length(not_for) <= 300),
  inputs text not null default '' check (char_length(inputs) <= 300),
  outputs text not null default '' check (char_length(outputs) <= 300),
  example_prompt text not null default '' check (char_length(example_prompt) <= 300),
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists skills.lifecycle_event (
  id bigint generated always as identity primary key,
  slug text not null,
  version integer,
  event text not null check (event in ('created', 'version', 'submitted', 'blocked', 'approved', 'rejected', 'withdrawn',
    'published', 'unpublished', 'deprecated', 'undeprecated', 'retired', 'restored')),
  actor text not null default 'system',
  detail text not null default '' check (char_length(detail) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists lifecycle_event_slug on skills.lifecycle_event (slug, id desc);
alter table skills.skill_card enable row level security;
alter table skills.lifecycle_event enable row level security;
revoke all on skills.skill_card, skills.lifecycle_event from anon, authenticated;

alter table skills.promotion_check drop constraint if exists promotion_check_check_id_check;
alter table skills.promotion_check add constraint promotion_check_check_id_check
  check (check_id in ('secrets', 'scripts', 'permissions', 'harness', 'data', 'description', 'duplicate'));

-- ---------- helpers (not reachable through the API) ----------
create or replace function skills.scope_of(p_slug text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(s.meta->>'scope', case when s.status = 'published' then 'company' else 'individual' end)
  from skills.skill s where s.slug = p_slug;
$$;

create or replace function skills.is_board_admin(p_actor text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id
    where g.name = 'Governance board' and lower(m.email) = lower(p_actor) and m.role = 'admin');
$$;

create or replace function skills.is_team_admin(p_slug text, p_actor text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from skills.skill s join werkbank.groups g on g.name = s.meta->>'team'
    join werkbank.group_members m on m.group_id = g.id
    where s.slug = p_slug and lower(m.email) = lower(p_actor) and m.role = 'admin');
$$;

-- Who may see a skill (and its history): owner, members of its department, everyone for company level, admins that govern it.
create or replace function skills.can_see(p_slug text, p_actor text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from skills.skill s where s.slug = p_slug and (
         lower(s.owner) = lower(p_actor)
      or (s.status in ('published', 'retired') and skills.scope_of(s.slug) = 'company')
      or (skills.scope_of(s.slug) = 'team' and exists (
            select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id
            where g.name = s.meta->>'team' and lower(m.email) = lower(p_actor)))
      or skills.is_board_admin(p_actor)))
$$;

create or replace function skills.may_manage(p_slug text, p_actor text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from skills.skill s where s.slug = p_slug and lower(s.owner) = lower(p_actor))
      or skills.is_team_admin(p_slug, p_actor) or skills.is_board_admin(p_actor);
$$;

create or replace function skills.lifecycle_state(p_slug text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when s.status = 'retired' then 'retired'
    when s.sunset_at is not null then 'deprecated'
    when exists (select 1 from skills.promotion p where p.slug = s.slug and p.status = 'blocked') then 'blocked'
    when exists (select 1 from skills.promotion p where p.slug = s.slug and p.status = 'review') then 'in_review'
    when s.status = 'published' then 'published'
    when skills.scope_of(s.slug) = 'team' then 'department'
    else 'draft' end
  from skills.skill s where s.slug = p_slug;
$$;

-- What is missing on the marketplace card of a skill that wants to move to p_to ('team' or 'company').
create or replace function skills.card_gaps(p_slug text, p_to text)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  s skills.skill;
  c skills.skill_card;
  gaps text[] := '{}';
begin
  select * into s from skills.skill where slug = p_slug;
  if not found then raise exception 'unknown skill'; end if;
  select * into c from skills.skill_card where slug = p_slug;
  if char_length(btrim(s.description)) < 40 then gaps := array_append(gaps, 'description (at least 40 characters)'); end if;
  if coalesce(btrim(c.use_when), '') = '' then gaps := array_append(gaps, 'when to use it'); end if;
  if coalesce(btrim(c.inputs), '') = '' then gaps := array_append(gaps, 'inputs'); end if;
  if coalesce(btrim(c.outputs), '') = '' then gaps := array_append(gaps, 'outputs'); end if;
  if coalesce(btrim(c.example_prompt), '') = '' then gaps := array_append(gaps, 'example prompt'); end if;
  if p_to = 'company' then
    if coalesce(btrim(s.meta->>'contact'), '') = '' then gaps := array_append(gaps, 'contact for questions'); end if;
    if coalesce(s.meta->>'domain', 'Sonstiges') = 'Sonstiges' then gaps := array_append(gaps, 'domain'); end if;
  end if;
  return gaps;
end;
$$;

-- Skills that look like the given one. The pool is every skill that is shared (department, organization, published) plus the
-- skills of p_actor, never retired ones and never the skill itself. Same scoring as the earlier skills_similar.
create or replace function skills.similar_skills(p_slug text, p_description text, p_domain text, p_tools text[], p_body text, p_actor text)
returns table (slug text, description text, owner text, status text, scope text, team text, domain text, shared_tools jsonb,
               text_rank numeric, score numeric, identical boolean, similar boolean, declared_variant boolean)
language sql
stable
set search_path = ''
as $$
  with mine as (
    select skills.or_query(p_description, 4) as tsq,
           case when p_body is null then null else encode(sha256(convert_to(p_body, 'UTF8')), 'hex') end as h,
           (select m.meta from skills.skill m where m.slug = p_slug) as meta
  ), scored as (
    select s.slug, s.description, s.owner, s.status, skills.scope_of(s.slug) as scope, s.meta->>'team' as team,
      s.meta->>'domain' as domain, s.meta,
      ts_rank(skills.doc(s.slug, s.description, s.meta), mine.tsq) as rank,
      (select coalesce(jsonb_agg(t), '[]'::jsonb)
         from jsonb_array_elements_text(coalesce(s.meta->'tools', '[]'::jsonb)) t
        where t = any (coalesce(p_tools, '{}'::text[]))) as shared_tools,
      (s.meta->>'domain' = p_domain) as same_domain,
      (mine.h is not null and exists (select 1 from skills.version v
        where v.slug = s.slug and v.version = s.current_version and v.sha256 = mine.h)) as identical,
      (coalesce(mine.meta->>'variant_of', '') = s.slug and coalesce(mine.meta->>'variant_reason', '') <> ''
        or s.meta->>'variant_of' = p_slug and coalesce(s.meta->>'variant_reason', '') <> '') as declared_variant
    from skills.skill s cross join mine
    where s.status <> 'retired' and s.slug <> coalesce(p_slug, '')
      and (s.status = 'published' or skills.scope_of(s.slug) in ('team', 'company') or lower(s.owner) = lower(coalesce(p_actor, '')))
  )
  select slug, description, owner, status, scope, team, domain, shared_tools,
    round(rank::numeric, 3), round((rank + 0.3 * jsonb_array_length(shared_tools) + (case when same_domain then 0.1 else 0 end))::numeric, 3),
    identical,
    (identical or jsonb_array_length(shared_tools) >= 2 or (jsonb_array_length(shared_tools) >= 1 and same_domain) or rank >= 0.25),
    declared_variant
  from scored
  where identical or rank > 0 or jsonb_array_length(shared_tools) > 0
  order by identical desc, 10 desc, slug
  limit 5;
$$;

-- The two checks that need the registry (the five text checks live in skills.run_checks).
create or replace function skills.registry_checks(p_slug text, p_to text, p_actor text)
returns table (check_id text, status text, detail text)
language plpgsql
stable
set search_path = ''
as $$
declare
  s skills.skill;
  v skills.version;
  gaps text[];
  twin record;
  names text;
begin
  select * into s from skills.skill where slug = p_slug;
  select * into v from skills.version where slug = p_slug and version = s.current_version;

  check_id := 'description';
  gaps := skills.card_gaps(p_slug, p_to);
  if cardinality(gaps) > 0 then status := 'fail'; detail := 'The marketplace card is incomplete. Missing: ' || array_to_string(gaps, ', ') || '.';
  else status := 'pass'; detail := 'Description and marketplace card are complete.'; end if;
  return next;

  check_id := 'duplicate';
  select * into twin from skills.similar_skills(p_slug, s.description, s.meta->>'domain',
    array(select jsonb_array_elements_text(coalesce(s.meta->'tools', '[]'::jsonb))), v.body, p_actor) t
    where t.identical limit 1;
  if found then
    status := 'fail'; detail := 'Same text as the skill ' || twin.slug || ' (' || coalesce(nullif(twin.owner, ''), 'no owner') || '). Use or extend that skill instead.';
    return next; return;
  end if;
  select string_agg(t.slug || case when t.team is not null and t.team <> '' then ' (' || t.team || ')' else '' end, ', ' order by t.score desc) into names
    from skills.similar_skills(p_slug, s.description, s.meta->>'domain',
      array(select jsonb_array_elements_text(coalesce(s.meta->'tools', '[]'::jsonb))), v.body, p_actor) t
    where t.similar and not t.declared_variant;
  if names is not null then
    status := 'warn'; detail := 'Similar to ' || names || '. The reviewer compares them. If this skill is meant to differ, declare it as a variant (variant_of and variant_reason).';
  else
    status := 'pass'; detail := 'No similar skill is shared yet, or the difference is declared as a variant.';
  end if;
  return next;
end;
$$;

revoke all on function skills.scope_of(text), skills.is_board_admin(text), skills.is_team_admin(text, text), skills.can_see(text, text),
  skills.may_manage(text, text), skills.lifecycle_state(text), skills.card_gaps(text, text),
  skills.similar_skills(text, text, text, text[], text, text), skills.registry_checks(text, text, text)
  from public, anon, authenticated;

-- ---------- the earlier similarity check now uses the same function (no body, no actor: every non-retired skill, as before) ----------
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
        or rank >= 0.25) as is_similar
    from scored
    order by score desc, slug
    limit 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', slug, 'description', description, 'status', status, 'owner', owner,
    'domain', meta->>'domain', 'team', meta->>'team', 'sharedTools', shared_tools,
    'textRank', round(rank::numeric, 3), 'score', round(score::numeric, 3), 'similar', is_similar)
    order by score desc, slug), '[]'::jsonb)
  from ranked where score > 0;
$$;

-- ---------- audit trail (written by triggers, so no path can skip it) ----------
create or replace function skills.log_event(p_slug text, p_version integer, p_event text, p_actor text, p_detail text)
returns void
language sql
set search_path = ''
as $$
  insert into skills.lifecycle_event (slug, version, event, actor, detail)
  values (p_slug, p_version, p_event, coalesce(nullif(btrim(p_actor), ''), 'system'), left(coalesce(p_detail, ''), 400));
$$;

create or replace function skills.trg_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform skills.log_event(new.slug, new.version, case when new.version = 1 then 'created' else 'version' end,
    (select s.owner from skills.skill s where s.slug = new.slug), 'Version ' || new.version);
  return new;
end;
$$;
drop trigger if exists lifecycle_version on skills.version;
create trigger lifecycle_version after insert on skills.version for each row execute function skills.trg_version();

create or replace function skills.trg_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  who text := nullif(current_setting('skills.actor', true), '');
  why text := nullif(current_setting('skills.reason', true), '');
  approver text;
begin
  if new.status = old.status then return new; end if;
  -- An approval of the promotion flow publishes the skill in the same transaction: name the approver.
  if new.status = 'published' and who is null then
    select p.decided_by into approver from skills.promotion p
      where p.slug = new.slug and p.status = 'approved' and p.to_scope = 'company' order by p.decided_at desc limit 1;
  end if;
  perform skills.log_event(new.slug, new.current_version,
    case when new.status = 'published' and old.status = 'retired' then 'restored'
         when new.status = 'published' then 'published'
         when new.status = 'retired' then 'retired'
         when old.status = 'retired' then 'restored'
         else 'unpublished' end,
    coalesce(who, approver),
    coalesce(why, case when new.status = 'published' and approver is not null then 'Approved for the whole organization'
                       when new.status = 'draft' and old.status = 'published' then 'New version needs a new approval'
                       else '' end));
  return new;
end;
$$;
drop trigger if exists lifecycle_status on skills.skill;
create trigger lifecycle_status after update of status on skills.skill for each row execute function skills.trg_status();

create or replace function skills.trg_promotion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform skills.log_event(new.slug, new.version, 'submitted', new.requested_by, 'To ' || new.to_scope || case when new.note <> '' then ': ' || new.note else '' end);
  elsif new.status is distinct from old.status then
    if new.status = 'blocked' then
      perform skills.log_event(new.slug, new.version, 'blocked', 'system', 'Automatic checks failed');
    elsif new.status in ('approved', 'rejected', 'withdrawn') then
      perform skills.log_event(new.slug, new.version, new.status, new.decided_by,
        'To ' || new.to_scope || case when new.reason <> '' then ': ' || new.reason else '' end);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists lifecycle_promotion on skills.promotion;
create trigger lifecycle_promotion after insert or update of status on skills.promotion for each row execute function skills.trg_promotion();

revoke all on function skills.log_event(text, integer, text, text, text), skills.trg_version(), skills.trg_status(), skills.trg_promotion()
  from public, anon, authenticated;

-- ---------- promotion request: the five text checks plus description and duplicate ----------
create or replace function public.skills_promotion_request(p_actor text, p_slug text, p_to_scope text, p_group uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s skills.skill;
  v skills.version;
  pid uuid;
  st text;
  cls text;
begin
  select * into s from skills.skill where slug = p_slug;
  if not found then raise exception 'unknown skill'; end if;
  if s.status = 'retired' then raise exception 'a retired skill cannot be promoted. Restore it first'; end if;
  select * into v from skills.version where slug = p_slug and version = s.current_version;
  if p_to_scope not in ('team', 'company') then raise exception 'invalid target level'; end if;
  if p_to_scope = 'team' then
    if p_group is null or not exists (select 1 from werkbank.group_members m where m.group_id = p_group and lower(m.email) = lower(p_actor)) then
      raise exception 'the requester must be a member of the department';
    end if;
  else
    p_group := null;
    if coalesce(s.meta->>'scope', 'individual') <> 'team' then raise exception 'publish to the department first'; end if;
  end if;
  if exists (select 1 from skills.promotion where slug = p_slug and status in ('blocked', 'review')) then
    raise exception 'there is already an open request for this skill';
  end if;
  cls := coalesce(nullif(v.meta->>'data_class', ''), nullif(s.meta->>'data_class', ''), 'intern');
  insert into skills.promotion (slug, version, sha256, to_scope, group_id, requested_by, note, status)
    values (p_slug, v.version, v.sha256, p_to_scope, p_group, lower(p_actor), coalesce(p_note, ''), 'review')
    returning id into pid;
  insert into skills.promotion_check (promotion_id, check_id, status, detail)
    select pid, c.check_id, c.status, c.detail
    from skills.run_checks(v.body, coalesce(v.meta->'tools', s.meta->'tools'), cls, p_to_scope) c;
  insert into skills.promotion_check (promotion_id, check_id, status, detail)
    select pid, c.check_id, c.status, c.detail from skills.registry_checks(p_slug, p_to_scope, lower(p_actor)) c;
  if exists (select 1 from skills.promotion_check where promotion_id = pid and status = 'fail') then
    update skills.promotion set status = 'blocked' where id = pid;
    st := 'blocked';
  else
    st := 'review';
  end if;
  return jsonb_build_object('id', pid, 'status', st, 'version', v.version);
end;
$$;

-- ---------- what a person may sync: retired skills are gone, deprecated ones carry their sunset ----------
create or replace function public.skills_visible(p_actor text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', s.slug, 'description', s.description, 'owner', s.owner, 'version', v.version, 'sha256', v.sha256,
    'scope', coalesce(s.meta->>'scope', 'individual'), 'team', coalesce(s.meta->>'team', ''),
    'sunsetAt', s.sunset_at, 'replacedBy', s.replaced_by) order by s.slug), '[]'::jsonb)
  from skills.skill s
  join skills.version v on v.slug = s.slug and v.version = s.current_version
  where s.status <> 'retired' and (
        (s.status = 'published' and coalesce(s.meta->>'scope', 'company') = 'company')
     or (coalesce(s.meta->>'scope', 'individual') = 'team' and exists (
          select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id
          where g.name = s.meta->>'team' and lower(m.email) = lower(p_actor)))
     or lower(s.owner) = lower(p_actor));
$$;

create or replace function public.skills_get_visible(p_actor text, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('slug', s.slug, 'description', s.description, 'owner', s.owner, 'version', v.version, 'sha256', v.sha256,
    'sunsetAt', s.sunset_at, 'replacedBy', s.replaced_by, 'body', v.body)
  from skills.skill s
  join skills.version v on v.slug = s.slug and v.version = s.current_version
  where s.slug = p_slug and s.status <> 'retired' and (
       (s.status = 'published' and coalesce(s.meta->>'scope', 'company') = 'company')
    or (coalesce(s.meta->>'scope', 'individual') = 'team' and exists (
          select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id
          where g.name = s.meta->>'team' and lower(m.email) = lower(p_actor)))
    or lower(s.owner) = lower(p_actor));
$$;

-- ---------- marketplace card ----------
create or replace function public.skills_card_set(p_actor text, p_slug text, p_use_when text, p_not_for text, p_inputs text, p_outputs text, p_example text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare who text := lower(btrim(coalesce(p_actor, '')));
begin
  if char_length(who) < 3 or char_length(who) > 120 then raise exception 'actor must be an e-mail address'; end if;
  if not skills.can_see(p_slug, who) then raise exception 'unknown skill'; end if;
  if not skills.may_manage(p_slug, who) then raise exception 'only the owner, an admin of the department or the Governance board may change the card'; end if;
  if (select status from skills.skill where slug = p_slug) = 'retired' then raise exception 'a retired skill has no card to change'; end if;
  insert into skills.skill_card (slug, use_when, not_for, inputs, outputs, example_prompt, updated_by)
    values (p_slug, btrim(coalesce(p_use_when, '')), btrim(coalesce(p_not_for, '')), btrim(coalesce(p_inputs, '')),
            btrim(coalesce(p_outputs, '')), btrim(coalesce(p_example, '')), who)
    on conflict (slug) do update set use_when = excluded.use_when, not_for = excluded.not_for, inputs = excluded.inputs,
      outputs = excluded.outputs, example_prompt = excluded.example_prompt, updated_by = excluded.updated_by, updated_at = now();
  return public.skills_card_get(who, p_slug, case when skills.scope_of(p_slug) = 'team' then 'company' else 'team' end);
end;
$$;

create or replace function public.skills_card_get(p_actor text, p_slug text, p_to text default 'team')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare gaps text[];
begin
  if p_to not in ('team', 'company') then raise exception 'invalid target level'; end if;
  if not skills.can_see(p_slug, p_actor) then raise exception 'unknown skill'; end if;
  gaps := skills.card_gaps(p_slug, p_to);
  return (select jsonb_build_object(
      'slug', s.slug, 'description', s.description, 'owner', s.owner, 'domain', s.meta->>'domain', 'contact', s.meta->>'contact',
      'useWhen', coalesce(c.use_when, ''), 'notFor', coalesce(c.not_for, ''), 'inputs', coalesce(c.inputs, ''),
      'outputs', coalesce(c.outputs, ''), 'examplePrompt', coalesce(c.example_prompt, ''),
      'updatedBy', c.updated_by, 'updatedAt', c.updated_at,
      'checkedFor', p_to, 'complete', cardinality(gaps) = 0, 'missing', to_jsonb(gaps))
    from skills.skill s left join skills.skill_card c on c.slug = s.slug where s.slug = p_slug);
end;
$$;

-- ---------- duplicate check before building or sharing ----------
create or replace function public.skills_check_duplicates(p_actor text, p_slug text, p_description text, p_domain text, p_tools text[], p_body text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matches jsonb;
  verdict text;
begin
  if btrim(coalesce(p_description, '')) = '' then raise exception 'a description is needed'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', m.slug, 'description', m.description, 'owner', m.owner, 'status', m.status, 'scope', m.scope, 'team', m.team,
      'domain', m.domain, 'sharedTools', m.shared_tools, 'textRank', m.text_rank, 'score', m.score,
      'identical', m.identical, 'similar', m.similar, 'declaredVariant', m.declared_variant) order by m.identical desc, m.score desc, m.slug), '[]'::jsonb),
    case when bool_or(m.identical) then 'identical'
         when bool_or(m.similar and not m.declared_variant) then 'similar'
         when bool_or(m.similar) then 'variant'
         else 'none' end
  into matches, verdict
  from skills.similar_skills(nullif(btrim(p_slug), ''), p_description, p_domain, p_tools, p_body, lower(p_actor)) m;
  return jsonb_build_object('verdict', coalesce(verdict, 'none'), 'matches', matches);
end;
$$;

-- ---------- deprecate, retire, restore ----------
create or replace function public.skills_lifecycle_change(p_actor text, p_slug text, p_action text, p_reason text,
  p_sunset date default null, p_replaced_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text := lower(btrim(coalesce(p_actor, '')));
  why text := btrim(coalesce(p_reason, ''));
  s skills.skill;
  scope text;
  variants text;
begin
  if char_length(who) < 3 or char_length(who) > 120 then raise exception 'actor must be an e-mail address'; end if;
  if p_action not in ('deprecate', 'retire', 'restore') then raise exception 'invalid action'; end if;
  if why = '' or char_length(why) > 400 then raise exception 'a reason of 1 to 400 characters is needed'; end if;
  if not skills.can_see(p_slug, who) then raise exception 'unknown skill'; end if;
  select * into s from skills.skill where slug = p_slug for update;
  if not skills.may_manage(p_slug, who) then
    raise exception 'only the owner, an admin of the department or the Governance board may change the lifecycle';
  end if;
  scope := skills.scope_of(p_slug);
  if p_replaced_by is not null and (p_replaced_by = p_slug
     or not exists (select 1 from skills.skill r where r.slug = p_replaced_by and r.status <> 'retired')) then
    raise exception 'the replacement must be another skill that is not retired';
  end if;
  perform set_config('skills.actor', who, true);
  perform set_config('skills.reason', why, true);

  if p_action = 'deprecate' then
    if s.status = 'retired' then raise exception 'the skill is retired'; end if;
    if scope = 'individual' then raise exception 'only shared skills are deprecated. Retire an individual skill instead'; end if;
    if p_sunset is null or p_sunset < current_date or p_sunset > current_date + 730 then
      raise exception 'the sunset date must be today or later, within two years';
    end if;
    update skills.skill set sunset_at = p_sunset, replaced_by = p_replaced_by, lifecycle_note = why, updated_at = now() where slug = p_slug;
    perform skills.log_event(p_slug, s.current_version, 'deprecated', who,
      'Sunset ' || p_sunset || coalesce(', replaced by ' || p_replaced_by, '') || ': ' || why);

  elsif p_action = 'retire' then
    if s.status = 'retired' then raise exception 'the skill is already retired'; end if;
    select string_agg(v.slug, ', ' order by v.slug) into variants from skills.skill v
      where v.meta->>'variant_of' = p_slug and v.status <> 'retired';
    if variants is not null then raise exception 'active variants depend on this skill: %', variants; end if;
    if scope = 'company' and not skills.is_board_admin(who) and (s.sunset_at is null or s.sunset_at > current_date) then
      raise exception 'a skill published for everyone is deprecated first. Its owner may retire it after the sunset date, the Governance board at any time';
    end if;
    update skills.promotion set status = 'withdrawn', decided_by = who, decided_at = now(), reason = 'Skill retired'
      where slug = p_slug and status in ('blocked', 'review');
    update skills.skill set status = 'retired', replaced_by = coalesce(p_replaced_by, replaced_by), lifecycle_note = why, updated_at = now()
      where slug = p_slug;

  else
    if s.status = 'retired' then
      update skills.skill set status = 'draft', meta = meta - 'scope', sunset_at = null, replaced_by = null, lifecycle_note = '',
        maturity = 'pilot', approved_by = '', approved_at = null, approved_version = null, updated_at = now() where slug = p_slug;
    elsif s.sunset_at is not null then
      update skills.skill set sunset_at = null, replaced_by = null, lifecycle_note = '', updated_at = now() where slug = p_slug;
      perform skills.log_event(p_slug, s.current_version, 'undeprecated', who, why);
    else
      raise exception 'nothing to restore';
    end if;
  end if;
  return public.skills_lifecycle_state(who, p_slug);
end;
$$;

-- ---------- read: one skill ----------
create or replace function public.skills_lifecycle_state(p_actor text, p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare scope text;
begin
  if not skills.can_see(p_slug, p_actor) then raise exception 'unknown skill'; end if;
  scope := skills.scope_of(p_slug);
  return (select jsonb_build_object(
    'slug', s.slug, 'state', skills.lifecycle_state(s.slug), 'scope', scope, 'team', coalesce(s.meta->>'team', ''),
    'version', s.current_version, 'maturity', s.maturity, 'owner', s.owner,
    'sunsetAt', s.sunset_at, 'replacedBy', s.replaced_by, 'note', s.lifecycle_note,
    'canManage', skills.may_manage(s.slug, p_actor),
    'cardMissing', to_jsonb(case when s.status = 'retired' then '{}'::text[]
                                 else skills.card_gaps(s.slug, case when scope = 'team' then 'company' else 'team' end) end),
    'openRequest', (select jsonb_build_object('id', p.id, 'status', p.status, 'toScope', p.to_scope, 'requestedBy', p.requested_by,
        'version', p.version, 'createdAt', p.created_at,
        'checks', (select coalesce(jsonb_agg(jsonb_build_object('id', c.check_id, 'status', c.status, 'detail', c.detail) order by c.check_id), '[]'::jsonb)
                   from skills.promotion_check c where c.promotion_id = p.id))
      from skills.promotion p where p.slug = s.slug and p.status in ('blocked', 'review') limit 1),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'version', e.version, 'actor', e.actor,
        'detail', e.detail, 'at', e.created_at) order by e.id desc), '[]'::jsonb)
      from (select * from skills.lifecycle_event where slug = s.slug order by id desc limit 30) e))
  from skills.skill s where s.slug = p_slug);
end;
$$;

-- ---------- read: overview of the skills a person may see ----------
create or replace function public.skills_lifecycle_overview(p_actor text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with seen as (
    select s.slug, skills.lifecycle_state(s.slug) as state, skills.scope_of(s.slug) as scope, s.current_version as version,
           s.owner, s.sunset_at, s.replaced_by, s.updated_at
    from skills.skill s where skills.can_see(s.slug, p_actor)
  )
  select jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb) from (select state, count(*) n from seen group by state) c),
    'skills', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'state', state, 'scope', scope, 'version', version,
        'owner', owner, 'sunsetAt', sunset_at, 'replacedBy', replaced_by) order by slug), '[]'::jsonb) from (select * from seen order by slug limit 200) x),
    'attention', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'reason',
        case when state = 'deprecated' and sunset_at < current_date then 'Sunset date has passed: retire it or move the date'
             when state = 'deprecated' and sunset_at <= current_date + 30 then 'Sunset within 30 days'
             when state = 'blocked' then 'Checks failed: fix the skill and request again' end) order by slug), '[]'::jsonb)
      from seen where (state = 'deprecated' and sunset_at <= current_date + 30) or state = 'blocked'),
    'waitingForMe', (select count(*) from skills.promotion p where p.status = 'review' and lower(p_actor) <> p.requested_by and (
        (p.to_scope = 'team' and exists (select 1 from werkbank.group_members m where m.group_id = p.group_id and lower(m.email) = lower(p_actor) and m.role = 'admin'))
        or (p.to_scope = 'company' and skills.is_board_admin(p_actor)))));
$$;

revoke all on function public.skills_similar(text, text, text, text[]), public.skills_promotion_request(text, text, text, uuid, text),
  public.skills_visible(text), public.skills_get_visible(text, text),
  public.skills_card_set(text, text, text, text, text, text, text), public.skills_card_get(text, text, text),
  public.skills_check_duplicates(text, text, text, text, text[], text),
  public.skills_lifecycle_change(text, text, text, text, date, text), public.skills_lifecycle_state(text, text),
  public.skills_lifecycle_overview(text) from public, anon, authenticated;
grant execute on function public.skills_similar(text, text, text, text[]), public.skills_promotion_request(text, text, text, uuid, text),
  public.skills_visible(text), public.skills_get_visible(text, text),
  public.skills_card_set(text, text, text, text, text, text, text), public.skills_card_get(text, text, text),
  public.skills_check_duplicates(text, text, text, text, text[], text),
  public.skills_lifecycle_change(text, text, text, text, date, text), public.skills_lifecycle_state(text, text),
  public.skills_lifecycle_overview(text) to service_role;
