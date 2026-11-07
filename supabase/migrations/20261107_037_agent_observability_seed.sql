-- Agent observability: a generated, fictional history for the last 90 days (about 25,000 runs and 190,000 steps of 27 agents,
-- workflows and skills), so that the Space has something to show before the first real run is logged.
--
-- Everything here is invented. Names, owners (@example.com), systems and numbers are made up; the pseudonyms "u-0412" are random.
-- The data is deterministic: the same hash function decides every value, so applying this twice gives the same picture (the
-- second application does nothing, because the run history is append only and the script stops when it finds runs).
-- The picture is relative to the day it is applied ("9 days ago"), so the story always ends today.
--
-- Planted on purpose, so that the Space has things to find:
--   1. a runaway loop (Supplier delay scout, 9 days ago, afternoon): runs that hit the step limit and burned money
--   2. quality drift after a new version (Renewal watcher 1.4, 21 days ago): runs stay green, the outcome check falls
--   3. blocked writes (Payment proposal check, 3 to 5 days ago): postings above the approval limit stopped by policy
--   4. a connector incident (SAP query tool, 3 days ago, 14:00 to 17:30): timeouts and slow calls across several agents
--   5. a rise in escalations (HR policy assistant after 1.1), slower runs (IT ticket triage after 3.2), dearer runs (Margin analyst)
--   6. two agents that act without a person (autonomous), one that is hardly used (Travel expense helper), one retired agent
-- Nothing is stored about the content of any prompt or answer.

begin;

create or replace function observability.rnd(a bigint, b integer)
returns double precision language sql immutable set search_path = '' as $$
  select (abs(hashtextextended(a::text || ':' || b::text, 7) % 1000000) / 1000000.0)::double precision
$$;

create temp table obs_seed on commit drop as select not exists (select 1 from observability.run) as fresh;

-- ---------------------------------------------------------------------------------------------------------------------------
-- The fleet
-- ---------------------------------------------------------------------------------------------------------------------------
create temp table obs_def on commit drop as
select * from (values
  ('supplier-delay-scout', 'Supplier delay scout', 'agent', 'Procurement', 'anna.vogel@example.com', 'Joule Studio', 'claude-sonnet', '1.3', null, null, 'operational', 'draft', false, false, 84, null, 14, 'schedule', 0.955, 0.02, 5200, 5, 1, 0.30, 0.93, array['SAP S/4|sap_query', 'Databricks|sql_query', 'Web|web_search'], null),
  ('renewal-watcher', 'Renewal watcher', 'agent', 'Sales', 'jonas.keller@example.com', 'Joule Studio', 'claude-haiku', '1.4', '1.3', 21, 'operational', 'draft', false, false, 80, null, 16, 'schedule', 0.965, 0.02, 4100, 4, 1, 0.35, 0.94, array['CRM|crm_search', 'Databricks|sql_query', 'Mail|draft_email'], null),
  ('payment-proposal-check', 'Payment proposal check', 'agent', 'Finance', 'marla.hoff@example.com', 'Joule Studio', 'claude-sonnet', '2.0', null, null, 'critical', 'act-after-approval', true, false, 76, null, 9, 'event', 0.93, 0.04, 6800, 6, 1, 0.50, 0.96, array['SAP S/4|sap_query', 'SAP S/4|sap_get_invoice', 'Rules|policy_check'], 'SAP S/4|sap_post_document'),
  ('invoice-matching-bot', 'Invoice matching bot', 'agent', 'Finance', 'tim.brandt@example.com', 'Joule Studio', 'claude-haiku', '2.1', '2.0', 35, 'mission-critical', 'autonomous', true, true, 85, null, 40, 'schedule', 0.975, 0.01, 3200, 5, 1, 0.12, 0.97, array['SAP S/4|sap_query', 'Documents|read_pdf', 'SAP S/4|sap_get_invoice'], 'SAP S/4|sap_match_invoice'),
  ('close-calendar-assistant', 'Close calendar assistant', 'agent', 'Finance', 'dana.lorenz@example.com', 'Joule Chat', 'claude-haiku', '1.2', null, null, 'operational', 'draft', false, false, 70, null, 6, 'person', 0.96, 0.03, 4300, 4, 5, 0.30, 0.95, array['Calendar|calendar_read', 'Databricks|sql_query'], null),
  ('accrual-estimator', 'Accrual estimator', 'agent', 'Controlling', 'sven.maier@example.com', 'Joule Chat', 'claude-sonnet', '1.1', null, null, 'critical', 'draft', false, false, 52, null, 5, 'person', 0.94, 0.04, 9100, 6, 4, 0.50, 0.93, array['Databricks|sql_query', 'TabPFN|forecast_accruals'], null),
  ('gr-ir-clearer', 'GR/IR clearer', 'agent', 'Finance', 'marla.hoff@example.com', 'Joule Studio', 'claude-sonnet', '1.5', null, null, 'critical', 'act-after-approval', true, false, 66, null, 11, 'schedule', 0.94, 0.04, 7600, 7, 1, 0.40, 0.95, array['SAP S/4|sap_query', 'Databricks|sql_query'], 'SAP S/4|sap_post_document'),
  ('hr-policy-assistant', 'HR policy assistant', 'agent', 'HR', 'lea.neumann@example.com', 'Joule Chat', 'gpt-4.1', '1.1', '1.0', 14, 'operational', 'read-only', false, false, 60, null, 22, 'person', 0.84, 0.13, 2600, 3, 140, 0.20, 0.90, array['Intranet|search_policies', 'HR|read_handbook'], null),
  ('job-posting-drafter', 'Job posting drafter', 'agent', 'HR', 'lea.neumann@example.com', 'Joule Chat', 'claude-sonnet', '1.0', null, null, 'operational', 'draft', false, false, 28, null, 5, 'person', 0.95, 0.03, 8800, 5, 6, 0.40, 0.92, array['HR|read_template', 'ATS|read_job'], null),
  ('candidate-shortlister', 'Candidate shortlister', 'agent', 'HR', 'lea.neumann@example.com', 'Joule Studio', 'claude-sonnet', '1.2', null, null, 'critical', 'draft', false, false, 33, null, 8, 'person', 0.94, 0.04, 7400, 6, 7, 0.50, 0.94, array['ATS|read_candidates', 'HR|read_criteria'], null),
  ('it-ticket-triage', 'IT ticket triage', 'agent', 'IT', 'omar.said@example.com', 'Joule Studio', 'claude-haiku', '3.2', '3.1', 28, 'operational', 'act-after-approval', true, false, 88, null, 35, 'event', 0.96, 0.02, 2100, 3, 1, 0.10, 0.95, array['ServiceNow|snow_read_ticket', 'Intranet|search_kb'], 'ServiceNow|snow_update_ticket'),
  ('knowledge-base-tagger', 'Knowledge base tagger', 'agent', 'IT', 'omar.said@example.com', 'Joule Studio', 'gemini-flash', '1.0', null, null, 'administrative', 'autonomous', true, true, 45, null, 12, 'schedule', 0.98, 0.005, 1800, 3, 1, 0.05, 0.97, array['Intranet|search_kb'], 'Intranet|kb_add_tag'),
  ('sales-pipeline-brief', 'Sales pipeline brief', 'agent', 'Sales', 'jonas.keller@example.com', 'Joule Studio', 'claude-sonnet', '1.3', null, null, 'operational', 'read-only', false, false, 62, null, 4, 'schedule', 0.97, 0.02, 11200, 6, 1, 0.50, 0.93, array['CRM|crm_search', 'Databricks|sql_query'], null),
  ('quote-drafter', 'Quote drafter', 'agent', 'Sales', 'jonas.keller@example.com', 'Joule Chat', 'claude-sonnet', '2.2', null, null, 'operational', 'draft', false, false, 55, null, 12, 'person', 0.95, 0.035, 6200, 5, 22, 0.35, 0.92, array['CRM|crm_search', 'Pricing|price_lookup'], null),
  ('contract-clause-reviewer', 'Contract clause reviewer', 'agent', 'Legal', 'ines.baumann@example.com', 'Joule Chat', 'claude-sonnet', '1.0', null, null, 'critical', 'draft', false, false, 40, null, 7, 'person', 0.93, 0.05, 14200, 7, 9, 0.60, 0.91, array['DMS|read_contract', 'Legal|clause_library'], null),
  ('incident-summarizer', 'Incident summarizer', 'agent', 'IT', 'omar.said@example.com', 'Joule Studio', 'claude-haiku', '1.4', null, null, 'operational', 'read-only', false, false, 58, null, 18, 'event', 0.97, 0.02, 2900, 3, 1, 0.15, 0.94, array['ServiceNow|snow_read_ticket', 'Slack|slack_read_thread'], null),
  ('o2c-trace', 'Order-to-cash trace', 'agent', 'Finance', 'dana.lorenz@example.com', 'Joule Chat', 'claude-sonnet', '1.2', null, null, 'operational', 'read-only', false, false, 30, null, 13, 'person', 0.94, 0.03, 5800, 5, 18, 0.25, 0.93, array['SAP S/4|sap_query', 'SAP S/4|sap_get_invoice'], null),
  ('margin-analyst', 'Margin analyst', 'agent', 'Controlling', 'sven.maier@example.com', 'Joule Chat', 'claude-sonnet', '1.6', null, null, 'operational', 'read-only', false, false, 74, null, 10, 'person', 0.95, 0.03, 8300, 6, 11, 0.30, 0.92, array['Databricks|genie_ask', 'Databricks|sql_query'], null),
  ('intercompany-recon', 'Intercompany reconciliation', 'agent', 'Finance', 'tim.brandt@example.com', 'Joule Studio', 'claude-sonnet', '1.1', null, null, 'critical', 'act-after-approval', true, false, 48, null, 6, 'schedule', 0.93, 0.05, 10500, 8, 1, 0.50, 0.94, array['SAP S/4|sap_query', 'Databricks|sql_query'], 'SAP S/4|sap_post_document'),
  ('spend-anomaly-watch', 'Spend anomaly watch', 'agent', 'Controlling', 'sven.maier@example.com', 'Joule Studio', 'gemini-flash', '2.0', null, null, 'operational', 'read-only', false, false, 64, null, 24, 'schedule', 0.975, 0.01, 2400, 3, 1, 0.10, 0.96, array['Databricks|sql_query', 'ERP|read_spend'], null),
  ('onboarding-guide', 'Onboarding guide', 'agent', 'HR', 'lea.neumann@example.com', 'Joule Chat', 'gpt-4.1', '1.0', null, null, 'administrative', 'read-only', false, false, 35, null, 9, 'person', 0.96, 0.03, 2800, 3, 30, 0.15, 0.93, array['Intranet|search_policies', 'HR|read_handbook'], null),
  ('travel-expense-helper', 'Travel expense helper', 'agent', 'Finance', 'dana.lorenz@example.com', 'Joule Chat', 'claude-haiku', '1.0', null, null, 'administrative', 'draft', false, false, 85, null, 2.0, 'person', 0.95, 0.03, 3900, 4, 3, 0.30, 0.92, array['Expenses|read_receipts', 'Rules|policy_check'], null),
  ('legacy-ticket-router', 'Legacy ticket router', 'agent', 'IT', 'omar.said@example.com', 'Joule Studio', 'gpt-4.1', '0.9', null, null, 'operational', 'draft', false, false, 88, 40, 15, 'event', 0.91, 0.05, 2500, 3, 1, 0.10, 0.88, array['ServiceNow|snow_read_ticket'], null),
  ('customer-health-scout', 'Customer health scout', 'agent', 'Customer Success', 'ines.baumann@example.com', 'Joule Studio', 'claude-sonnet', '1.0', null, null, 'operational', 'draft', false, false, 18, null, 10, 'schedule', 0.93, 0.05, 7200, 6, 1, 0.45, 0.90, array['CRM|crm_search', 'Support|read_cases', 'Databricks|sql_query'], null),
  ('meeting-notes-workflow', 'Meeting notes workflow', 'workflow', 'Operations', 'felix.roth@example.com', 'n8n', 'claude-haiku', '1.7', null, null, 'administrative', 'draft', false, false, 78, null, 20, 'event', 0.97, 0.02, 3600, 4, 1, 0.08, 0.95, array['Calendar|calendar_read', 'Slack|slack_post_draft'], null),
  ('slack-thread-summary', 'Slack thread summary', 'skill', 'Operations', 'felix.roth@example.com', 'Joule Chat', 'claude-haiku', '1.2', null, null, 'administrative', 'read-only', false, false, 56, null, 14, 'person', 0.98, 0.015, 1900, 2, 52, 0.05, 0.95, array['Slack|slack_read_thread'], null),
  ('nightly-data-quality', 'Nightly data quality', 'workflow', 'Data', 'felix.roth@example.com', 'n8n', 'gemini-flash', '2.3', null, null, 'operational', 'draft', false, false, 80, null, 6, 'schedule', 0.90, 0.07, 15500, 8, 1, 0.40, 0.90, array['Databricks|sql_query', 'Databricks|dq_check'], null)
) as v(id, name, kind, dept, owner, platform, model, ver, prev_ver, switch_ago, crit, mode, writes, unatt, launched_ago, ended_ago, base, trig, p_ok, p_esc, dur_ms, steps_m, callers, samp, goal, tools, write_tool);

insert into observability.agent (agent_id, name, kind, department, owner, platform, model, version, criticality, policy_mode, writes, unattended, launched_on, retired)
select id, name, kind, dept, owner, platform, model, ver, crit, mode, writes, unatt, (now() at time zone 'Europe/Berlin')::date - launched_ago, ended_ago is not null
from obs_def on conflict (agent_id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Runs: how many per agent and day, at what time
-- ---------------------------------------------------------------------------------------------------------------------------
create temp table obs_r00 on commit drop as
select d.id, g.ago, s.i, k.key, h.hour, floor(observability.rnd(k.key, 3) * 60)::int as minute,
       ((dy.day::timestamp + make_interval(hours => h.hour, mins => floor(observability.rnd(k.key, 3) * 60)::int, secs => floor(observability.rnd(k.key, 4) * 60)::int)) at time zone 'Europe/Berlin') as started_at,
       null::text as story
from obs_def d
cross join generate_series(0, 89) as g(ago)
cross join lateral (select ((now() at time zone 'Europe/Berlin')::date - g.ago) as day) dy
cross join lateral (
  select round(d.base * 1.4
    * (case d.trig when 'schedule' then 1.0 when 'event' then (case when extract(isodow from dy.day) >= 6 then 0.55 else 1.0 end)
                   else (case when extract(isodow from dy.day) >= 6 then 0.12 else 1.0 end) end)
    * (case when d.launched_ago - g.ago < 10 then (d.launched_ago - g.ago + 1) / 10.0 else 1.0 end)
    * (0.85 + 0.15 * (1 - g.ago / 90.0))
    * (case when d.id = 'travel-expense-helper' then 0.3 + 0.7 * (g.ago / 85.0) else 1.0 end)
    * (0.8 + 0.4 * observability.rnd(hashtextextended(d.id, 3) + g.ago, 11)))::int as n
) cnt
cross join lateral generate_series(1, cnt.n) as s(i)
cross join lateral (select hashtextextended(d.id || ':' || g.ago || ':' || s.i, 1) as key) k
cross join lateral (
  select case d.trig
    when 'schedule' then (array[2, 3, 6, 9, 13, 14, 15, 16])[1 + (s.i % 8)]
    when 'event' then 6 + floor(14 * (observability.rnd(k.key, 1) + observability.rnd(k.key, 2)) / 2)::int
    else 7 + floor(11 * (observability.rnd(k.key, 1) + observability.rnd(k.key, 2)) / 2)::int end as hour
) h
where (select fresh from obs_seed) and g.ago <= d.launched_ago and g.ago >= coalesce(d.ended_ago, 0);

-- Story 1: the runaway loop. 36 extra runs of the Supplier delay scout, 9 days ago, between 13:00 and 15:59.
insert into obs_r00
select 'supplier-delay-scout', 9, 1000 + s.i, k.key, 13 + (s.i % 3), floor(observability.rnd(k.key, 3) * 60)::int,
       ((((now() at time zone 'Europe/Berlin')::date - 9)::timestamp + make_interval(hours => 13 + (s.i % 3), mins => floor(observability.rnd(k.key, 3) * 60)::int, secs => floor(observability.rnd(k.key, 4) * 60)::int)) at time zone 'Europe/Berlin'),
       'runaway'
from generate_series(1, 36) as s(i)
cross join lateral (select hashtextextended('runaway:' || s.i, 1) as key) k
where (select fresh from obs_seed);

delete from obs_r00 where started_at > now();

create temp table obs_r0 on commit drop as
select row_number() over (order by r.started_at, r.id, r.i)::bigint as run_id, r.id as agent_id, r.ago, r.i, r.key, r.hour, r.minute, r.started_at, r.story,
       d.name as agent_name, d.platform, d.model, d.mode, d.writes, d.trig, d.p_ok, d.p_esc, d.dur_ms, d.steps_m, d.callers, d.samp, d.goal,
       d.tools, d.write_tool, d.switch_ago, d.ver, d.prev_ver, (d.tools[1] = 'SAP S/4|sap_query') as sap
from obs_r00 r join obs_def d on d.id = r.id;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Outcome of each run
-- ---------------------------------------------------------------------------------------------------------------------------
create temp table obs_r1 on commit drop as
with a as (
  select r.*,
         case when r.switch_ago is not null and r.ago >= r.switch_ago then r.prev_ver else r.ver end as version,
         -- Story 4: the SAP query tool is slow and times out between 14:00 and 17:30, three days ago.
         (r.ago = 3 and r.sap and (r.hour between 14 and 16 or (r.hour = 17 and r.minute < 30))) as inc,
         (r.story = 'runaway') as runaway
  from obs_r0 r
), b as (
  select a.*,
         case
           when a.runaway then (case when observability.rnd(a.key, 3) < 0.8 then 'error' else 'ok' end)
           -- Story 3: postings above the approval limit are stopped by policy (3 to 5 days ago); other writers are blocked now and then.
           when observability.rnd(a.key, 4) < (case when a.agent_id = 'payment-proposal-check' and a.ago between 3 and 5 then 0.22
                                                    when a.writes and a.mode <> 'autonomous' then 0.004 else 0 end) then 'blocked'
           when a.inc and observability.rnd(a.key, 5) < 0.38 then 'error'
           when observability.rnd(a.key, 2) < (1 - a.p_ok - a.p_esc) then 'error'
           when observability.rnd(a.key, 2) < (1 - a.p_ok - a.p_esc) + a.p_esc * (case when a.agent_id = 'hr-policy-assistant' and a.ago < 14 then 1.6 else 1 end) then 'escalated'
           else 'ok' end as status
  from a
)
select b.*,
       case b.status
         when 'error' then (case when b.runaway then 'step_limit' when b.inc then 'connector_timeout'
                                 else (case when observability.rnd(b.key, 6) < 0.40 then 'tool_error' when observability.rnd(b.key, 6) < 0.65 then 'schema_invalid'
                                            when observability.rnd(b.key, 6) < 0.85 then 'model_overload' else 'connector_timeout' end) end)
         when 'blocked' then 'policy_blocked' else '' end as error_type,
       (case when b.runaway then 70 + floor(60 * observability.rnd(b.key, 7))::int
             else greatest(2, round(b.steps_m * (0.5 + observability.rnd(b.key, 8)))::int) end) as steps
from b;

create temp table obs_r2 on commit drop as
with a as (
  select r.*,
         (r.mode = 'act-after-approval' and r.writes and r.status in ('ok', 'escalated')) as approval,
         (r.status <> 'blocked' and observability.rnd(r.key, 20) < r.samp) as sampled,
         -- Story 2: after version 1.4 the Renewal watcher is wrong more often, but the run status does not show it.
         (case when r.agent_id = 'renewal-watcher' and r.ago < 21 then 0.70 else r.goal end) as goal_p
  from obs_r1 r
), b as (
  select a.*,
         2 + least(a.steps, 8) + (case when a.approval then 1 else 0 end) as s,
         case when not a.sampled then null
              when a.status = 'ok' then observability.rnd(a.key, 21) < a.goal_p
              when a.status = 'escalated' then observability.rnd(a.key, 21) < 0.5
              else false end as goal_met
  from a
)
select b.*,
       case when not b.sampled then null
            when b.goal_met then round((0.78 + 0.22 * observability.rnd(b.key, 22))::numeric, 2)
            else round(((case when b.status = 'ok' then 0.25 + 0.4 * observability.rnd(b.key, 22) else 0.1 + 0.25 * observability.rnd(b.key, 22) end))::numeric, 2) end as quality
from b;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Steps of each run (root, guardrail, then chat / tool / retrieval, then an approval wait for agents that need one)
-- ---------------------------------------------------------------------------------------------------------------------------
create temp table obs_sp0 on commit drop as
with t1 as (
  select r.run_id, g.ord, r.s, r.key, r.status as rstatus, r.error_type, r.agent_id, r.agent_name, r.platform, r.model, r.write_tool, r.tools,
         r.runaway, r.inc, r.started_at, r.ago,
         (g.ord > 2 and g.ord = r.s - (case when r.approval then 1 else 0 end)) as is_last,
         (r.approval and g.ord = r.s) as is_appr,
         (array_to_string(r.tools, ',') ~ '(Intranet|DMS|Legal)') as retr,
         (case when r.agent_id = 'margin-analyst' and r.ago < 15 then 1.6 else 1.0 end) as tokmult,
         (case when r.agent_id = 'it-ticket-triage' and r.ago < 28 then 1.5 else 1.0 end) as dmult
  from obs_r2 r cross join lateral generate_series(1, r.s) as g(ord)
), t2 as (
  select t1.*,
         case when t1.ord = 1 then 'invoke_agent' when t1.ord = 2 then 'guardrail' when t1.is_appr then 'approval'
              when t1.is_last and t1.rstatus = 'blocked' then 'execute_tool'
              when t1.is_last and t1.rstatus = 'error' then (case when t1.error_type in ('model_overload', 'schema_invalid', 'step_limit') then 'chat' else 'execute_tool' end)
              when t1.is_last then 'chat'
              else (case (t1.ord - 3) % 4 when 0 then 'chat' when 1 then 'execute_tool' when 2 then (case when t1.retr then 'retrieval' else 'execute_tool' end) else 'execute_tool' end) end as kind
  from t1
), t3 as (
  select t2.*,
         case when t2.kind in ('execute_tool', 'retrieval') then
           (case when t2.is_last and t2.rstatus = 'blocked' then coalesce(t2.write_tool, t2.tools[1])
                 when t2.is_last and t2.rstatus = 'error' then t2.tools[1]
                 else t2.tools[1 + ((t2.ord + abs(t2.key % 7)::int) % array_length(t2.tools, 1))] end) end as entry
  from t2
), t4 as (
  select t3.*, split_part(t3.entry, '|', 1) as tsys, split_part(t3.entry, '|', 2) as tname,
         observability.rnd(t3.key, 100 + t3.ord) as r1, observability.rnd(t3.key, 200 + t3.ord) as r2,
         (t3.kind = 'execute_tool' and t3.inc and split_part(t3.entry, '|', 2) = 'sap_query') as slow
  from t3
), t5 as (
  select t4.*,
         case
           when t4.is_last and t4.rstatus = 'error' and t4.error_type = 'connector_timeout' then 30000
           else (case t4.kind
             when 'guardrail' then round(30 + 120 * t4.r1)
             when 'approval' then round(60000 * (1 + 100 * t4.r1 * t4.r1 * t4.r1))
             when 'retrieval' then round((150 + 700 * t4.r1) * t4.dmult)
             when 'chat' then round((400 + 2600 * t4.r1) * t4.dmult * (case when t4.runaway then 6 else 1 end))
             when 'execute_tool' then round((case t4.tsys when 'SAP S/4' then 450 when 'Databricks' then 900 when 'Web' then 700 when 'CRM' then 350 else 300 end)
                                            * (0.4 + 1.6 * t4.r1 * t4.r1) * t4.dmult * (case when t4.slow then 4 + 2 * t4.r2 else 1 end))
             else 0 end) end::int as dur,
         case when t4.kind = 'chat' then round((600 + 3400 * t4.r1) * t4.tokmult * (case when t4.runaway then 300 else 1 end))::int else 0 end as in_t,
         case when t4.kind = 'chat' then round((120 + 800 * t4.r2) * t4.tokmult)::int else 0 end as out_t,
         case
           when t4.kind = 'invoke_agent' then (case t4.rstatus when 'error' then 'error' when 'blocked' then 'blocked' else 'ok' end)
           when t4.kind = 'approval' then (case when t4.started_at > now() - interval '3 hours' then 'waiting' else 'ok' end)
           when t4.is_last and t4.rstatus = 'blocked' then 'blocked'
           when t4.is_last and t4.rstatus = 'error' then 'error'
           when t4.kind = 'execute_tool' and t4.slow and t4.r2 < 0.2 then 'error'
           when t4.kind = 'execute_tool' and t4.r2 < 0.012 then 'error'
           else 'ok' end as status,
         case t4.error_type when 'connector_timeout' then 'Connector timeout after 30 s' when 'tool_error' then 'The tool returned an error'
           when 'schema_invalid' then 'The answer did not match the expected schema' when 'model_overload' then 'Model overloaded, retry limit reached'
           when 'step_limit' then 'Stopped at the step limit' else '' end as errtext
  from t4
)
select t5.run_id, t5.ord, t5.kind, t5.started_at, t5.dur, t5.in_t, t5.out_t, t5.status, t5.is_last, t5.rstatus, t5.agent_id, t5.runaway, t5.r1,
       case t5.kind when 'invoke_agent' then left('invoke_agent ' || t5.agent_name, 80) when 'guardrail' then 'input_guardrail' when 'approval' then 'human_approval'
         when 'chat' then 'chat ' || t5.model when 'retrieval' then 'retrieve ' || t5.tname else t5.tname end as name,
       case t5.kind when 'invoke_agent' then t5.platform when 'guardrail' then 'guardrails' when 'approval' then 'Joule Approvals' when 'chat' then t5.model else t5.tsys end as system,
       case t5.kind when 'chat' then round(((t5.in_t * (case t5.model when 'claude-sonnet' then 0.0027 when 'claude-haiku' then 0.0009 when 'gpt-4.1' then 0.0018 else 0.0003 end)
                                          + t5.out_t * (case t5.model when 'claude-sonnet' then 0.0135 when 'claude-haiku' then 0.0045 when 'gpt-4.1' then 0.0072 else 0.0012 end)) / 1000.0)::numeric, 5)
                    when 'retrieval' then 0.0004 else 0 end as cost,
       case
         when t5.kind = 'invoke_agent' then t5.errtext
         when t5.is_last and t5.rstatus = 'blocked' then (case when t5.agent_id = 'payment-proposal-check' then 'Blocked: posting above the approval limit declared for this agent' else 'Blocked: write outside the declared rights' end)
         when t5.is_last and t5.rstatus = 'error' then t5.errtext
         when t5.status = 'error' then 'Failed once, retried'
         when t5.kind = 'guardrail' and t5.r1 < 0.015 then 'Personal data masked'
         when t5.kind = 'guardrail' and t5.r1 > 0.996 then 'Instruction in tool output ignored (possible injection)'
         when t5.kind = 'chat' and t5.runaway and not t5.is_last then 'Same plan repeated (loop)'
         else '' end as note,
       t5.tname
from t5;

create temp table obs_sp1 on commit drop as
select s.*,
       case when s.ord = 1 then 0 else coalesce(sum(case when s.ord > 1 then s.dur else 0 end) over (partition by s.run_id order by s.ord rows between unbounded preceding and 1 preceding), 0) end as off,
       case when s.ord = 1 then sum(case when s.ord > 1 then s.dur end) over (partition by s.run_id) else s.dur end as dur2,
       max(case when s.kind = 'chat' then s.ord end) over (partition by s.run_id order by s.ord rows between unbounded preceding and 1 preceding) as prev_chat
from obs_sp0 s;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Write: runs, steps, review queue
-- ---------------------------------------------------------------------------------------------------------------------------
insert into observability.run (run_id, agent_id, version, started_at, duration_ms, wait_ms, status, trigger_kind, caller, steps, input_tokens, output_tokens, cost_eur, error_type, quality, goal_met)
select r.run_id, r.agent_id, r.version, r.started_at, coalesce(a.active, 0)::int, coalesce(a.wait, 0)::int, r.status, r.trig,
       case when r.trig = 'person' then 'u-' || lpad((1 + (floor(observability.rnd(r.key, 9) * r.callers)::int + abs(hashtext(r.agent_id)) % 40) % 400)::text, 4, '0') else 'system' end,
       r.steps, coalesce(a.tin, 0)::int, coalesce(a.tout, 0)::int, round(coalesce(a.cost, 0)::numeric, 4), r.error_type, r.quality, r.goal_met
from obs_r2 r
left join (select run_id, sum(case when kind not in ('invoke_agent', 'approval') then dur else 0 end) as active, sum(case when kind = 'approval' then dur else 0 end) as wait,
                  sum(in_t) as tin, sum(out_t) as tout, sum(cost) as cost
           from obs_sp0 group by run_id) a using (run_id);

select setval(pg_get_serial_sequence('observability.run', 'run_id'), (select max(run_id) from observability.run)) where exists (select 1 from observability.run);

insert into observability.span (run_id, ord, parent_ord, kind, name, system, offset_ms, duration_ms, status, input_tokens, output_tokens, cost_eur, note)
select s.run_id, s.ord,
       case when s.ord = 1 then null when s.kind in ('execute_tool', 'retrieval') then coalesce(s.prev_chat, 1) else 1 end,
       s.kind, s.name, s.system, s.off::int, s.dur2::int, s.status, s.in_t, s.out_t, s.cost, s.note
from obs_sp1 s;

insert into observability.review (run_id, status, verdict, reviewer, reviewed_at)
select r.run_id,
       case when r.goal_met is false and observability.rnd(r.run_id, 31) < 0.35 then 'pending' else 'done' end,
       case when r.goal_met is false and observability.rnd(r.run_id, 31) < 0.35 then null
            when r.goal_met is false then (case when observability.rnd(r.run_id, 32) < 0.88 then 'wrong' else 'correct' end) else 'correct' end,
       case when r.goal_met is false and observability.rnd(r.run_id, 31) < 0.35 then '' else 'reviewer-0' || (1 + floor(observability.rnd(r.run_id, 33) * 5))::int end,
       case when r.goal_met is false and observability.rnd(r.run_id, 31) < 0.35 then null else least(r.started_at + interval '1 day', now()) end
from observability.run r
where (select fresh from obs_seed) and r.goal_met is not null and r.status = 'ok' and r.started_at >= now() - interval '30 days'
  and (r.goal_met is false or observability.rnd(r.run_id, 30) < 0.03);

-- ---------------------------------------------------------------------------------------------------------------------------
-- Regression cases: seven per agent, one batch every night for 30 nights, three attempts each (pass^k = all three passed)
-- ---------------------------------------------------------------------------------------------------------------------------
insert into observability.eval_case (case_id, agent_id, name, kind)
select d.id || '-c' || n.n, d.id,
       case when d.id = 'payment-proposal-check' and n.n = 4 then 'Refuses to post above the approval limit'
            else (case n.n when 1 then 'Final state matches the annotated goal' when 2 then 'Handles an empty result' when 3 then 'Answer matches the output schema'
                           when 4 then 'Stays inside the declared rights' when 5 then 'Previously fixed case 1' when 6 then 'Previously fixed case 2' else 'Judge score above threshold' end) end,
       (array['state', 'state', 'schema', 'safety', 'regression', 'regression', 'quality'])[n.n]
from obs_def d cross join generate_series(1, 7) as n(n)
where (select fresh from obs_seed)
on conflict (case_id) do nothing;

insert into observability.eval_result (batch_id, case_id, attempt, agent_id, version, passed, ran_at)
select 'nightly-' || to_char(dy.day, 'YYYY-MM-DD'), c.case_id, a.attempt, d.id,
       case when d.switch_ago is not null and g.ago >= d.switch_ago then d.prev_ver else d.ver end,
       observability.rnd(hashtextextended(c.case_id || ':' || g.ago, 5), a.attempt) <
         (case when d.id = 'renewal-watcher' and g.ago < 21 and c.kind in ('state', 'regression', 'quality') then 0.72
               when d.id = 'payment-proposal-check' and c.kind = 'safety' and g.ago <= 4 then 0.45
               when abs(hashtext(c.case_id)) % 10 = 0 then 0.90
               else 0.985 end),
       ((dy.day + time '03:15') at time zone 'Europe/Berlin')
from obs_def d
join observability.eval_case c on c.agent_id = d.id
cross join generate_series(0, 29) as g(ago)
cross join lateral (select ((now() at time zone 'Europe/Berlin')::date - g.ago) as day) dy
cross join generate_series(1, 3) as a(attempt)
where (select fresh from obs_seed) and g.ago <= d.launched_ago and g.ago >= coalesce(d.ended_ago, 0)
  and ((dy.day + time '03:15') at time zone 'Europe/Berlin') <= now()
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Alerts: raised by rules on the data above. The numbers in the messages are computed from the runs, not typed.
-- ---------------------------------------------------------------------------------------------------------------------------
insert into observability.alert (agent_id, raised_at, severity, rule, message, status, resolved_at)
select 'supplier-delay-scout', x.t0 + interval '40 minutes', 'page', 'cost-per-run',
       format('Cost per run is %s times the agent''s median: %s runs hit the step limit in about 3 hours and burned %s EUR.', round(x.avg_cost / nullif(m.med, 0))::int, x.n, round(x.total)::int),
       'resolved', x.t0 + interval '3 hours 20 minutes'
from (select count(*) as n, sum(cost_eur) as total, avg(cost_eur) as avg_cost, min(started_at) as t0 from observability.run where agent_id = 'supplier-delay-scout' and error_type = 'step_limit') x,
     (select percentile_cont(0.5) within group (order by cost_eur) as med from observability.run where agent_id = 'supplier-delay-scout' and error_type <> 'step_limit') m
where (select fresh from obs_seed) and x.n > 0;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status, resolved_at)
select null, (((now() at time zone 'Europe/Berlin')::date - 3 + time '15:05') at time zone 'Europe/Berlin'), 'page', 'tool-error-rate',
       format('Error rate on sap_query reached %s%% between 14:00 and 17:30; %s agents were affected. Calls were slow and ended in timeouts.', x.pct, x.agents),
       'resolved', (((now() at time zone 'Europe/Berlin')::date - 3 + time '17:45') at time zone 'Europe/Berlin')
from (select round(100.0 * count(*) filter (where s.status = 'error') / nullif(count(*), 0))::int as pct, count(distinct r.agent_id) as agents
      from observability.span s join observability.run r using (run_id)
      where s.name = 'sap_query' and r.started_at >= (((now() at time zone 'Europe/Berlin')::date - 3 + time '14:00') at time zone 'Europe/Berlin')
        and r.started_at < (((now() at time zone 'Europe/Berlin')::date - 3 + time '17:30') at time zone 'Europe/Berlin')) x
where (select fresh from obs_seed) and x.pct is not null;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status)
select 'payment-proposal-check', (((now() at time zone 'Europe/Berlin')::date - 3 + time '09:30') at time zone 'Europe/Berlin'), 'page', 'blocked-action',
       format('%s write attempts were stopped by policy in three days: postings above the approval limit declared for this agent.', x.n), 'acknowledged'
from (select count(*) as n from observability.run where agent_id = 'payment-proposal-check' and status = 'blocked' and started_at >= now() - interval '6 days') x
where (select fresh from obs_seed) and x.n > 0;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status)
select 'renewal-watcher', (((now() at time zone 'Europe/Berlin')::date - 12 + time '08:10') at time zone 'Europe/Berlin'), 'ticket', 'outcome-drift',
       format('The outcome check passed %s%% of sampled runs on version 1.3 and %s%% on 1.4, while %s%% of the 1.4 runs ended green.', x.before, x.after, x.green), 'open'
from (select round(100.0 * avg(goal_met::int) filter (where version = '1.3'))::int as before,
             round(100.0 * avg(goal_met::int) filter (where version = '1.4'))::int as after,
             round(100.0 * count(*) filter (where version = '1.4' and status = 'ok') / nullif(count(*) filter (where version = '1.4'), 0))::int as green
      from observability.run where agent_id = 'renewal-watcher' and started_at >= now() - interval '30 days') x
where (select fresh from obs_seed) and x.before is not null and x.after is not null;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status)
select 'hr-policy-assistant', (((now() at time zone 'Europe/Berlin')::date - 6 + time '10:00') at time zone 'Europe/Berlin'), 'ticket', 'escalation-rate',
       format('Escalations to a person rose from %s%% to %s%% since version 1.1.', x.before, x.after), 'acknowledged'
from (select round(100.0 * count(*) filter (where version = '1.0' and status = 'escalated') / nullif(count(*) filter (where version = '1.0'), 0))::int as before,
             round(100.0 * count(*) filter (where version = '1.1' and status = 'escalated') / nullif(count(*) filter (where version = '1.1'), 0))::int as after
      from observability.run where agent_id = 'hr-policy-assistant') x
where (select fresh from obs_seed) and x.before is not null and x.after is not null;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status)
select 'it-ticket-triage', (((now() at time zone 'Europe/Berlin')::date - 8 + time '13:20') at time zone 'Europe/Berlin'), 'ticket', 'latency-drift',
       format('p95 run time rose from %s s to %s s since version 3.2.', x.before, x.after), 'open'
from (select round((percentile_cont(0.95) within group (order by duration_ms) filter (where version = '3.1') / 1000.0)::numeric, 1) as before,
             round((percentile_cont(0.95) within group (order by duration_ms) filter (where version = '3.2') / 1000.0)::numeric, 1) as after
      from observability.run where agent_id = 'it-ticket-triage') x
where (select fresh from obs_seed) and x.before is not null and x.after is not null;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status)
select 'margin-analyst', (((now() at time zone 'Europe/Berlin')::date - 7 + time '11:45') at time zone 'Europe/Berlin'), 'ticket', 'cost-per-run',
       format('Cost per run rose from %s EUR to %s EUR over the last 15 days (longer prompts).', x.before, x.after), 'acknowledged'
from (select round(avg(cost_eur) filter (where started_at < now() - interval '15 days' and started_at >= now() - interval '45 days'), 3) as before,
             round(avg(cost_eur) filter (where started_at >= now() - interval '15 days'), 3) as after
      from observability.run where agent_id = 'margin-analyst') x
where (select fresh from obs_seed) and x.before is not null and x.after is not null;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status)
select 'nightly-data-quality', (((now() at time zone 'Europe/Berlin')::date - 4 + time '07:05') at time zone 'Europe/Berlin'), 'ticket', 'success-rate',
       format('Success rate over 30 days is %s%%; the target is 95%%.', x.pct), 'open'
from (select round(100.0 * count(*) filter (where status = 'ok') / nullif(count(*), 0), 1) as pct
      from observability.run where agent_id = 'nightly-data-quality' and started_at >= now() - interval '30 days') x
where (select fresh from obs_seed) and x.pct is not null;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status)
select 'invoice-matching-bot', (((now() at time zone 'Europe/Berlin')::date - 1 + time '06:00') at time zone 'Europe/Berlin'), 'info', 'unattended-writes',
       format('%s writes in 30 days without a person in the loop (autonomous mode). A review sample is due.', x.n), 'open'
from (select count(*) as n from observability.run where agent_id = 'invoice-matching-bot' and status = 'ok' and started_at >= now() - interval '30 days') x
where (select fresh from obs_seed) and x.n > 0;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status)
select 'travel-expense-helper', (((now() at time zone 'Europe/Berlin')::date - 2 + time '08:00') at time zone 'Europe/Berlin'), 'info', 'low-use',
       format('Only %s runs in the last 14 days. Consider phasing the entry out.', x.n), 'open'
from (select count(*) as n from observability.run where agent_id = 'travel-expense-helper' and started_at >= now() - interval '14 days') x
where (select fresh from obs_seed);

insert into observability.alert (agent_id, raised_at, severity, rule, message, status, resolved_at)
select 'customer-health-scout', (((now() at time zone 'Europe/Berlin')::date - 8 + time '09:00') at time zone 'Europe/Berlin'), 'info', 'new-agent',
       format('New agent: the first %s runs are done, %s%% finished green.', x.n, x.pct), 'resolved', (((now() at time zone 'Europe/Berlin')::date - 7 + time '09:00') at time zone 'Europe/Berlin')
from (select count(*) as n, round(100.0 * count(*) filter (where status = 'ok') / nullif(count(*), 0))::int as pct
      from (select status from observability.run where agent_id = 'customer-health-scout' order by started_at limit 100) q) x
where (select fresh from obs_seed) and x.n > 0;

insert into observability.alert (agent_id, raised_at, severity, rule, message, status, resolved_at)
select 'legacy-ticket-router', (((now() at time zone 'Europe/Berlin')::date - 39 + time '08:00') at time zone 'Europe/Berlin'), 'info', 'retired',
       'Retired: no runs since the switch to IT ticket triage.', 'resolved', (((now() at time zone 'Europe/Berlin')::date - 38 + time '08:00') at time zone 'Europe/Berlin')
where (select fresh from obs_seed);

analyze observability.run;
analyze observability.span;

commit;
