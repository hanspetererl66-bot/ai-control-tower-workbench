create schema if not exists control_tower;

create table control_tower.meta (
  id int primary key default 1 check (id = 1),
  version int not null,
  note text not null,
  risk_threshold_pct int not null,
  agents_total int not null,
  agents_production int not null,
  agents_unregistered int not null,
  agents_overprivileged int not null,
  discovery_more_note text not null,
  discovery_more_status text not null,
  discovery_more_status_tone text not null,
  overprivileged_rest_severity text not null,
  overprivileged_rest_description text not null,
  access_tier_target text not null,
  budget_total_actual_m numeric not null,
  budget_ceiling_m numeric not null
);

create table control_tower.risks (
  id text primary key,
  sort_order int not null,
  severity text not null check (severity in ('high','medium','low')),
  title text not null,
  description text not null,
  owner text not null,
  owner_team text not null,
  eta text not null,
  eta_tone text not null,
  progress_pct int not null check (progress_pct between 0 and 100),
  progress_color text not null,
  progress_note text not null,
  action text not null,
  tile text not null,
  short text not null
);

create table control_tower.agent_types (
  key text primary key,
  sort_order int not null,
  label text not null,
  tone text not null,
  count int not null,
  description text not null,
  examples text not null
);

create table control_tower.discovery_assets (
  asset text primary key,
  sort_order int not null,
  source text not null,
  model text not null,
  first_seen date not null,
  signal_tone text not null,
  signal text not null,
  status_tone text not null,
  status text not null
);

create table control_tower.overprivileged_queue (
  name text primary key,
  sort_order int not null,
  severity text not null,
  count int not null,
  description text not null
);

create table control_tower.access_tiers (
  label text primary key,
  sort_order int not null,
  count int not null,
  color text not null
);

create table control_tower.budget_groups (
  name text primary key,
  sort_order int not null,
  budget_k int not null,
  utilisation_pct int not null,
  color text not null
);

-- Read-only sample data: RLS on, no policies, no grants to API roles.
-- The schema is not exposed through the Data API; only the service role
-- (server-side connector) can read it, via public.control_tower_snapshot().
alter table control_tower.meta enable row level security;
alter table control_tower.risks enable row level security;
alter table control_tower.agent_types enable row level security;
alter table control_tower.discovery_assets enable row level security;
alter table control_tower.overprivileged_queue enable row level security;
alter table control_tower.access_tiers enable row level security;
alter table control_tower.budget_groups enable row level security;

revoke all on schema control_tower from anon, authenticated;
revoke all on all tables in schema control_tower from anon, authenticated;
