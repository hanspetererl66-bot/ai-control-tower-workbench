/**
 * Generates the mock agent registry (186 agents) for the Control Tower example.
 * Deterministic (seeded) and constrained so every headline number on the dashboard
 * still adds up: 186 = 58 autonomous + 97 copilot + 31 orchestrators; 125 production
 * + 28 pending review + 33 retired; access tiers 74/41/10; 31 overprivileged;
 * 18 high-risk systems (8 EU AI Act assessments complete, 10 outstanding);
 * 44 registered this quarter; 44,800 runs/day and ~EUR 50.6k/week across production.
 *
 * Usage: node scripts/generate-control-tower-agents.mjs   (rewrites agents.registry in data.json,
 *        also writes supabase/migrations/20261018_005_control_tower_agents.sql)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'examples/control-tower/data.json');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261018);
const pick = (list) => list[Math.floor(rand() * list.length)];
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

// family: [name, count, businessUnit, dataClass, platform/model pool key, special]
const FAMILIES = {
  autonomous: [
    ['SAP SPC Ticket Router', 8, 'Operations', 'Internal', 'sap'],
    ['OData Enrichment Pipeline', 6, 'Engineering', 'Internal', 'sap'],
    ['Report Generation Bot', 7, 'Finance', 'Confidential', 'sap'],
    ['Shift Roster Sync', 4, 'HR', 'Confidential', 'internal'],
    ['Contract Classifier', 5, 'Legal', 'Restricted', 'azure'],
    ['BTP Monitor', 5, 'Operations', 'Internal', 'sap'],
    ['Invoice Matcher', 6, 'Finance', 'Confidential', 'azure'],
    ['Master Data Deduplicator', 5, 'Operations', 'Internal', 'sap'],
    ['Log Anomaly Triage', 4, 'Engineering', 'Internal', 'internal'],
    ['Access Review Collector', 4, 'Security', 'Confidential', 'internal'],
    ['Price List Updater', 4, 'Sales', 'Internal', 'sap'],
  ],
  copilot: [
    ['L2C Deal Advisor', 12, 'Sales', 'Confidential', 'azure'],
    ['ABAP Code Assistant', 18, 'Engineering', 'Internal', 'anthropic'],
    ['Contract Drafter', 9, 'Legal', 'Restricted', 'azure'],
    ['Presales Proposal Generator', 8, 'Sales', 'Confidential', 'anthropic'],
    ['Fiori UX Reviewer', 6, 'Engineering', 'Internal', 'anthropic'],
    ['Meeting Summarizer', 10, 'Operations', 'Internal', 'azure'],
    ['Support Reply Drafter', 9, 'Support', 'Confidential', 'azure'],
    ['SQL Query Helper', 8, 'Engineering', 'Internal', 'anthropic'],
    ['Test Case Suggester', 9, 'Engineering', 'Internal', 'anthropic'],
    ['Knowledge Base Search', 8, 'Support', 'Internal', 'sap'],
  ],
  orchestrator: [
    ['L2C Pipeline Orchestrator', 6, 'Sales', 'Confidential', 'sap'],
    ['BTP Deploy Coordinator', 5, 'Engineering', 'Internal', 'sap'],
    ['n8n Workflow Builder', 8, 'Operations', 'Internal', 'n8n'],
    ['Test Suite Generator', 4, 'Engineering', 'Internal', 'anthropic'],
    ['Release Train Coordinator', 4, 'Engineering', 'Internal', 'anthropic'],
    ['Onboarding Orchestrator', 4, 'HR', 'Confidential', 'azure'],
  ],
};

const POOLS = {
  sap: [['SAP BTP', 'SAP proprietary'], ['SAP AI Core', 'SAP proprietary'], ['SAP AI Core', 'GPT-4.1']],
  azure: [['Azure OpenAI', 'GPT-4o'], ['Azure OpenAI', 'GPT-4.1']],
  anthropic: [['Anthropic API', 'Claude Sonnet 4.6'], ['Anthropic API', 'Claude Haiku 4.5']],
  n8n: [['n8n Cloud', 'Claude Sonnet 4.6'], ['n8n Cloud', 'GPT-4.1']],
  internal: [['Internal Python', 'GPT-4.1'], ['Internal Python', 'Claude Haiku 4.5']],
};

const TEAMS = {
  Operations: 'Platform Eng',
  Engineering: 'Eng Leads',
  Finance: 'Finance IT',
  HR: 'HR Systems',
  Legal: 'Legal Tech',
  Sales: 'Sales Ops',
  Support: 'Customer Support',
  Security: 'Security Office',
};
const OWNERS = ['A. Weber', 'M. Rossi', 'J. Novak', 'S. Keller', 'L. Moreau', 'T. Hansen', 'P. Silva', 'K. Brandt', 'E. Fischer', 'D. Costa', 'R. Lang', 'N. Berger'];

// Lifecycle quotas per type: [production, pending_review, retired]
const QUOTA = { autonomous: [40, 8, 10], copilot: [63, 16, 18], orchestrator: [22, 4, 5] };
// Production agents with full write / admin access (the three "critical/high" queue entries) …
const ADMIN = { 'L2C Pipeline Orchestrator': 3, 'Report Generation Bot': 4, 'Contract Drafter': 3 };
// … and the remaining overprivileged production agents (read + limited write, queued Q1 2027).
const OVERPRIV_REST = { 'n8n Workflow Builder': 5, 'BTP Monitor': 4, 'ABAP Code Assistant': 6, 'OData Enrichment Pipeline': 6 };
const HIGH_RISK_FAMILIES = ['Shift Roster Sync', 'Contract Classifier', 'Onboarding Orchestrator', 'Support Reply Drafter', 'Contract Drafter'];

export function generate() {
  const agents = [];
  for (const [type, families] of Object.entries(FAMILIES)) {
    for (const [family, count, unit, dataClass, pool] of families) {
      for (let i = 1; i <= count; i++) {
        const [platform, model] = pick(POOLS[pool]);
        agents.push({
          family, type, businessUnit: unit, dataClass, platform, model,
          seq: i, ownerTeam: TEAMS[unit], owner: pick(OWNERS),
        });
      }
    }
  }

  // Lifecycle: special (overprivileged) agents are production; the rest follow the quotas.
  const special = new Map();
  for (const [family, n] of Object.entries({ ...ADMIN })) {
    agents.filter((a) => a.family === family).slice(0, n).forEach((a) => special.set(a, 'admin'));
  }
  for (const [family, n] of Object.entries(OVERPRIV_REST)) {
    agents.filter((a) => a.family === family && !special.has(a)).slice(-n).forEach((a) => special.set(a, 'limited'));
  }
  for (const type of Object.keys(QUOTA)) {
    const [prod, pend] = QUOTA[type];
    const ofType = agents.filter((a) => a.type === type);
    const fixed = ofType.filter((a) => special.has(a));
    const free = shuffle(ofType.filter((a) => !special.has(a)));
    fixed.forEach((a) => (a.lifecycle = 'production'));
    const needProd = prod - fixed.length;
    free.forEach((a, i) => {
      a.lifecycle = i < needProd ? 'production' : i < needProd + pend ? 'pending_review' : 'retired';
    });
  }

  // Access tier (74 read-only / 41 limited write / 10 admin) among production agents.
  const production = agents.filter((a) => a.lifecycle === 'production');
  production.forEach((a) => {
    a.accessTier = special.get(a) === 'admin' ? 'Full write / admin' : special.get(a) === 'limited' ? 'Read + limited write' : null;
    a.overprivileged = special.has(a);
  });
  const open = shuffle(production.filter((a) => !a.accessTier));
  const limitedNeeded = 41 - production.filter((a) => a.accessTier === 'Read + limited write').length;
  open.forEach((a, i) => (a.accessTier = i < limitedNeeded ? 'Read + limited write' : 'Read-only'));
  agents.filter((a) => a.lifecycle !== 'production').forEach((a) => {
    a.accessTier = 'Read-only';
    a.overprivileged = false;
  });

  // EU AI Act: 18 high-risk systems, 8 assessed, 10 outstanding.
  const highRisk = HIGH_RISK_FAMILIES.flatMap((f) => production.filter((a) => a.family === f)).slice(0, 18);
  if (highRisk.length !== 18) throw new Error(`need 18 high-risk production agents, got ${highRisk.length}`);
  highRisk.forEach((a, i) => {
    a.euRisk = 'high';
    a.euAssessment = i % 18 < 8 ? 'complete' : 'outstanding';
  });
  agents.forEach((a) => {
    if (!a.euRisk) {
      a.euRisk = a.type === 'copilot' ? 'limited' : 'minimal';
      a.euAssessment = 'n/a';
    }
  });

  // Runs per day (production sum 44,800) and weekly cost (sum 50,600 EUR, per-type targets).
  const w = production.map(() => Math.exp(normal() * 1.15));
  const total = w.reduce((s, x) => s + x, 0);
  const runs = w.map((x) => Math.min(1600, Math.max(13, Math.round((x / total) * 44800))));
  let diff = 44800 - runs.reduce((s, x) => s + x, 0);
  for (let guard = 0; diff !== 0 && guard < 100000; guard++) {
    const i = guard % runs.length;
    const step = diff > 0 ? 1 : -1;
    if (runs[i] + step >= 13 && runs[i] + step <= 1600 && runs[i] > 60) {
      runs[i] += step;
      diff -= step;
    }
  }
  production.forEach((a, i) => (a.runsPerDay = runs[i]));
  const COST_TARGET = { orchestrator: 17358, autonomous: 12960 };
  COST_TARGET.copilot = 50600 - COST_TARGET.orchestrator - COST_TARGET.autonomous;
  for (const type of Object.keys(COST_TARGET)) {
    const group = production.filter((a) => a.type === type);
    const weights = group.map((a) => Math.sqrt(a.runsPerDay) * (0.6 + rand() * 0.8));
    const sum = weights.reduce((s, x) => s + x, 0);
    const costs = weights.map((x) => Math.round((x / sum) * COST_TARGET[type]));
    costs[0] += COST_TARGET[type] - costs.reduce((s, x) => s + x, 0);
    group.forEach((a, i) => (a.costPerWeekEur = costs[i]));
  }
  agents.filter((a) => a.lifecycle !== 'production').forEach((a) => {
    a.runsPerDay = 0;
    a.costPerWeekEur = 0;
  });

  // Dates. 44 agents were registered "this quarter" (2026-04-01 .. 2026-05-20): all 28 pending review + 16 production.
  const day = (from, to) => new Date(Date.parse(from) + Math.floor(rand() * (Date.parse(to) - Date.parse(from)) / 864e5) * 864e5).toISOString().slice(0, 10);
  const recentProd = shuffle(production.filter((a) => !special.has(a))).slice(0, 16);
  agents.forEach((a) => {
    if (a.lifecycle === 'pending_review' || recentProd.includes(a)) a.registeredOn = day('2026-04-01', '2026-05-20');
    else if (a.lifecycle === 'retired') a.registeredOn = day('2024-06-01', '2025-09-30');
    else a.registeredOn = day('2024-09-01', '2026-03-28');
    a.lastRun = a.lifecycle === 'production' ? (rand() < 0.8 ? '2026-05-25' : '2026-05-24') : null;
    a.retiredOn = a.lifecycle === 'retired' ? day('2025-10-01', '2026-05-15') : null;
  });

  // Stable ids: oldest registration first.
  agents.sort((x, y) => x.registeredOn.localeCompare(y.registeredOn) || x.family.localeCompare(y.family) || x.seq - y.seq);
  return agents.map((a, i) => ({
    id: `AGT-${String(1001 + i)}`,
    name: `${a.family} ${String(a.seq).padStart(2, '0')}`,
    family: a.family,
    type: a.type,
    lifecycle: a.lifecycle,
    platform: a.platform,
    model: a.model,
    owner: a.owner,
    ownerTeam: a.ownerTeam,
    businessUnit: a.businessUnit,
    dataClass: a.dataClass,
    accessTier: a.accessTier,
    overprivileged: a.overprivileged,
    euRisk: a.euRisk,
    euAssessment: a.euAssessment,
    runsPerDay: a.runsPerDay,
    costPerWeekEur: a.costPerWeekEur,
    registeredOn: a.registeredOn,
    lastRun: a.lastRun,
    retiredOn: a.retiredOn,
  }));
}

const COLUMNS = [
  ['id', 'text'], ['name', 'text'], ['family', 'text'], ['type', 'text'], ['lifecycle', 'text'], ['platform', 'text'],
  ['model', 'text'], ['owner', 'text'], ['owner_team', 'text'], ['business_unit', 'text'], ['data_class', 'text'],
  ['access_tier', 'text'], ['overprivileged', 'boolean'], ['eu_risk', 'text'], ['eu_assessment', 'text'],
  ['runs_per_day', 'integer'], ['cost_per_week_eur', 'integer'], ['registered_on', 'date'], ['last_run', 'date'], ['retired_on', 'date'],
];
const camel = (s) => s.replace(/_(\w)/g, (_m, c) => c.toUpperCase());
const lit = (v, type) => (v === null ? 'null' : type === 'boolean' || type === 'integer' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

export function insertSql(registry) {
  const cols = COLUMNS.map(([c]) => c);
  const rows = registry.map((a, i) => `  (${COLUMNS.map(([c, t]) => lit(a[camel(c)], t)).join(', ')}, ${i + 1})`);
  return `insert into control_tower.agents (${cols.join(', ')}, sort_order) values\n${rows.join(',\n')};`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  data.agents.registry = generate();
  writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n');
  const ddl = `-- Mock agent registry (186 agents) behind the "Registered agents" / "Production agents" tiles.
-- Generated by scripts/generate-control-tower-agents.mjs; sample data only.
create table if not exists control_tower.agents (
  id text primary key,
  name text not null,
  family text not null,
  type text not null check (type in ('autonomous','copilot','orchestrator')),
  lifecycle text not null check (lifecycle in ('production','pending_review','retired')),
  platform text not null,
  model text not null,
  owner text not null,
  owner_team text not null,
  business_unit text not null,
  data_class text not null,
  access_tier text not null,
  overprivileged boolean not null,
  eu_risk text not null check (eu_risk in ('minimal','limited','high')),
  eu_assessment text not null check (eu_assessment in ('complete','outstanding','n/a')),
  runs_per_day integer not null,
  cost_per_week_eur integer not null,
  registered_on date not null,
  last_run date,
  retired_on date,
  sort_order integer not null
);
alter table control_tower.agents enable row level security;
revoke all on control_tower.agents from anon, authenticated;
truncate control_tower.agents;
`;
  const fn = readFileSync(join(ROOT, 'supabase/migrations/20261018_004_control_tower_budget_and_audit.sql'), 'utf8');
  const fnStart = fn.indexOf('create or replace function public.control_tower_snapshot()');
  let func = fn.slice(fnStart);
  const anchor = "      'accessTierTarget', m.access_tier_target\n";
  if (!func.includes(anchor)) throw new Error('snapshot anchor not found');
  const registry = `      'accessTierTarget', m.access_tier_target,
      'registry', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', g.id, 'name', g.name, 'family', g.family, 'type', g.type, 'lifecycle', g.lifecycle,
          'platform', g.platform, 'model', g.model, 'owner', g.owner, 'ownerTeam', g.owner_team,
          'businessUnit', g.business_unit, 'dataClass', g.data_class, 'accessTier', g.access_tier,
          'overprivileged', g.overprivileged, 'euRisk', g.eu_risk, 'euAssessment', g.eu_assessment,
          'runsPerDay', g.runs_per_day, 'costPerWeekEur', g.cost_per_week_eur,
          'registeredOn', to_char(g.registered_on, 'YYYY-MM-DD'), 'lastRun', to_char(g.last_run, 'YYYY-MM-DD'),
          'retiredOn', to_char(g.retired_on, 'YYYY-MM-DD')) order by g.sort_order), '[]'::jsonb)
        from control_tower.agents g)
`;
  func = func.replace(anchor, registry);
  writeFileSync(
    join(ROOT, 'supabase/migrations/20261018_005_control_tower_agents.sql'),
    `${ddl}${insertSql(data.agents.registry)}\n\n-- Snapshot function v3: now includes agents.registry.\n${func}`,
  );
  console.log(`Wrote ${data.agents.registry.length} agents to data.json and migration 005`);
}
