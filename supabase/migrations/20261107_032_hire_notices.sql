-- Hiring approvals, part 2: notices (n8n delivers, the database decides).
-- An n8n workflow (examples/n8n-workflows/11-hiring-approval-notices.json) runs on a schedule, asks WHAT IS DUE, sends the messages
-- and records that it did. The rules for "due" live here, not in n8n, so the workflow cannot skip a step, send to a person who is not
-- on the chain, or change a decision. Nothing in this migration can approve, return or decline a request.
--
--  * notify    the approver whose turn it is has not been told yet
--  * remind    no decision after p_remind_days since the last notice (at most p_max_reminders)
--  * escalate  the step is open for p_escalate_days: the requester is told (once); skipped when the requester is the approver
--  * inform    a request ended (approved, returned, declined): the requester is told, and HR after an approval (once each)
-- The record is an entry in the append-only log (events notified, reminded, escalated, informed) with the recipient as actor.
-- Only service_role can call the functions (n8n holds that key in its own credential store).

alter table recruiting.hire_event drop constraint if exists hire_event_event_check;
alter table recruiting.hire_event add constraint hire_event_event_check
  check (event in ('requested', 'approved', 'returned', 'declined', 'notified', 'reminded', 'escalated', 'informed'));

create or replace function public.recruiting_hire_due(p_now timestamptz default now(), p_remind_days integer default 2,
                                                      p_escalate_days integer default 5, p_max_reminders integer default 3)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_remind_days is null or p_remind_days < 1 or p_escalate_days is null or p_escalate_days < 1 or p_max_reminders is null or p_max_reminders < 0 then
    raise exception 'remind days and escalate days must be at least 1, reminders at least 0';
  end if;
  return coalesce((select jsonb_agg(x order by (x->>'id')::bigint, x->>'kind') from (
    -- open steps: notify, remind, escalate
    select jsonb_build_object('kind', k.kind, 'id', c.id, 'to', k.recipient, 'role', c.role, 'step', c.ord, 'steps', c.total,
                              'requisition', c.requisition_id, 'title', c.title, 'dept', c.dept, 'candidate', c.candidate_id,
                              'since', c.since, 'approver', c.approver) as x
      from (
        select h.id, h.requisition_id, h.candidate_id, h.created_by, r.title, r.dept, s.role, s.approver, s.ord,
               (select count(*) from recruiting.hire_step t where t.request_id = h.id) as total,
               coalesce((select p.decided_at from recruiting.hire_step p where p.request_id = h.id and p.ord = s.ord - 1), h.created_at) as since,
               (select count(*) from recruiting.hire_event e where e.request_id = h.id and e.role = s.role and e.event = 'notified') as n_notified,
               (select count(*) from recruiting.hire_event e where e.request_id = h.id and e.role = s.role and e.event = 'reminded') as n_reminded,
               (select max(e.at) from recruiting.hire_event e where e.request_id = h.id and e.role = s.role and e.event in ('notified', 'reminded')) as last_notice,
               exists (select 1 from recruiting.hire_event e where e.request_id = h.id and e.role = s.role and e.event = 'escalated') as escalated
          from recruiting.hire_request h
          join recruiting.requisition r on r.id = h.requisition_id
          join recruiting.hire_step s on s.request_id = h.id and s.ord = h.current_step
         where h.status = 'pending') c
      cross join lateral (values
        ('notify', c.n_notified = 0, c.approver),
        ('remind', c.n_notified > 0 and c.n_reminded < p_max_reminders and p_now - c.last_notice >= make_interval(days => p_remind_days), c.approver),
        ('escalate', not c.escalated and p_now - c.since >= make_interval(days => p_escalate_days) and lower(c.created_by) <> c.approver, lower(c.created_by))
      ) as k(kind, due, recipient)
     where k.due
    union all
    -- ended requests: tell the requester, and HR after an approval
    select jsonb_build_object('kind', 'inform', 'id', h.id, 'to', t.recipient, 'role', t.role, 'step', h.current_step,
                              'steps', (select count(*) from recruiting.hire_step z where z.request_id = h.id),
                              'requisition', h.requisition_id, 'title', r.title, 'dept', r.dept, 'candidate', h.candidate_id,
                              'since', h.decided_at, 'status', h.status)
      from recruiting.hire_request h
      join recruiting.requisition r on r.id = h.requisition_id
      cross join lateral (
        select lower(h.created_by) as recipient, 'hiring_manager'::text as role
        union all
        select s.approver, s.role from recruiting.hire_step s where s.request_id = h.id and s.role = 'hr' and h.status = 'approved'
      ) t
     where h.status <> 'pending' and h.decided_at > p_now - interval '14 days'
       and not exists (select 1 from recruiting.hire_event e where e.request_id = h.id and e.event = 'informed' and e.actor = t.recipient)
  ) u), '[]'::jsonb);
end $$;

-- The record of a sent message. p_to must be the person the rules name for that kind; a repeated call does nothing (created = false).
create or replace function public.recruiting_hire_notice_record(p_id bigint, p_kind text, p_to text, p_channel text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_h recruiting.hire_request; v_s recruiting.hire_step; v_to text := lower(coalesce(p_to, '')); v_note text := left(btrim(coalesce(p_channel, '')), 300);
        v_event text; v_role text; v_recent timestamptz;
begin
  if p_kind is null or p_kind not in ('notify', 'remind', 'escalate', 'inform') then raise exception 'kind must be notify, remind, escalate or inform'; end if;
  if v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'the recipient must be an e-mail address'; end if;
  select * into v_h from recruiting.hire_request where id = p_id for update;
  if not found then raise exception 'unknown hiring request'; end if;
  if werkbank.find_secret(v_note) is not null then v_note := '[note removed: it looked like it contained a credential]'; end if;
  v_event := case p_kind when 'notify' then 'notified' when 'remind' then 'reminded' when 'escalate' then 'escalated' else 'informed' end;
  if p_kind = 'inform' then
    if v_h.status = 'pending' then raise exception 'the hiring request has not ended yet'; end if;
    select s.role into v_role from recruiting.hire_step s where s.request_id = p_id and s.approver = v_to and (s.role = 'hr' and v_h.status = 'approved' or lower(v_h.created_by) = v_to);
    if v_role is null and lower(v_h.created_by) = v_to then v_role := 'hiring_manager'; end if;
    if v_role is null then raise exception 'this person is not a recipient of the result'; end if;
    if exists (select 1 from recruiting.hire_event e where e.request_id = p_id and e.event = 'informed' and e.actor = v_to) then return jsonb_build_object('id', p_id, 'event', v_event, 'created', false); end if;
  else
    if v_h.status <> 'pending' then raise exception 'the hiring request is already decided'; end if;
    select * into v_s from recruiting.hire_step where request_id = p_id and ord = v_h.current_step;
    v_role := v_s.role;
    if p_kind = 'escalate' then
      if v_to <> lower(v_h.created_by) or v_s.approver = v_to then raise exception 'an escalation goes to the requester, and never when the requester is the approver'; end if;
      if exists (select 1 from recruiting.hire_event e where e.request_id = p_id and e.role = v_role and e.event = 'escalated') then return jsonb_build_object('id', p_id, 'event', v_event, 'created', false); end if;
    else
      if v_to <> v_s.approver then raise exception 'a notice goes to the approver whose turn it is'; end if;
      select max(e.at) into v_recent from recruiting.hire_event e where e.request_id = p_id and e.role = v_role and e.event in ('notified', 'reminded');
      if p_kind = 'notify' and exists (select 1 from recruiting.hire_event e where e.request_id = p_id and e.role = v_role and e.event = 'notified') then return jsonb_build_object('id', p_id, 'event', v_event, 'created', false); end if;
      if p_kind = 'remind' and (v_recent is null or v_recent > now() - interval '1 hour') then return jsonb_build_object('id', p_id, 'event', v_event, 'created', false); end if;
    end if;
  end if;
  insert into recruiting.hire_event (request_id, event, role, actor, note) values (p_id, v_event, v_role, v_to, v_note);
  return jsonb_build_object('id', p_id, 'event', v_event, 'created', true);
end $$;

revoke all on function public.recruiting_hire_due(timestamptz, integer, integer, integer), public.recruiting_hire_notice_record(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.recruiting_hire_due(timestamptz, integer, integer, integer), public.recruiting_hire_notice_record(bigint, text, text, text) to service_role;
