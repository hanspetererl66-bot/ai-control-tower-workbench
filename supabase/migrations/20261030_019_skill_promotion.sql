-- Skill promotion: a skill moves from Individual to Department ('team') to Organization ('company') only through a request.
-- 1. The request runs five automatic checks on the exact version (secrets, scripts, permissions, harness, data class).
--    A failed check blocks the request ('blocked'); otherwise it waits for a human ('review'), warnings attached.
-- 2. A person who is NOT the requester decides: group admin of the department, or admin of the group 'Governance board'.
-- 3. Approval changes the scope of the skill; every request keeps who, when and why.
-- Same pattern as 007 / 017: tables are closed to anon and authenticated, functions are service_role only (the AI Control
-- Tower connector). Identity is the e-mail the app sends as p_actor; for production map the sign-in to p_actor.
-- The check rules mirror src/skill-review.ts; change both together.
create table if not exists skills.promotion (
  id uuid primary key default gen_random_uuid(),
  slug text not null references skills.skill(slug) on delete cascade,
  version integer not null,
  sha256 text not null,
  to_scope text not null check (to_scope in ('team', 'company')),
  group_id uuid references werkbank.groups(id) on delete set null,
  requested_by text not null check (char_length(requested_by) between 3 and 120),
  note text not null default '' check (char_length(note) <= 400),
  status text not null default 'review' check (status in ('blocked', 'review', 'approved', 'rejected', 'withdrawn')),
  decided_by text,
  decided_at timestamptz,
  reason text not null default '' check (char_length(reason) <= 400),
  created_at timestamptz not null default now(),
  check ((to_scope = 'team') = (group_id is not null))
);
create table if not exists skills.promotion_check (
  promotion_id uuid not null references skills.promotion(id) on delete cascade,
  check_id text not null check (check_id in ('secrets', 'scripts', 'permissions', 'harness', 'data')),
  status text not null check (status in ('pass', 'warn', 'fail')),
  detail text not null default '',
  primary key (promotion_id, check_id)
);
create unique index if not exists promotion_one_open on skills.promotion (slug) where status in ('blocked', 'review');
alter table skills.promotion enable row level security;
alter table skills.promotion_check enable row level security;
revoke all on skills.promotion, skills.promotion_check from anon, authenticated;

-- ---------- the five checks ----------
create or replace function skills.run_checks(p_body text, p_tools jsonb, p_class text, p_to text)
returns table (check_id text, status text, detail text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  secret text := substring(p_body from '(?i)(sb_secret_|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|(?:api[_-]?key|secret|password|passwort|token)\s*[:=]\s*[''"]?[A-Za-z0-9_./+-]{8,})');
  danger text := substring(p_body from '(?i)(rm\s+-rf|\|\s*(?:ba)?sh\M|base64\s+-d|\meval\s*\(|chmod\s+\+x|Invoke-Expression|powershell\s+-enc)');
  scripty text := substring(p_body from '(?i)(```(?:bash|sh|shell|zsh|python|py|js|javascript|ts|powershell|ps1|bat)\M|\m(?:curl|wget)\s+\S|\mnpx?\s+(?:-y\s+)?\S|\mpip\s+install\M)');
  bypass text := substring(p_body from '(?i)(ignore (?:all |any )?(?:previous|prior|safety|the) ?(?:instructions|rules|guardrails)?|without (?:asking|approval|confirmation)|skip (?:the )?(?:approval|confirmation|permission)|disable (?:the )?(?:approval|permission|safety|guardrail)|never ask (?:for )?(?:approval|permission))');
  writes text;
begin
  select string_agg(t, ', ') into writes from jsonb_array_elements_text(coalesce(p_tools, '[]'::jsonb)) t
    where t ~* '(^|_)(send|delete|remove|create|update|post|write|drop|approve|pay|transfer)(_|$)';

  check_id := 'secrets';
  if secret is not null then status := 'fail'; detail := 'Looks like a credential. Remove it and use a connector instead.';
  else status := 'pass'; detail := 'No keys, tokens or passwords found.'; end if;
  return next;

  check_id := 'scripts';
  if danger is not null then status := 'fail'; detail := 'Dangerous command: ' || danger;
  elsif scripty is not null then status := 'warn'; detail := 'Contains a script or download: ' || left(btrim(scripty), 40) || '. The reviewer reads it.';
  else status := 'pass'; detail := 'Instructions only: no scripts, no downloads.'; end if;
  return next;

  check_id := 'permissions';
  if writes is not null then status := 'warn'; detail := 'Can change data: ' || writes || '. Every call still needs approval.';
  else status := 'pass'; detail := 'No tool that changes data.'; end if;
  return next;

  check_id := 'harness';
  if bypass is not null then status := 'fail'; detail := 'Tries to bypass the safety rules: ' || bypass;
  else status := 'pass'; detail := 'Respects approvals, tool limits and the active harness profile.'; end if;
  return next;

  check_id := 'data';
  if p_class = 'vertraulich' and p_to = 'company' then status := 'fail'; detail := 'Confidential data may not be published organization-wide.';
  elsif p_class = 'vertraulich' then status := 'warn'; detail := 'Confidential data: only people of the department may use it.';
  else status := 'pass'; detail := 'Data class ' || p_class || ' is fine for this level.'; end if;
  return next;
end;
$$;

-- ---------- request ----------
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
  if exists (select 1 from skills.promotion_check where promotion_id = pid and status = 'fail') then
    update skills.promotion set status = 'blocked' where id = pid;
    st := 'blocked';
  else
    st := 'review';
  end if;
  return jsonb_build_object('id', pid, 'status', st, 'version', v.version);
end;
$$;

-- ---------- decision ----------
create or replace function public.skills_promotion_decide(p_actor text, p_id uuid, p_approve boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p skills.promotion;
  cur integer;
  gname text;
begin
  select * into p from skills.promotion where id = p_id for update;
  if not found then raise exception 'unknown request'; end if;
  if p.status <> 'review' then raise exception 'the request is not waiting for a decision (%)', p.status; end if;
  if lower(p_actor) = p.requested_by then raise exception 'the requester cannot decide their own request'; end if;
  if p.to_scope = 'team' then
    if not exists (select 1 from werkbank.group_members m where m.group_id = p.group_id and lower(m.email) = lower(p_actor) and m.role = 'admin') then
      raise exception 'only an admin of the department may decide';
    end if;
  elsif not exists (
    select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id
    where g.name = 'Governance board' and lower(m.email) = lower(p_actor) and m.role = 'admin') then
    raise exception 'only the Governance board may decide';
  end if;
  if not p_approve and btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is needed to reject'; end if;
  select current_version into cur from skills.skill where slug = p.slug;
  if p_approve and cur <> p.version then raise exception 'the skill changed after the request (version % now %). Request again.', p.version, cur; end if;
  update skills.promotion set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = lower(p_actor), decided_at = now(), reason = coalesce(p_reason, '') where id = p_id;
  if p_approve then
    select name into gname from werkbank.groups where id = p.group_id;
    -- Company level = published for everyone (the public read functions return it). Department level stays 'draft' so the
    -- public read functions do not return it; members get it through skills_visible / skills_get_visible below.
    update skills.skill set status = case when p.to_scope = 'company' then 'published' else status end, updated_at = now(),
      meta = meta || jsonb_build_object('scope', p.to_scope) || case when p.to_scope = 'team' then jsonb_build_object('team', coalesce(gname, '')) else '{}'::jsonb end
      where slug = p.slug;
    update skills.version set meta = meta || jsonb_build_object('scope', p.to_scope) where slug = p.slug and version = p.version;
  end if;
  return jsonb_build_object('id', p_id, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

create or replace function public.skills_promotion_withdraw(p_actor text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update skills.promotion set status = 'withdrawn', decided_by = lower(p_actor), decided_at = now()
    where id = p_id and status in ('blocked', 'review') and requested_by = lower(p_actor);
  if not found then raise exception 'nothing to withdraw'; end if;
  return jsonb_build_object('id', p_id, 'status', 'withdrawn');
end;
$$;

-- ---------- list: what the person may see (own requests, and those waiting for them) ----------
create or replace function public.skills_promotion_list(p_actor text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'version', p.version, 'to_scope', p.to_scope, 'status', p.status,
    'requested_by', p.requested_by, 'note', p.note, 'created_at', p.created_at,
    'decided_by', p.decided_by, 'decided_at', p.decided_at, 'reason', p.reason,
    'can_decide', p.status = 'review' and lower(p_actor) <> p.requested_by and (
      (p.to_scope = 'team' and exists (select 1 from werkbank.group_members m where m.group_id = p.group_id and lower(m.email) = lower(p_actor) and m.role = 'admin'))
      or (p.to_scope = 'company' and exists (select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id where g.name = 'Governance board' and lower(m.email) = lower(p_actor) and m.role = 'admin'))),
    'checks', (select coalesce(jsonb_agg(jsonb_build_object('id', c.check_id, 'status', c.status, 'detail', c.detail) order by c.check_id), '[]'::jsonb)
               from skills.promotion_check c where c.promotion_id = p.id)
  ) order by p.created_at desc), '[]'::jsonb)
  from (select * from skills.promotion order by created_at desc limit 100) p
  where lower(p_actor) = p.requested_by
     or exists (select 1 from werkbank.group_members m where lower(m.email) = lower(p_actor) and m.role = 'admin');
$$;

revoke all on function skills.run_checks(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.skills_promotion_request(text, text, text, uuid, text), public.skills_promotion_decide(text, uuid, boolean, text),
  public.skills_promotion_withdraw(text, uuid), public.skills_promotion_list(text) from public, anon, authenticated;
grant execute on function public.skills_promotion_request(text, text, text, uuid, text), public.skills_promotion_decide(text, uuid, boolean, text),
  public.skills_promotion_withdraw(text, uuid), public.skills_promotion_list(text) to service_role;

-- ---------- what a person may sync: own skills, skills of their departments, and everything published company-wide ----------
create or replace function public.skills_visible(p_actor text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', s.slug, 'description', s.description, 'owner', s.owner, 'version', v.version, 'sha256', v.sha256,
    'scope', coalesce(s.meta->>'scope', 'individual'), 'team', coalesce(s.meta->>'team', '')) order by s.slug), '[]'::jsonb)
  from skills.skill s
  join skills.version v on v.slug = s.slug and v.version = s.current_version
  where (s.status = 'published' and coalesce(s.meta->>'scope', 'company') = 'company')
     or (coalesce(s.meta->>'scope', 'individual') = 'team' and exists (
          select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id
          where g.name = s.meta->>'team' and lower(m.email) = lower(p_actor)))
     or lower(s.owner) = lower(p_actor);
$$;

create or replace function public.skills_get_visible(p_actor text, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('slug', s.slug, 'description', s.description, 'owner', s.owner, 'version', v.version, 'sha256', v.sha256, 'body', v.body)
  from skills.skill s
  join skills.version v on v.slug = s.slug and v.version = s.current_version
  where s.slug = p_slug and (
       (s.status = 'published' and coalesce(s.meta->>'scope', 'company') = 'company')
    or (coalesce(s.meta->>'scope', 'individual') = 'team' and exists (
          select 1 from werkbank.group_members m join werkbank.groups g on g.id = m.group_id
          where g.name = s.meta->>'team' and lower(m.email) = lower(p_actor)))
    or lower(s.owner) = lower(p_actor));
$$;
revoke all on function public.skills_visible(text), public.skills_get_visible(text, text) from public, anon, authenticated;
grant execute on function public.skills_visible(text), public.skills_get_visible(text, text) to service_role;
