-- Recruiting analytics: aggregated numbers for the Space "Recruiting Analytics" (time to fill, funnel and waits, sources, selection rates).
-- ALREADY APPLIED on Supabase on 2026-11-08 (version 20261108111627, name recruiting_analytics). This file was written afterwards from the live
-- definitions (tables, constraints, views, grants and the example rows) so the repository matches the database; it is idempotent.
--
-- What the schema holds and what it never holds:
--  * Only counts and averages. No candidate, no name, no CV, no date of birth. The group table holds applications and interviews per group
--    (gender, age group), never a person.
--  * Selection rates per group (v_group_rate) hide every group with fewer applications than `min_group_size` (default 10): the rate stays
--    NULL, so a small group cannot be identified. For the rest the view flags a REVIEW HINT where a group's rate is below `four_fifths`
--    (default 0.8) of the top group's rate. A hint is a reason to look at the process; it is not a finding and not about individuals.
--  * Every row says where it came from (`origin`, default 'example'). The rows below are example data.
--  * Tables and views are closed to anon and authenticated; only service_role reads and writes. The views run with the caller's rights
--    (security_invoker). To read them through the API the schema must be listed under Settings > API > Exposed schemas.

create schema if not exists recruiting_analytics;
revoke all on schema recruiting_analytics from anon, authenticated;
grant usage on schema recruiting_analytics to service_role;

create table if not exists recruiting_analytics.setting (
  key text primary key,
  value text not null
);

create table if not exists recruiting_analytics.funnel_snapshot (
  requisition_id text primary key references recruiting.requisition (id) on delete cascade,
  applied integer not null check (applied >= 0),
  screened integer not null check (screened >= 0),
  interviewed integer not null check (interviewed >= 0),
  wait_screen_days numeric not null check (wait_screen_days >= 0),
  wait_interview_days numeric not null check (wait_interview_days >= 0),
  wait_offer_days numeric not null check (wait_offer_days >= 0),
  origin text not null default 'example',
  check (screened <= applied and interviewed <= screened)
);

create table if not exists recruiting_analytics.source_stat (
  source text primary key,
  applications integer not null check (applications >= 0),
  hires integer not null check (hires >= 0),
  cost_eur numeric not null check (cost_eur >= 0),
  early_check_passed integer not null check (early_check_passed >= 0),
  early_check_total integer not null check (early_check_total >= 0),
  origin text not null default 'example',
  check (hires <= applications),
  check (early_check_passed <= early_check_total and early_check_total <= hires)
);

create table if not exists recruiting_analytics.group_stat (
  dimension text not null,
  grp text not null,
  applications integer not null check (applications >= 0),
  interviews integer not null check (interviews >= 0),
  origin text not null default 'example',
  primary key (dimension, grp),
  check (interviews <= applications)
);

alter table recruiting_analytics.setting enable row level security;
alter table recruiting_analytics.funnel_snapshot enable row level security;
alter table recruiting_analytics.source_stat enable row level security;
alter table recruiting_analytics.group_stat enable row level security;
revoke all on all tables in schema recruiting_analytics from anon, authenticated;
grant all on all tables in schema recruiting_analytics to service_role;

create or replace view recruiting_analytics.v_requisition_kpi with (security_invoker = true) as
  select r.id as requisition_id, r.title, r.dept, r.status, r.opened_on, r.filled_on,
         case when r.status = 'filled' then r.filled_on - r.opened_on else current_date - r.opened_on end as days,
         r.target_days, r.offers_made, r.offers_accepted,
         f.applied, f.screened, f.interviewed, f.wait_screen_days, f.wait_interview_days, f.wait_offer_days
    from recruiting.requisition r
    left join recruiting_analytics.funnel_snapshot f on f.requisition_id = r.id;

create or replace view recruiting_analytics.v_wait_benchmark with (security_invoker = true) as
  select 'screen'::text as stage_key, days from recruiting.stage_target where stage = 'Screening'
  union all select 'interview', days from recruiting.stage_target where stage = 'Online interview'
  union all select 'offer', days from recruiting.stage_target where stage = 'Offer';

create or replace view recruiting_analytics.v_source_kpi with (security_invoker = true) as
  select source, applications, hires, cost_eur, round(cost_eur / nullif(hires, 0), 0) as cost_per_hire,
         early_check_passed, early_check_total
    from recruiting_analytics.source_stat;

create or replace view recruiting_analytics.v_group_rate with (security_invoker = true) as
  with s as (
    select (select value::integer from recruiting_analytics.setting where key = 'min_group_size') as min_group,
           (select value::numeric from recruiting_analytics.setting where key = 'four_fifths') as ff
  ), base as (
    select g.dimension, g.grp, g.applications,
           g.applications < s.min_group as suppressed,
           case when g.applications >= s.min_group then g.interviews end as interviews,
           case when g.applications >= s.min_group then g.interviews::numeric / nullif(g.applications, 0) end as rate
      from recruiting_analytics.group_stat g, s
  )
  select dimension, grp, applications, suppressed, interviews, rate,
         rate / nullif(max(rate) over (partition by dimension), 0) as ratio_to_top,
         (rate / nullif(max(rate) over (partition by dimension), 0)) < (select ff from s) as review_hint
    from base b;

revoke all on all tables in schema recruiting_analytics from anon, authenticated;
grant select on all tables in schema recruiting_analytics to service_role;

-- Example rows (origin 'example'), as applied on 2026-11-08.
insert into recruiting_analytics.setting (key, value) values
  ('min_group_size', '10'), ('four_fifths', '0.8'), ('period_start', '2026-07-01'), ('period_end', '2026-11-08'), ('data_origin', 'example')
on conflict (key) do nothing;

insert into recruiting_analytics.funnel_snapshot (requisition_id, applied, screened, interviewed, wait_screen_days, wait_interview_days, wait_offer_days) values
  ('REQ-1917',120,44,13,4,9,3), ('REQ-1909',96,35,10,3,8,4), ('REQ-1902',88,32,11,5,10,3), ('REQ-1912',74,28,9,4,8,4),
  ('REQ-1903',52,20,6,3,7,3), ('REQ-1914',41,17,5,3,6,2), ('REQ-1915',210,58,15,6,9,5), ('REQ-1906',38,15,4,3,6,3),
  ('REQ-1907',160,46,10,4,8,3), ('REQ-1911',180,52,12,5,9,4), ('REQ-1901',135,40,9,3,7,3), ('REQ-1905',150,44,10,4,7,3),
  ('REQ-2204',64,22,7,4,22,3), ('REQ-2201',58,20,5,6,12,4), ('REQ-2203',49,17,4,5,9,3), ('REQ-2202',77,19,3,3,8,2),
  ('REQ-2205',98,24,3,7,6,3), ('REQ-2206',29,10,2,4,7,3)
on conflict (requisition_id) do nothing;

insert into recruiting_analytics.source_stat (source, applications, hires, cost_eur, early_check_passed, early_check_total) values
  ('Jobbörsen',790,6,28800,5,6), ('Karriereseite',420,3,7500,3,3), ('Mitarbeiterempfehlung',96,4,8000,4,4),
  ('Personalagentur',133,3,69000,2,3), ('Hochschulen',280,2,11000,2,2)
on conflict (source) do nothing;

insert into recruiting_analytics.group_stat (dimension, grp, applications, interviews) values
  ('Geschlecht','weiblich',742,58), ('Geschlecht','männlich',971,80), ('Geschlecht','divers',6,0),
  ('Altersgruppe','unter 30',640,55), ('Altersgruppe','30 bis 44',760,66), ('Altersgruppe','45 und älter',319,17)
on conflict (dimension, grp) do nothing;
