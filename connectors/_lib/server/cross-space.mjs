/**
 * Cross-Space enrichment: one Sub4Me service ticket, looked at together with what the AI
 * Control Tower knows. Read-only. The links between a Sub4Me product and Control Tower assets
 * are a heuristic table over fictional sample data (see LINKS), and the result says so.
 */
import { ToolError } from './tools.mjs';
import { loadSub4MeData } from './sub4me.mjs';

export const CROSS_SPACE_TOOL_DEFINITIONS = [
  {
    name: 'enrich_ticket',
    description:
      'Enrich one Sub4Me service ticket (for example "TKT-48213") with context from the AI Control Tower: the product\'s contracts and AI-unit consumption forecast, other open tickets for the same product, agents on the related platforms, risks that could play a role (with owner and mitigation), teams over their AI budget, and suggested next steps. Read-only. The product-to-asset links are a heuristic over sample data. Use it when the person asks why a ticket happens, what it touches or what to do about it.',
    inputSchema: {
      type: 'object',
      properties: { ticket_id: { type: 'string', description: 'Ticket id, for example "TKT-48213".' } },
      required: ['ticket_id'],
      additionalProperties: false,
    },
  },
];

/** Which Control Tower assets are plausibly involved when a given Sub4Me product has a problem. */
export const LINKS = [
  { match: /joule/i, platforms: ['SAP AI Core', 'SAP BTP'], types: ['copilot'], riskTerms: ['hallucination', 'prompt injection'] },
  { match: /ai core|document ai/i, platforms: ['SAP AI Core'], types: [], riskTerms: ['overprivileged', 'unregistered', 'eu ai act'] },
  { match: /ariba|successfactors|concur|s\/4|btp|business technology/i, platforms: ['SAP BTP'], types: [], riskTerms: ['unregistered', 'shadow'] },
];

const isOpen = (t) => !['Closed', 'Solution provided'].includes(t.status);
const view = (space, tab) => ({ space, tab });

/** Pure: build the answer from a ticket, the product overview, and the Control Tower data. */
export function enrichTicket(ticket, overview, tower) {
  const link = LINKS.find((l) => l.match.test(ticket.product ?? ''));
  const limit = tower.meta?.riskThresholdPct ?? 40;
  const registry = (tower.agents?.registry ?? []).filter((a) => a.lifecycle !== 'retired');

  const agents = link
    ? registry.filter((a) => link.platforms.includes(a.platform) && (link.types.length === 0 || link.types.includes(a.type)))
    : [];
  const risks = link
    ? tower.risks.filter((r) => link.riskTerms.some((term) => `${r.title} ${r.description}`.toLowerCase().includes(term)))
    : [];
  const overBudget = (tower.budget?.groups ?? []).filter((g) => g.utilisationPct > 100);

  const consumption = overview?.consumption ?? null;
  const otherOpen = (overview?.tickets ?? []).filter((t) => t.id !== ticket.id && isOpen(t));

  const assessment = [];
  if (consumption?.forecastPct > 100) {
    assessment.push(`Consumption of ${ticket.product} is forecast at ${consumption.forecastPct} % of the allotment; a quota or capacity problem is plausible.`);
  }
  if (otherOpen.length) assessment.push(`${otherOpen.length} other open ticket(s) concern the same product: ${otherOpen.map((t) => t.id).join(', ')}.`);
  const production = agents.filter((a) => a.lifecycle === 'production');
  const privileged = production.filter((a) => a.overprivileged);
  if (production.length) {
    assessment.push(`${production.length} agents in production run on the related platform(s); ${privileged.length} of them are overprivileged.`);
  }
  for (const r of risks.filter((x) => x.progressPct < limit)) {
    assessment.push(`Risk ${r.id} "${r.title}" is only ${r.progressPct} % mitigated (owner: ${r.owner}).`);
  }
  if (overBudget.length) assessment.push(`Over AI budget: ${overBudget.map((g) => `${g.name} ${g.utilisationPct} %`).join(', ')}.`);

  const nextSteps = [];
  if (consumption?.forecastPct > 100) nextSteps.push('Check the AI-unit allotment with the account team and consider an upgrade offer.');
  if (privileged.length) nextSteps.push('Review the overprivileged agents on the related platform before changing anything.');
  nextSteps.push(`Reply to the customer on ${ticket.id} with the findings above; keep the ticket status "${ticket.status}" until confirmed.`);

  return {
    ticket,
    sub4me: {
      contracts: (overview?.contracts ?? []).map((c) => ({ id: c.id, product: c.product, status: c.status, end: c.end })),
      consumption,
      otherOpenTickets: otherOpen.map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status })),
    },
    controlTower: {
      linkedPlatforms: link?.platforms ?? [],
      agents: { inScope: agents.length, production: production.length, overprivilegedInProduction: privileged.length },
      risks: risks.map((r) => ({ id: r.id, severity: r.severity, title: r.title, owner: r.owner, progressPct: r.progressPct, belowThreshold: r.progressPct < limit })),
      teamsOverBudget: overBudget.map((g) => ({ name: g.name, utilisationPct: g.utilisationPct })),
    },
    assessment,
    nextSteps,
    note: link
      ? 'Product-to-asset links are a heuristic over fictional sample data, not a diagnosis.'
      : `No Control Tower link is defined for the product "${ticket.product}"; only Sub4Me context is shown.`,
    views: [view('sub4me', 'tickets'), view('ai-control-tower', 'risk')],
  };
}

/**
 * `sub4me` is createSub4MeHandlers(...); `loadTower` returns { data, source } for the Control Tower;
 * `rpc` is the Supabase caller or null.
 */
export function createCrossSpaceHandlers({ sub4me, loadTower, rpc = null, loadTickets = null }) {
  const tickets = async () => {
    if (rpc) {
      try {
        const live = await rpc('sub4me_tickets', {});
        if (Array.isArray(live)) return live;
      } catch {
        // fall back to the sample tickets
      }
    }
    return (loadTickets ?? (() => loadSub4MeData().tickets ?? []))();
  };
  return {
    async enrich_ticket(args) {
      const id = String(args.ticket_id ?? '').trim();
      if (!id) throw new ToolError('ticket_id is required');
      const list = await tickets();
      const ticket = list.find((t) => String(t.id).toLowerCase() === id.toLowerCase());
      if (!ticket) throw new ToolError(`No ticket with id "${id}". Known ids: ${list.map((t) => t.id).join(', ')}`);
      let overview = null;
      try {
        overview = await sub4me.get_product_overview({ product: ticket.product });
      } catch {
        // an unknown product still gets the Control Tower side
      }
      const { data, source } = await loadTower();
      return { ...enrichTicket(ticket, overview, data), dataSource: `tickets and Sub4Me: ${overview?.dataSource ?? 'sample data'}; Control Tower: ${source}` };
    },
  };
}
