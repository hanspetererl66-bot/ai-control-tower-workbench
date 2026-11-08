-- Hiring approvals, part 3: the contract and the candidate's signature.
-- After the last approval (migration 031) the contract follows without a human step in between: the database writes the text from the
-- approved terms, n8n (examples/n8n-workflows/12-hiring-contract-signature.json) sends it to the e-signature service, and the service's
-- answer (signed, declined, expired) is written back here. The signed document itself is kept in this table, with its hash.
-- Nothing in this migration can approve or decline a hiring request, and nothing changes an approval.
--
-- Rules the database enforces (not n8n):
--  * A contract exists only for an APPROVED request, one per request. Its text comes from the approved terms and a fixed template;
--    the hash of the text is stored, so the version that was sent can be proven.
--  * The state runs one way: prepared -> sent -> signed | declined | expired. A final state cannot be changed or removed.
--  * An answer must name the envelope the contract was sent in. "Signed" needs the signed document; if the service names its hash,
--    the database recomputes it and the two must match. "Expired" is only accepted after the validity ended.
--  * The receipt holds the method and a reference of the service, no names and no contact data. The contract text holds a
--    placeholder for the candidate's name: the name stays in the recruiting system, not in the Werkbank.
--  * The log is the same append-only log as before (recruiting.hire_event) with five new events.
-- Only service_role can call the functions (n8n holds that key in its own credential store).

alter table recruiting.hire_event drop constraint if exists hire_event_event_check;
alter table recruiting.hire_event add constraint hire_event_event_check
  check (event in ('requested', 'approved', 'returned', 'declined', 'notified', 'reminded', 'escalated', 'informed',
                   'contract_prepared', 'contract_sent', 'contract_signed', 'contract_declined', 'contract_expired', 'contract_informed'));

create table if not exists recruiting.hire_contract (
  id bigint generated always as identity primary key,
  request_id bigint not null unique references recruiting.hire_request (id),
  status text not null default 'prepared' check (status in ('prepared', 'sent', 'signed', 'declined', 'expired')),
  template text not null default 'employment-v1',
  body text not null check (char_length(body) between 1 and 8000),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null default '' check (char_length(provider) <= 60),
  envelope_ref text not null default '' check (char_length(envelope_ref) <= 120),
  prepared_at timestamptz not null default now(),
  sent_at timestamptz,
  expires_at timestamptz,
  decided_at timestamptz,
  signed_at timestamptz,
  signed_document bytea check (signed_document is null or octet_length(signed_document) between 1 and 2097152),
  signed_sha256 text not null default '' check (signed_sha256 = '' or signed_sha256 ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null default '{}'::jsonb,
  check ((status = 'signed') = (signed_document is not null))
);
alter table recruiting.hire_contract enable row level security;
revoke all on recruiting.hire_contract from public, anon, authenticated;

create or replace function recruiting.hire_contract_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a contract cannot be removed'; end if;
  if old.status in ('signed', 'declined', 'expired') then raise exception 'a contract that has an outcome cannot be changed'; end if;
  if (new.id, new.request_id, new.template, new.body, new.body_sha256, new.prepared_at)
     is distinct from (old.id, old.request_id, old.template, old.body, old.body_sha256, old.prepared_at) then
    raise exception 'the text of a contract cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists hire_contract_guard on recruiting.hire_contract;
create trigger hire_contract_guard before update or delete on recruiting.hire_contract for each row execute function recruiting.hire_contract_guard();

-- The text. A fixed template filled from the approved terms; no salary figure and no name exist in the Werkbank.
-- The wording is a PLACEHOLDER: the legal department replaces the template before real use.
create or replace function recruiting.hire_contract_text(p_request bigint)
returns text language plpgsql stable set search_path = '' as $$
declare h recruiting.hire_request; r recruiting.requisition; v_when text;
begin
  select * into h from recruiting.hire_request where id = p_request;
  select * into r from recruiting.requisition where id = h.requisition_id;
  select to_char(h.decided_at at time zone 'UTC', 'YYYY-MM-DD') into v_when;
  return concat_ws(E'\n',
    'EMPLOYMENT CONTRACT - DRAFT TEMPLATE employment-v1 (wording to be replaced by the legal department before real use)',
    'Reference: HIRE-' || h.id,
    'Position: ' || r.title || ' (' || r.id || '), department ' || r.dept,
    'Employee: {{candidate_name}} (record ' || h.candidate_id || ')',
    'Level and band: ' || (h.terms->>'level') || ', ' || (h.terms->>'band'),
    'Type of contract: ' || (h.terms->>'contract'),
    'Start date: ' || (h.terms->>'start_on'),
    'Compensation: as defined for the band above and confirmed in the offer letter. No amount is stored in the Werkbank.',
    case when coalesce(h.terms->>'note', '') <> '' then 'Note: ' || (h.terms->>'note') end,
    'Approved on ' || v_when || ' by the hiring manager, HR, finance' || case when exists (select 1 from recruiting.hire_step s where s.request_id = h.id and s.role = 'department_head') then ' and the department head' else '' end || '.',
    'Signature of the employee: electronic signature through the e-signature service.');
end $$;

-- What the workflow has to do next. The database decides; the workflow only carries it out.
--  prepare  the request is approved and has no contract yet (approved within the last 30 days)
--  send     the contract is prepared: the text, its hash and the facts the e-signature service needs
--  expire   the contract was sent and its validity ended without an answer
--  tell     the outcome is known: the requester and, after a signature, HR are told (once each)
create or replace function public.recruiting_hire_contract_due(p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((select jsonb_agg(x order by (x->>'id')::bigint, x->>'kind', x->>'to') from (
    select jsonb_build_object('kind', 'prepare', 'id', h.id, 'requisition', h.requisition_id, 'title', r.title, 'dept', r.dept, 'candidate', h.candidate_id) as x
      from recruiting.hire_request h join recruiting.requisition r on r.id = h.requisition_id
     where h.status = 'approved' and h.decided_at > p_now - interval '30 days'
       and not exists (select 1 from recruiting.hire_contract c where c.request_id = h.id)
    union all
    select jsonb_build_object('kind', 'send', 'id', h.id, 'requisition', h.requisition_id, 'title', r.title, 'dept', r.dept, 'candidate', h.candidate_id,
                              'startOn', h.terms->>'start_on', 'body', c.body, 'bodySha256', c.body_sha256, 'template', c.template)
      from recruiting.hire_contract c join recruiting.hire_request h on h.id = c.request_id join recruiting.requisition r on r.id = h.requisition_id
     where c.status = 'prepared'
    union all
    select jsonb_build_object('kind', 'expire', 'id', h.id, 'requisition', h.requisition_id, 'title', r.title, 'dept', r.dept, 'candidate', h.candidate_id,
                              'envelope', c.envelope_ref, 'provider', c.provider, 'expiresAt', c.expires_at)
      from recruiting.hire_contract c join recruiting.hire_request h on h.id = c.request_id join recruiting.requisition r on r.id = h.requisition_id
     where c.status = 'sent' and c.expires_at <= p_now
    union all
    select jsonb_build_object('kind', 'tell', 'id', h.id, 'to', t.recipient, 'role', t.role, 'requisition', h.requisition_id, 'title', r.title, 'dept', r.dept,
                              'candidate', h.candidate_id, 'outcome', c.status, 'at', c.decided_at)
      from recruiting.hire_contract c join recruiting.hire_request h on h.id = c.request_id join recruiting.requisition r on r.id = h.requisition_id
      cross join lateral (
        select lower(h.created_by) as recipient, 'hiring_manager'::text as role
        union all
        select s.approver, s.role from recruiting.hire_step s where s.request_id = h.id and s.role = 'hr' and c.status = 'signed'
      ) t
     where c.status in ('signed', 'declined', 'expired') and c.decided_at > p_now - interval '14 days'
       and not exists (select 1 from recruiting.hire_event e where e.request_id = h.id and e.event = 'contract_informed' and e.actor = t.recipient)
  ) u), '[]'::jsonb);
end $$;

-- Step 1: the contract text from the approved terms. Repeating the call changes nothing (created = false).
create or replace function public.recruiting_hire_contract_prepare(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_h recruiting.hire_request; v_body text; v_cid bigint;
begin
  select * into v_h from recruiting.hire_request where id = p_id for update;
  if not found then raise exception 'unknown hiring request'; end if;
  if v_h.status <> 'approved' then raise exception 'a contract needs an approved hiring request (this one is %)', v_h.status; end if;
  select id into v_cid from recruiting.hire_contract where request_id = p_id;
  if found then return jsonb_build_object('id', p_id, 'contract', v_cid, 'status', (select status from recruiting.hire_contract where id = v_cid), 'created', false); end if;
  v_body := recruiting.hire_contract_text(p_id);
  insert into recruiting.hire_contract (request_id, body, body_sha256) values (p_id, v_body, encode(sha256(convert_to(v_body, 'UTF8')), 'hex')) returning id into v_cid;
  insert into recruiting.hire_event (request_id, event, role, actor, note) values (p_id, 'contract_prepared', '', 'system@werkbank.invalid', 'template employment-v1');
  return jsonb_build_object('id', p_id, 'contract', v_cid, 'status', 'prepared', 'created', true);
end $$;

-- Step 2: the contract went out. p_ref is the envelope id of the e-signature service; a later answer has to name it.
create or replace function public.recruiting_hire_contract_sent(p_id bigint, p_provider text, p_ref text, p_valid_days integer default 14)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c recruiting.hire_contract; v_provider text := left(btrim(coalesce(p_provider, '')), 60); v_ref text := left(btrim(coalesce(p_ref, '')), 120);
begin
  if v_provider = '' or v_ref = '' then raise exception 'the provider and the envelope reference are needed'; end if;
  if p_valid_days is null or p_valid_days < 1 or p_valid_days > 60 then raise exception 'the validity must be between 1 and 60 days'; end if;
  if werkbank.find_secret(v_provider || ' ' || v_ref) is not null then raise exception 'the provider and the reference look like they contain a credential'; end if;
  select * into c from recruiting.hire_contract where request_id = p_id for update;
  if not found then raise exception 'no contract has been prepared for this request'; end if;
  if c.status = 'sent' and c.envelope_ref = v_ref then return jsonb_build_object('id', p_id, 'status', 'sent', 'created', false); end if;
  if c.status <> 'prepared' then raise exception 'the contract is already % and cannot be sent again', c.status; end if;
  update recruiting.hire_contract set status = 'sent', provider = v_provider, envelope_ref = v_ref, sent_at = now(), expires_at = now() + make_interval(days => p_valid_days) where id = c.id;
  insert into recruiting.hire_event (request_id, event, role, actor, note) values (p_id, 'contract_sent', '', 'system@werkbank.invalid', v_provider);
  return jsonb_build_object('id', p_id, 'status', 'sent', 'created', true, 'expiresAt', (select expires_at from recruiting.hire_contract where id = c.id));
end $$;

-- Step 3: the answer of the e-signature service. p_document is the signed document as base64; p_sha256 (optional) is the service's hash of it.
create or replace function public.recruiting_hire_contract_result(
  p_id bigint, p_ref text, p_result text, p_signed_at timestamptz default null, p_document text default null, p_sha256 text default null, p_receipt jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c recruiting.hire_contract; v_doc bytea; v_hash text; v_receipt jsonb := '{}'::jsonb; k text; v_event text;
begin
  if p_result is null or p_result not in ('signed', 'declined', 'expired') then raise exception 'the result must be signed, declined or expired'; end if;
  select * into c from recruiting.hire_contract where request_id = p_id for update;
  if not found then raise exception 'no contract has been prepared for this request'; end if;
  if c.status in ('signed', 'declined', 'expired') then
    if c.status = p_result and c.envelope_ref = btrim(coalesce(p_ref, '')) then return jsonb_build_object('id', p_id, 'status', c.status, 'created', false); end if;
    raise exception 'the contract already has an outcome (%)', c.status;
  end if;
  if c.status <> 'sent' then raise exception 'the contract has not been sent yet'; end if;
  if c.envelope_ref <> btrim(coalesce(p_ref, '')) then raise exception 'this answer names another envelope than the one the contract was sent in'; end if;

  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object' then raise exception 'the receipt must be an object'; end if;
  for k in select jsonb_object_keys(p_receipt) loop
    if k not in ('method', 'reference', 'level') then raise exception 'the receipt may only hold method, reference and level'; end if;
    if jsonb_typeof(p_receipt->k) <> 'string' or char_length(p_receipt->>k) > 120 then raise exception 'receipt values are short texts'; end if;
    if werkbank.find_secret(p_receipt->>k) is not null then raise exception 'the receipt looks like it contains a credential'; end if;
    v_receipt := v_receipt || jsonb_build_object(k, p_receipt->>k);
  end loop;

  if p_result = 'signed' then
    if p_document is null or btrim(p_document) = '' then raise exception 'a signed contract needs the signed document'; end if;
    if length(p_document) > 2900000 then raise exception 'the signed document is larger than 2 MB'; end if;
    begin v_doc := decode(p_document, 'base64'); exception when others then raise exception 'the signed document is not valid base64'; end;
    if octet_length(v_doc) = 0 or octet_length(v_doc) > 2097152 then raise exception 'the signed document must be between 1 byte and 2 MB'; end if;
    v_hash := encode(sha256(v_doc), 'hex');
    if p_sha256 is not null and lower(btrim(p_sha256)) <> v_hash then raise exception 'the hash of the signed document does not match the document'; end if;
    if p_signed_at is null or p_signed_at < c.sent_at - interval '1 minute' or p_signed_at > now() + interval '5 minutes' then
      raise exception 'the time of the signature must lie between sending and now';
    end if;
    update recruiting.hire_contract set status = 'signed', decided_at = now(), signed_at = p_signed_at, signed_document = v_doc, signed_sha256 = v_hash, receipt = v_receipt where id = c.id;
  elsif p_result = 'declined' then
    update recruiting.hire_contract set status = 'declined', decided_at = now(), receipt = v_receipt where id = c.id;
  else
    if c.expires_at > now() then raise exception 'the contract is valid until %', to_char(c.expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'); end if;
    update recruiting.hire_contract set status = 'expired', decided_at = now(), receipt = v_receipt where id = c.id;
  end if;
  v_event := case p_result when 'signed' then 'contract_signed' when 'declined' then 'contract_declined' else 'contract_expired' end;
  insert into recruiting.hire_event (request_id, event, role, actor, note) values (p_id, v_event, '', 'system@werkbank.invalid', c.provider);
  return jsonb_build_object('id', p_id, 'status', p_result, 'created', true, 'sha256', nullif(v_hash, ''));
end $$;

-- The record that the outcome was reported to a person. Only the persons the rules name; a repeat does nothing.
create or replace function public.recruiting_hire_contract_notice_record(p_id bigint, p_to text, p_channel text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c recruiting.hire_contract; h recruiting.hire_request; v_to text := lower(coalesce(p_to, '')); v_note text := left(btrim(coalesce(p_channel, '')), 300);
begin
  if v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'the recipient must be an e-mail address'; end if;
  select * into c from recruiting.hire_contract where request_id = p_id for update;
  if not found then raise exception 'no contract has been prepared for this request'; end if;
  if c.status not in ('signed', 'declined', 'expired') then raise exception 'the contract has no outcome yet'; end if;
  select * into h from recruiting.hire_request where id = p_id;
  if not (lower(h.created_by) = v_to or (c.status = 'signed' and exists (select 1 from recruiting.hire_step s where s.request_id = p_id and s.role = 'hr' and s.approver = v_to))) then
    raise exception 'this person is not a recipient of the outcome';
  end if;
  if exists (select 1 from recruiting.hire_event e where e.request_id = p_id and e.event = 'contract_informed' and e.actor = v_to) then
    return jsonb_build_object('id', p_id, 'event', 'contract_informed', 'created', false);
  end if;
  if werkbank.find_secret(v_note) is not null then v_note := '[note removed: it looked like it contained a credential]'; end if;
  insert into recruiting.hire_event (request_id, event, role, actor, note) values (p_id, 'contract_informed', '', v_to, v_note);
  return jsonb_build_object('id', p_id, 'event', 'contract_informed', 'created', true);
end $$;

-- Reading. Same circle as the requests: the hiring manager, the approvers and the Governance board.
-- The list is replaced by the version of migration 031 plus one field, 'contract' (the state, never the text or the document).
create or replace function public.recruiting_hire_requests_list(p_actor text, p_status text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_all boolean;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'returned', 'declined') then raise exception 'status must be pending, approved, returned or declined'; end if;
  v_all := skills.is_board_admin(p_actor);
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object(
             'id', h.id, 'requisition', h.requisition_id, 'title', r.title, 'dept', r.dept, 'candidate', h.candidate_id,
             'terms', h.terms, 'evidence', h.evidence, 'status', h.status, 'currentStep', h.current_step,
             'createdBy', h.created_by, 'at', h.created_at, 'decidedAt', h.decided_at,
             'mine', h.status = 'pending' and exists (select 1 from recruiting.hire_step s where s.request_id = h.id and s.ord = h.current_step and s.approver = lower(p_actor)),
             'steps', (select jsonb_agg(jsonb_build_object('ord', s.ord, 'role', s.role, 'approver', s.approver, 'status', s.status, 'decidedAt', s.decided_at, 'note', s.note) order by s.ord)
                         from recruiting.hire_step s where s.request_id = h.id),
             'events', (select jsonb_agg(jsonb_build_object('event', e.event, 'role', e.role, 'actor', e.actor, 'at', e.at, 'note', e.note) order by e.id)
                          from recruiting.hire_event e where e.request_id = h.id),
             'contract', (select jsonb_build_object('status', c.status, 'template', c.template, 'bodySha256', c.body_sha256, 'provider', c.provider,
                                                    'preparedAt', c.prepared_at, 'sentAt', c.sent_at, 'expiresAt', c.expires_at, 'decidedAt', c.decided_at,
                                                    'signedAt', c.signed_at, 'signedSha256', c.signed_sha256, 'hasDocument', c.signed_document is not null,
                                                    'method', c.receipt->>'method')
                            from recruiting.hire_contract c where c.request_id = h.id)) as x
      from recruiting.hire_request h join recruiting.requisition r on r.id = h.requisition_id
     where (v_all or lower(r.manager_email) = lower(p_actor) or exists (select 1 from recruiting.hire_step s where s.request_id = h.id and s.approver = lower(p_actor)))
       and (p_status is null or h.status = p_status)
     order by h.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500)) t), '[]'::jsonb);
end $$;

-- The text and, after a signature, the signed document (base64) of one contract, for the people who may see the request.
create or replace function public.recruiting_hire_contract_get(p_actor text, p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c recruiting.hire_contract; h recruiting.hire_request; r recruiting.requisition;
begin
  if p_actor is null or p_actor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'actor must be an e-mail address'; end if;
  select * into h from recruiting.hire_request where id = p_id;
  if not found then raise exception 'unknown hiring request'; end if;
  select * into r from recruiting.requisition where id = h.requisition_id;
  if not (skills.is_board_admin(p_actor) or lower(r.manager_email) = lower(p_actor)
          or exists (select 1 from recruiting.hire_step s where s.request_id = p_id and s.approver = lower(p_actor))) then
    raise exception 'you may not see this hiring request';
  end if;
  select * into c from recruiting.hire_contract where request_id = p_id;
  if not found then raise exception 'no contract has been prepared for this request'; end if;
  return jsonb_build_object('id', p_id, 'status', c.status, 'body', c.body, 'bodySha256', c.body_sha256, 'signedSha256', c.signed_sha256,
                            'signedDocument', case when c.signed_document is null then null else encode(c.signed_document, 'base64') end);
end $$;

revoke all on function recruiting.hire_contract_guard(), recruiting.hire_contract_text(bigint) from public, anon, authenticated;
revoke all on function public.recruiting_hire_contract_due(timestamptz), public.recruiting_hire_contract_prepare(bigint),
  public.recruiting_hire_contract_sent(bigint, text, text, integer), public.recruiting_hire_contract_notice_record(bigint, text, text),
  public.recruiting_hire_contract_result(bigint, text, text, timestamptz, text, text, jsonb), public.recruiting_hire_contract_get(text, bigint),
  public.recruiting_hire_requests_list(text, text, integer) from public, anon, authenticated;
grant execute on function public.recruiting_hire_contract_due(timestamptz), public.recruiting_hire_contract_prepare(bigint),
  public.recruiting_hire_contract_sent(bigint, text, text, integer), public.recruiting_hire_contract_notice_record(bigint, text, text),
  public.recruiting_hire_contract_result(bigint, text, text, timestamptz, text, text, jsonb), public.recruiting_hire_contract_get(text, bigint),
  public.recruiting_hire_requests_list(text, text, integer) to service_role;
