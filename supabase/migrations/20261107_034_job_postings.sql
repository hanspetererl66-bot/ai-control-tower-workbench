-- Recruiting: the step before the process. A job posting is written from a template, checked, released by the hiring manager and
-- published on channels. Run in the Supabase SQL editor after 028 to 030 (and 032 if applied). Safe to run again.
--
-- Rules the database enforces (not the app):
--  * Templates: one company standard (not changeable) and saved templates of people. A saved template always derives from the standard
--    and keeps its LOCKED sections word for word (company text, equal-opportunity text).
--  * A posting is written for an open requisition. Joule (the agent) can only create and edit DRAFTS and send them for review.
--  * Only the hiring manager of the requisition can release, publish or withdraw a posting (not even the Governance board).
--  * Submitting and releasing check the text again: gender-neutral title marker, no empty field, no personal trait in unlocked text,
--    no credential. A released posting cannot be edited; to change it, withdraw it and write a new one.
--  * Publishing is MOCK ONLY. The table allows no other mode until a real channel connection exists. Nothing is sent anywhere.
-- Pay is never filled in by the database or by Joule: an empty {{pay}} field blocks submitting.

create table if not exists recruiting.posting_setting (
  key text primary key check (key in ('company', 'apply_base')),
  value text not null check (char_length(value) between 1 and 200)
);
insert into recruiting.posting_setting (key, value) values ('company', 'Hanse Logistik'), ('apply_base', 'https://careers.hanse-logistik.example/jobs/')
on conflict (key) do nothing;

create table if not exists recruiting.posting_template (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('standard', 'saved')),
  owner_email text check (owner_email is null or owner_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  shared boolean not null default false,
  sections jsonb not null,
  based_on bigint references recruiting.posting_template (id),
  uses integer not null default 0 check (uses >= 0),
  last_used date,
  created_at timestamptz not null default now(),
  check ((kind = 'standard') = (owner_email is null)),
  check (kind = 'standard' or based_on is not null)
);
create unique index if not exists posting_template_name_idx on recruiting.posting_template ((coalesce(lower(owner_email), '')), lower(name));
create unique index if not exists posting_template_one_standard on recruiting.posting_template ((kind)) where kind = 'standard';

create table if not exists recruiting.job_posting (
  id bigint generated always as identity primary key,
  requisition_id text not null references recruiting.requisition (id),
  template_id bigint not null references recruiting.posting_template (id),
  title text not null check (char_length(title) between 1 and 200),
  sections jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'released', 'withdrawn')),
  created_by text not null check (created_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_by text,
  released_at timestamptz,
  check ((status in ('released', 'withdrawn')) = (released_by is not null and released_at is not null))
);
create index if not exists job_posting_req_idx on recruiting.job_posting (requisition_id, status);

create table if not exists recruiting.posting_channel (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('own', 'portal', 'social')),
  source text not null check (char_length(source) between 1 and 40),
  format text not null check (format in ('full', 'short')),
  char_limit integer not null check (char_limit between 100 and 50000),
  active boolean not null default true
);
insert into recruiting.posting_channel (id, name, kind, source, format, char_limit) values
  ('sap-portal', 'SAP career portal', 'own', 'Career site', 'full', 12000),
  ('linkedin', 'LinkedIn', 'portal', 'LinkedIn', 'full', 6000),
  ('xing', 'Xing', 'portal', 'Job board', 'full', 6000),
  ('monster', 'Monster.de', 'portal', 'Job board', 'full', 6000),
  ('social', 'Company social posts', 'social', 'Social', 'short', 700)
on conflict (id) do nothing;

-- Publishing is a simulation for now: the only mode and the only status the table accepts. A real connection needs its own migration.
create table if not exists recruiting.posting_publication (
  id bigint generated always as identity primary key,
  posting_id bigint not null references recruiting.job_posting (id),
  channel_id text not null references recruiting.posting_channel (id),
  mode text not null check (mode = 'mock'),
  status text not null check (status = 'simulated'),
  chars integer not null check (chars between 1 and 50000),
  published_by text not null check (published_by ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  published_at timestamptz not null default now(),
  unique (posting_id, channel_id)
);

create table if not exists recruiting.posting_event (
  id bigint generated always as identity primary key,
  posting_id bigint not null references recruiting.job_posting (id),
  event text not null check (event in ('drafted', 'edited', 'submitted', 'sent_back', 'released', 'published', 'withdrawn')),
  actor text not null check (actor ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 300)
);

alter table recruiting.posting_setting enable row level security;
alter table recruiting.posting_template enable row level security;
alter table recruiting.job_posting enable row level security;
alter table recruiting.posting_channel enable row level security;
alter table recruiting.posting_publication enable row level security;
alter table recruiting.posting_event enable row level security;
revoke all on recruiting.posting_setting, recruiting.posting_template, recruiting.job_posting, recruiting.posting_channel, recruiting.posting_publication, recruiting.posting_event from anon, authenticated;

create or replace function recruiting.posting_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'the posting log and the publications are append only: an entry cannot be changed or removed';
end $$;
drop trigger if exists posting_event_no_change on recruiting.posting_event;
create trigger posting_event_no_change before update or delete on recruiting.posting_event for each row execute function recruiting.posting_append_only();
drop trigger if exists posting_publication_no_change on recruiting.posting_publication;
create trigger posting_publication_no_change before update or delete on recruiting.posting_publication for each row execute function recruiting.posting_append_only();

-- The company standard: not changeable, not removable. Saved templates come and go.
create or replace function recruiting.posting_template_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.kind = 'standard' and (tg_op = 'DELETE' or new.sections is distinct from old.sections or new.name is distinct from old.name or new.kind is distinct from old.kind) then
    raise exception 'the company standard template cannot be changed or removed';
  end if;
  if tg_op = 'UPDATE' and old.kind = 'saved' and (new.sections is distinct from old.sections or new.name is distinct from old.name) then
    raise exception 'a saved template cannot be edited: save a new one';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists posting_template_guard_trg on recruiting.posting_template;
create trigger posting_template_guard_trg before update or delete on recruiting.posting_template for each row execute function recruiting.posting_template_guard();

-- A released or withdrawn posting keeps its text. A posting is never removed.
create or replace function recruiting.job_posting_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a posting cannot be removed'; end if;
  if old.status in ('released', 'withdrawn') and (new.sections is distinct from old.sections or new.title is distinct from old.title
     or new.template_id is distinct from old.template_id or new.requisition_id is distinct from old.requisition_id) then
    raise exception 'a released posting cannot be edited: withdraw it and write a new one';
  end if;
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then raise exception 'a withdrawn posting stays withdrawn'; end if;
  return new;
end $$;
drop trigger if exists job_posting_guard_trg on recruiting.job_posting;
create trigger job_posting_guard_trg before update or delete on recruiting.job_posting for each row execute function recruiting.job_posting_guard();

-- The company standard (sample text, fictional). Replace the text with the real template before real use.
insert into recruiting.posting_template (name, kind, owner_email, shared, sections)
select 'SAP standard (sample)', 'standard', null, true, $json$[{"key": "title", "label": "Job title", "locked": false, "text": "{{title}} (m/f/d)"}, {"key": "intro", "label": "About us", "locked": true, "text": "{{company}} keeps goods moving across Europe: warehouses, transport planning and customer service, run by people who like solving practical problems. We build the tools that keep them in sync."}, {"key": "role", "label": "Your role", "locked": false, "text": "You report to {{team}} ({{dept}}, {{location}}).\n{{role}}"}, {"key": "must", "label": "What you bring", "locked": false, "text": "{{must}}"}, {"key": "nice", "label": "Nice to have", "locked": false, "text": "{{nice}}"}, {"key": "offer", "label": "What we offer", "locked": false, "text": "A permanent contract, a training budget and a team that shares what it knows."}, {"key": "pay", "label": "Pay range", "locked": false, "text": "{{pay}}"}, {"key": "inclusion", "label": "Equal opportunities", "locked": true, "text": "{{company}} welcomes applications from everyone. We decide on skills and experience. If you need adjustments in the application process, tell us and we will arrange them."}, {"key": "apply", "label": "How to apply", "locked": false, "text": "Apply with your CV through our career portal: {{apply}}"}]$json$::jsonb
where not exists (select 1 from recruiting.posting_template where kind = 'standard');

-- ---------- checks ----------
create or replace function recruiting.posting_structure_issue(p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare e jsonb; v_keys text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' then return 'sections must be a list'; end if;
  if jsonb_array_length(p) not between 2 and 20 then return 'a posting has 2 to 20 sections'; end if;
  for e in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' then return 'each section must be an object'; end if;
    if coalesce(e->>'key', '') !~ '^[a-z][a-z0-9_]{0,30}$' then return 'a section needs a key such as "title" or "role"'; end if;
    if char_length(coalesce(e->>'label', '')) not between 1 and 60 then return 'a section needs a label of up to 60 characters'; end if;
    if jsonb_typeof(e->'text') <> 'string' or char_length(e->>'text') > 4000 then return 'the text of a section is up to 4000 characters'; end if;
    if e ? 'locked' and jsonb_typeof(e->'locked') <> 'boolean' then return 'locked must be true or false'; end if;
    if (e->>'key') = any (v_keys) then return 'section keys must be unique'; end if;
    v_keys := v_keys || (e->>'key');
  end loop;
  if not ('title' = any (v_keys)) then return 'a posting needs a "title" section'; end if;
  return null;
end $$;

-- p_strict: also refuse an empty field (a {{field}} left in the text; {{apply}} is filled per channel).
create or replace function recruiting.posting_content_issue(p jsonb, p_strict boolean)
returns text language plpgsql stable set search_path = '' as $$
declare e jsonb; v_text text; v_label text;
begin
  for e in select * from jsonb_array_elements(p) loop
    v_text := e->>'text'; v_label := e->>'label';
    if werkbank.find_secret(v_text) is not null then return format('"%s" looks like it contains a credential', v_label); end if;
    if (e->>'key') = 'title' and v_text !~* '\((m/f/d|m/w/d|f/m/d|w/m/d|all genders|gn)\)' then return 'the title needs a gender-neutral marker such as (m/f/d)'; end if;
    if coalesce((e->>'locked')::boolean, false) = false
       and v_text ~* '\y(age|aged|young|younger|older|gender|sex|sexual|nationality|ethnicity|ethnic|religion|religious|marital|married|pregnant|pregnancy|disability|photo|born|alter|geschlecht|staatsangeh\w*|familienstand|schwanger\w*|behinderung|digital natives?|junges team|young team)\y' then
      return format('"%s" names a personal trait: describe the work and the skills instead', v_label);
    end if;
    if p_strict and regexp_replace(v_text, '\{\{\s*apply\s*\}\}', '', 'g') ~ '\{\{\s*[a-z_]+\s*\}\}' then return format('"%s" still has an empty field', v_label); end if;
  end loop;
  return null;
end $$;

-- The locked sections of a base (template) must be in p word for word. p_company replaces {{company}} when a posting is checked.
create or replace function recruiting.posting_locks_issue(p jsonb, p_base jsonb, p_company text)
returns text language plpgsql stable set search_path = '' as $$
declare b jsonb; v_want text; v_got text;
begin
  for b in select * from jsonb_array_elements(p_base) where coalesce((value->>'locked')::boolean, false) loop
    v_want := case when p_company is null then b->>'text' else replace(b->>'text', '{{company}}', p_company) end;
    select x->>'text' into v_got from jsonb_array_elements(p) x where x->>'key' = b->>'key';
    if v_got is distinct from v_want then return format('"%s" is a locked section of the template and cannot be changed', b->>'label'); end if;
  end loop;
  return null;
end $$;

create or replace function recruiting.posting_actor_ok(p_actor text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
end $$;

create or replace function recruiting.posting_is_manager(p_requisition text, p_actor text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from recruiting.requisition r where r.id = p_requisition and lower(r.manager_email) = lower(p_actor))
$$;

-- ---------- templates ----------
create or replace function public.recruiting_posting_context(p_actor text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform recruiting.posting_actor_ok(p_actor);
  return jsonb_build_object(
    'company', (select value from recruiting.posting_setting where key = 'company'),
    'applyBase', (select value from recruiting.posting_setting where key = 'apply_base'),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'source', c.source, 'format', c.format, 'limit', c.char_limit) order by c.id)
                            from recruiting.posting_channel c where c.active), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind, 'owner', t.owner_email, 'shared', t.shared,
                    'uses', t.uses, 'lastUsed', to_char(t.last_used, 'YYYY-MM-DD'), 'basedOn', t.based_on, 'sections', t.sections) order by t.kind desc, t.name)
                    from recruiting.posting_template t where t.kind = 'standard' or t.shared or lower(t.owner_email) = lower(p_actor)), '[]'::jsonb));
end $$;

create or replace function public.recruiting_posting_template_save(p_actor text, p_name text, p_sections jsonb, p_shared boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, '')); v_std recruiting.posting_template; v_issue text; v_id bigint;
begin
  perform recruiting.posting_actor_ok(p_actor);
  if char_length(v_name) not between 1 and 80 then raise exception 'the template needs a name of up to 80 characters'; end if;
  select * into v_std from recruiting.posting_template where kind = 'standard';
  if not found then raise exception 'there is no company standard template'; end if;
  v_issue := coalesce(recruiting.posting_structure_issue(p_sections), recruiting.posting_content_issue(p_sections, false), recruiting.posting_locks_issue(p_sections, v_std.sections, null));
  if v_issue is not null then raise exception '%', v_issue; end if;
  if exists (select 1 from recruiting.posting_template where lower(owner_email) = lower(p_actor) and lower(name) = lower(v_name)) then
    raise exception 'you already have a template with this name';
  end if;
  insert into recruiting.posting_template (name, kind, owner_email, shared, sections, based_on)
  values (v_name, 'saved', lower(p_actor), coalesce(p_shared, false), p_sections, v_std.id) returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'shared', coalesce(p_shared, false));
end $$;

-- Main process only (not a tool): remove an own saved template that no posting uses.
create or replace function public.recruiting_posting_template_delete(p_actor text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_t recruiting.posting_template;
begin
  perform recruiting.posting_actor_ok(p_actor);
  select * into v_t from recruiting.posting_template where id = p_id;
  if not found then raise exception 'unknown template'; end if;
  if v_t.kind = 'standard' then raise exception 'the company standard template cannot be changed or removed'; end if;
  if lower(v_t.owner_email) <> lower(p_actor) then raise exception 'only the owner can remove a template'; end if;
  if exists (select 1 from recruiting.job_posting where template_id = p_id) then raise exception 'the template is used by a posting and cannot be removed'; end if;
  delete from recruiting.posting_template where id = p_id;
  return jsonb_build_object('id', p_id, 'removed', true);
end $$;

-- ---------- postings ----------
create or replace function public.recruiting_posting_create(p_actor text, p_requisition text, p_template bigint, p_sections jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_t recruiting.posting_template; v_issue text; v_id bigint; v_title text;
begin
  perform recruiting.posting_actor_ok(p_actor);
  if not recruiting.can_see(p_requisition, p_actor) then raise exception 'unknown requisition or no access'; end if;
  if not exists (select 1 from recruiting.requisition where id = p_requisition and status = 'open') then raise exception 'the requisition is not open'; end if;
  select * into v_t from recruiting.posting_template t where t.id = p_template and (t.kind = 'standard' or t.shared or lower(t.owner_email) = lower(p_actor));
  if not found then raise exception 'unknown template or no access'; end if;
  v_issue := coalesce(recruiting.posting_structure_issue(p_sections), recruiting.posting_content_issue(p_sections, false),
    recruiting.posting_locks_issue(p_sections, v_t.sections, (select value from recruiting.posting_setting where key = 'company')));
  if v_issue is not null then raise exception '%', v_issue; end if;
  select x->>'text' into v_title from jsonb_array_elements(p_sections) x where x->>'key' = 'title';
  insert into recruiting.job_posting (requisition_id, template_id, title, sections, created_by)
  values (p_requisition, p_template, left(v_title, 200), p_sections, lower(p_actor)) returning id into v_id;
  insert into recruiting.posting_event (posting_id, event, actor) values (v_id, 'drafted', lower(p_actor));
  return jsonb_build_object('id', v_id, 'status', 'draft');
end $$;

create or replace function public.recruiting_posting_update(p_actor text, p_id bigint, p_sections jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p recruiting.job_posting; v_t recruiting.posting_template; v_issue text; v_title text;
begin
  perform recruiting.posting_actor_ok(p_actor);
  select * into v_p from recruiting.job_posting where id = p_id for update;
  if not found or not recruiting.can_see(v_p.requisition_id, p_actor) then raise exception 'unknown posting or no access'; end if;
  if v_p.status <> 'draft' then raise exception 'only a draft can be edited'; end if;
  select * into v_t from recruiting.posting_template where id = v_p.template_id;
  v_issue := coalesce(recruiting.posting_structure_issue(p_sections), recruiting.posting_content_issue(p_sections, false),
    recruiting.posting_locks_issue(p_sections, v_t.sections, (select value from recruiting.posting_setting where key = 'company')));
  if v_issue is not null then raise exception '%', v_issue; end if;
  select x->>'text' into v_title from jsonb_array_elements(p_sections) x where x->>'key' = 'title';
  update recruiting.job_posting set sections = p_sections, title = left(v_title, 200), updated_at = now() where id = p_id;
  insert into recruiting.posting_event (posting_id, event, actor) values (p_id, 'edited', lower(p_actor));
  return jsonb_build_object('id', p_id, 'status', 'draft');
end $$;

create or replace function public.recruiting_postings_list(p_actor text, p_status text default null, p_requisition text default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean;
begin
  perform recruiting.posting_actor_ok(p_actor);
  if p_status is not null and p_status not in ('draft', 'in_review', 'released', 'withdrawn') then raise exception 'status must be draft, in_review, released or withdrawn'; end if;
  v_all := skills.is_board_admin(p_actor);
  return coalesce((select jsonb_agg(x order by (x->>'updatedAt') desc) from (
    select jsonb_build_object('id', j.id, 'requisition', j.requisition_id, 'template', j.template_id, 'title', j.title, 'status', j.status,
             'sections', j.sections, 'createdBy', j.created_by, 'updatedAt', j.updated_at, 'releasedBy', j.released_by, 'releasedAt', j.released_at,
             'publications', coalesce((select jsonb_agg(jsonb_build_object('channel', b.channel_id, 'mode', b.mode, 'status', b.status, 'at', b.published_at) order by b.channel_id)
                                         from recruiting.posting_publication b where b.posting_id = j.id), '[]'::jsonb)) as x
      from recruiting.job_posting j join recruiting.requisition r on r.id = j.requisition_id
     where (v_all or lower(r.manager_email) = lower(p_actor))
       and (p_status is null or j.status = p_status) and (p_requisition is null or j.requisition_id = p_requisition)
     order by j.updated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end $$;

-- Joule (or the person) sends a draft to the hiring manager. Nothing becomes public.
create or replace function public.recruiting_posting_submit(p_actor text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p recruiting.job_posting; v_issue text;
begin
  perform recruiting.posting_actor_ok(p_actor);
  select * into v_p from recruiting.job_posting where id = p_id for update;
  if not found or not recruiting.can_see(v_p.requisition_id, p_actor) then raise exception 'unknown posting or no access'; end if;
  if v_p.status <> 'draft' then raise exception 'only a draft can be sent for review'; end if;
  v_issue := recruiting.posting_content_issue(v_p.sections, true);
  if v_issue is not null then raise exception '%', v_issue; end if;
  update recruiting.job_posting set status = 'in_review', updated_at = now() where id = p_id;
  insert into recruiting.posting_event (posting_id, event, actor) values (p_id, 'submitted', lower(p_actor));
  return jsonb_build_object('id', p_id, 'status', 'in_review');
end $$;

-- The hiring manager's steps. NOT tools of the agent: only the Werkbank's main process calls them after a click.
create or replace function public.recruiting_posting_send_back(p_actor text, p_id bigint, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p recruiting.job_posting;
begin
  perform recruiting.posting_actor_ok(p_actor);
  select * into v_p from recruiting.job_posting where id = p_id for update;
  if not found then raise exception 'unknown posting'; end if;
  if not recruiting.posting_is_manager(v_p.requisition_id, p_actor) then raise exception 'only the hiring manager of this requisition can send a posting back'; end if;
  if v_p.status <> 'in_review' then raise exception 'only a posting in review can be sent back'; end if;
  update recruiting.job_posting set status = 'draft', updated_at = now() where id = p_id;
  insert into recruiting.posting_event (posting_id, event, actor, note) values (p_id, 'sent_back', lower(p_actor), left(btrim(coalesce(p_note, '')), 300));
  return jsonb_build_object('id', p_id, 'status', 'draft');
end $$;

create or replace function public.recruiting_posting_release(p_actor text, p_id bigint, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p recruiting.job_posting; v_issue text;
begin
  perform recruiting.posting_actor_ok(p_actor);
  select * into v_p from recruiting.job_posting where id = p_id for update;
  if not found then raise exception 'unknown posting'; end if;
  if not recruiting.posting_is_manager(v_p.requisition_id, p_actor) then raise exception 'only the hiring manager of this requisition can release a posting'; end if;
  if v_p.status <> 'in_review' then raise exception 'only a posting in review can be released'; end if;
  v_issue := recruiting.posting_content_issue(v_p.sections, true);
  if v_issue is not null then raise exception '%', v_issue; end if;
  update recruiting.job_posting set status = 'released', released_by = lower(p_actor), released_at = now(), updated_at = now() where id = p_id;
  update recruiting.posting_template set uses = uses + 1, last_used = current_date where id = v_p.template_id;
  insert into recruiting.posting_event (posting_id, event, actor, note) values (p_id, 'released', lower(p_actor), left(btrim(coalesce(p_note, '')), 300));
  return jsonb_build_object('id', p_id, 'status', 'released');
end $$;

-- p_packages: [{"channel": "linkedin", "chars": 1038}, ...]. The caller builds the channel text; the database refuses a text above the limit.
-- Mock only: a row says "simulated", nothing is sent. Repeating the call for a channel that is done changes nothing.
create or replace function public.recruiting_posting_publish(p_actor text, p_id bigint, p_packages jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p recruiting.job_posting; e jsonb; v_c recruiting.posting_channel; v_n integer; v_done text[] := '{}';
begin
  perform recruiting.posting_actor_ok(p_actor);
  select * into v_p from recruiting.job_posting where id = p_id for update;
  if not found then raise exception 'unknown posting'; end if;
  if not recruiting.posting_is_manager(v_p.requisition_id, p_actor) then raise exception 'only the hiring manager of this requisition can publish a posting'; end if;
  if v_p.status <> 'released' then raise exception 'only a released posting can be published'; end if;
  if not exists (select 1 from recruiting.requisition where id = v_p.requisition_id and status = 'open') then raise exception 'the requisition is not open'; end if;
  if p_packages is null or jsonb_typeof(p_packages) <> 'array' or jsonb_array_length(p_packages) not between 1 and 10 then raise exception 'packages must be a list of 1 to 10 channels'; end if;
  for e in select * from jsonb_array_elements(p_packages) loop
    select * into v_c from recruiting.posting_channel where id = e->>'channel' and active;
    if not found then raise exception 'unknown or inactive channel: %', coalesce(e->>'channel', ''); end if;
    if jsonb_typeof(e->'chars') <> 'number' or (e->>'chars')::integer < 1 then raise exception 'chars must be a positive number for channel %', v_c.id; end if;
    if (e->>'chars')::integer > v_c.char_limit then raise exception '% accepts up to % characters, the text has %', v_c.name, v_c.char_limit, (e->>'chars')::integer; end if;
    insert into recruiting.posting_publication (posting_id, channel_id, mode, status, chars, published_by)
    values (p_id, v_c.id, 'mock', 'simulated', (e->>'chars')::integer, lower(p_actor)) on conflict (posting_id, channel_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_done := v_done || v_c.id; end if;
  end loop;
  if cardinality(v_done) > 0 then
    insert into recruiting.posting_event (posting_id, event, actor, note) values (p_id, 'published', lower(p_actor), left('simulated: ' || array_to_string(v_done, ', '), 300));
  end if;
  return jsonb_build_object('id', p_id, 'mode', 'mock', 'simulated', to_jsonb(v_done), 'note', 'Nothing was sent. No channel is connected.');
end $$;

create or replace function public.recruiting_posting_withdraw(p_actor text, p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p recruiting.job_posting; v_r text := left(btrim(coalesce(p_reason, '')), 300);
begin
  perform recruiting.posting_actor_ok(p_actor);
  if v_r = '' then raise exception 'a reason is required to withdraw a posting'; end if;
  select * into v_p from recruiting.job_posting where id = p_id for update;
  if not found then raise exception 'unknown posting'; end if;
  if not recruiting.posting_is_manager(v_p.requisition_id, p_actor) then raise exception 'only the hiring manager of this requisition can withdraw a posting'; end if;
  if v_p.status <> 'released' then raise exception 'only a released posting can be withdrawn'; end if;
  update recruiting.job_posting set status = 'withdrawn', updated_at = now() where id = p_id;
  insert into recruiting.posting_event (posting_id, event, actor, note) values (p_id, 'withdrawn', lower(p_actor), v_r);
  return jsonb_build_object('id', p_id, 'status', 'withdrawn');
end $$;

revoke all on function recruiting.posting_append_only(), recruiting.posting_template_guard(), recruiting.job_posting_guard(),
  recruiting.posting_structure_issue(jsonb), recruiting.posting_content_issue(jsonb, boolean), recruiting.posting_locks_issue(jsonb, jsonb, text),
  recruiting.posting_actor_ok(text), recruiting.posting_is_manager(text, text) from public, anon, authenticated;
revoke all on function
  public.recruiting_posting_context(text), public.recruiting_posting_template_save(text, text, jsonb, boolean), public.recruiting_posting_template_delete(text, bigint),
  public.recruiting_posting_create(text, text, bigint, jsonb), public.recruiting_posting_update(text, bigint, jsonb), public.recruiting_postings_list(text, text, text, integer),
  public.recruiting_posting_submit(text, bigint), public.recruiting_posting_send_back(text, bigint, text), public.recruiting_posting_release(text, bigint, text),
  public.recruiting_posting_publish(text, bigint, jsonb), public.recruiting_posting_withdraw(text, bigint, text) from public, anon, authenticated;
grant execute on function
  public.recruiting_posting_context(text), public.recruiting_posting_template_save(text, text, jsonb, boolean), public.recruiting_posting_template_delete(text, bigint),
  public.recruiting_posting_create(text, text, bigint, jsonb), public.recruiting_posting_update(text, bigint, jsonb), public.recruiting_postings_list(text, text, text, integer),
  public.recruiting_posting_submit(text, bigint), public.recruiting_posting_send_back(text, bigint, text), public.recruiting_posting_release(text, bigint, text),
  public.recruiting_posting_publish(text, bigint, jsonb), public.recruiting_posting_withdraw(text, bigint, text) to service_role;
