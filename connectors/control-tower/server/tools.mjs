/**
 * Tool definitions and handlers for the AI Control Tower connector.
 * Pure functions over the parsed data.json — no I/O, so they are easy to test.
 * Every tool is read-only.
 */

export const SPACE = 'ai-control-tower';
const SEVERITIES = ['high', 'medium', 'low'];

/** Where the answer lives in the Control Tower space (used by the chat to point at a tab). */
const view = (tab) => ({ space: SPACE, tab });

export class ToolError extends Error {}

const publicRisk = (risk, limit) => ({
  id: risk.id,
  severity: risk.severity,
  title: risk.title,
  description: risk.description,
  owner: risk.owner,
  ownerTeam: risk.ownerTeam,
  eta: risk.eta,
  progressPct: risk.progressPct,
  belowThreshold: risk.progressPct < limit,
  progressNote: risk.progressNote,
  action: risk.action,
});

function optionalNumber(args, key, min, max) {
  if (args[key] === undefined) return undefined;
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ToolError(`${key} must be a number between ${min} and ${max}`);
  }
  return value;
}

function optionalString(args, key) {
  if (args[key] === undefined) return undefined;
  if (typeof args[key] !== 'string' || !args[key].trim()) throw new ToolError(`${key} must be a non-empty string`);
  return args[key].trim();
}

const HANDLERS = {
  get_risks(data, args) {
    const limit = data.meta?.riskThresholdPct ?? 40;
    const severity = optionalString(args, 'severity')?.toLowerCase();
    if (severity !== undefined && !SEVERITIES.includes(severity)) {
      throw new ToolError(`severity must be one of: ${SEVERITIES.join(', ')}`);
    }
    const maxProgress = optionalNumber(args, 'max_progress_pct', 0, 100);
    const owner = optionalString(args, 'owner')?.toLowerCase();

    const risks = data.risks
      .filter((risk) => severity === undefined || risk.severity === severity)
      .filter((risk) => maxProgress === undefined || risk.progressPct <= maxProgress)
      .filter((risk) => owner === undefined || `${risk.owner} ${risk.ownerTeam}`.toLowerCase().includes(owner))
      .sort((a, b) => a.progressPct - b.progressPct)
      .map((risk) => publicRisk(risk, limit));

    return {
      mitigationThresholdPct: limit,
      count: risks.length,
      risks,
      view: view('risk'),
    };
  },

  get_risk(data, args) {
    const id = optionalString(args, 'id');
    if (id === undefined) throw new ToolError('id is required');
    const risk = data.risks.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!risk) {
      throw new ToolError(`No risk with id "${id}". Known ids: ${data.risks.map((item) => item.id).join(', ')}`);
    }
    return { risk: publicRisk(risk, data.meta?.riskThresholdPct ?? 40), view: view('risk') };
  },

  get_agent_overview(data) {
    const a = data.agents;
    return {
      totalAgents: a.total,
      productionAgents: a.production,
      productionSharePct: Math.round((a.production / a.total) * 100),
      unregisteredAssets: a.unregistered,
      overprivilegedAgents: a.overprivileged,
      types: a.types.map(({ label, count, description }) => ({ label, count, description })),
      accessTiers: a.accessTiers.map(({ label, count }) => ({
        label,
        count,
        pctOfProduction: Math.round((count / a.production) * 100),
      })),
      accessTierTarget: a.accessTierTarget,
      view: view('repo'),
    };
  },

  get_unregistered_assets(data) {
    const a = data.agents;
    return {
      totalUnregistered: a.unregistered,
      listed: a.discovery,
      notListed: a.unregistered - a.discovery.length,
      notListedDescription: a.discoveryMore.note,
      view: view('repo'),
    };
  },

  get_overprivileged_agents(data) {
    const a = data.agents;
    const listedCount = a.overprivilegedQueue.reduce((sum, item) => sum + item.count, 0);
    return {
      totalOverprivileged: a.overprivileged,
      queue: a.overprivilegedQueue,
      notListed: a.overprivileged - listedCount,
      notListedDescription: a.overprivilegedRest.description,
      view: view('repo'),
    };
  },

  get_budget(data) {
    const b = data.budget;
    const groups = b.groups.map((group) => ({
      name: group.name,
      budgetK: group.budgetK,
      utilisationPct: group.utilisationPct,
      actualK: Math.round((group.budgetK * group.utilisationPct) / 100),
      status: group.utilisationPct > 100 ? 'over budget' : group.utilisationPct >= 85 ? 'near limit' : 'within budget',
    }));
    const sumBudgetK = groups.reduce((sum, group) => sum + group.budgetK, 0);
    const sumActualK = groups.reduce((sum, group) => sum + group.actualK, 0);
    return {
      statedMonthlyActualM: b.totalActualM,
      approvedCeilingM: b.ceilingM,
      headroomM: Number((b.ceilingM - b.totalActualM).toFixed(2)),
      groups,
      // The team rows do not add up to the stated totals. Reported, not hidden.
      reconciliation: {
        sumOfTeamBudgetsK: sumBudgetK,
        sumOfTeamActualsK: sumActualK,
        ceilingMinusTeamBudgetsK: Math.round(b.ceilingM * 1000) - sumBudgetK,
        statedActualMinusTeamActualsK: Math.round(b.totalActualM * 1000) - sumActualK,
        note: 'Team-level rows do not add up to the stated totals; the source data does not explain the difference.',
      },
      view: view('gov'),
    };
  },
};

export const TOOL_DEFINITIONS = [
  {
    name: 'get_risks',
    description:
      'List open AI governance risks from the AI Control Tower risk register, sorted by mitigation progress (lowest first). ' +
      'Use it for questions such as "which risks are below 40% mitigated?" or "show all high-severity risks".',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: SEVERITIES, description: 'Only risks of this severity.' },
        max_progress_pct: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Only risks whose mitigation progress is at or below this percentage.',
        },
        owner: { type: 'string', description: 'Case-insensitive match on owner or owner team, e.g. "CISO".' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_risk',
    description: 'Get one risk by id (for example "R2"), including owner, ETA, progress and current action.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Risk id such as "R3".' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_agent_overview',
    description:
      'Summary of the AI agent registry: total and production agents, agent types, access tiers, and counts of unregistered and overprivileged agents.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_unregistered_assets',
    description: 'Unregistered AI assets found by the discovery scan, with source, runtime, risk signal and status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_overprivileged_agents',
    description: 'Remediation queue for agents that hold more permissions than their function requires.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_budget',
    description:
      'Monthly AI budget by team group: budget, utilisation, derived spend and status, plus a reconciliation of the team rows against the stated totals.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** Run a tool and shape the result the way MCP expects. */
export function callTool(name, args, data, source) {
  const handler = HANDLERS[name];
  if (!handler) throw new RangeError(`Unknown tool: ${name}`);
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    return { content: [{ type: 'text', text: 'arguments must be an object' }], isError: true };
  }
  try {
    const result = handler(data, args);
    const payload = source === undefined ? result : { ...result, dataSource: source };
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
  } catch (error) {
    if (error instanceof ToolError) return { content: [{ type: 'text', text: error.message }], isError: true };
    throw error;
  }
}
