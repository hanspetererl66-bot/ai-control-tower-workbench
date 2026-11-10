/**
 * The demo of the agent network: three agents around one renewal. The Space `agent-network` shows the same three agents with sample data;
 * "Demo: renewal network" in the Agent Studio creates them as real Studio agents (draft, not yet published) with their contracts.
 *
 *   Renewal watcher  asks  Finance facts  (overdue invoices)   and   Support facts  (open tickets)  before it writes the renewal brief.
 *
 * Finance facts releases confidential data (amounts) only with amounts withheld; Support facts answers internal data in full; neither releases
 * personal data. The watcher asks nobody else and nobody may ask the watcher.
 */
import { newAgent, type Source, type StudioAgent } from './agent-studio.ts';
import { sanitizeContract, type Contract } from './agent-network.ts';

export const DEMO_TEMPLATES = { watcher: 'net:watcher', finance: 'net:finance', support: 'net:support' } as const;
const idOf = (now: number, tag: string) => `a-${now.toString(36)}${tag}`;

export type DemoDefinition = { template: string; name: string; purpose: string; instruction: string; sourceMatch: string[]; contract: (ids: { finance: string; support: string }) => Contract };
export const DEMO: DemoDefinition[] = [
  {
    template: DEMO_TEMPLATES.finance, name: 'Finance facts',
    purpose: 'Tells other agents which invoices of a customer are open or overdue.',
    instruction: 'You answer questions from other agents about the invoices of one customer. Read the invoices of the customer from the allowed source. Say which are overdue (invoice id, days overdue), which are open and when they are due. Answer only the question that was asked, in at most six sentences, and name the source. Never state a bank detail or a contact person. If the customer is unknown or the source is missing, say so.',
    sourceMatch: ['sub4me'],
    contract: () => sanitizeContract({ callable: true, capability: 'Open and overdue invoices of one customer, with due dates.', accepts: 'A customer name or id (muster, hanse, lindenau) and what you need to know about its invoices.', returns: 'A short list with invoice ids and days overdue; amounts only when the release allows it.', releases: { public: 'answer', internal: 'answer', confidential: 'redact', personal: 'refuse' }, mayCall: [] }),
  },
  {
    template: DEMO_TEMPLATES.support, name: 'Support facts',
    purpose: 'Tells other agents which support tickets of a customer are open and how serious they are.',
    instruction: 'You answer questions from other agents about the support tickets of one customer. Read the tickets of the customer from the allowed source. Say which are open, their priority and status, and whether the ball is with the customer or with support. Answer only the question that was asked, in at most six sentences, and name the source. Never name a person who reported a ticket. If the customer is unknown or the source is missing, say so.',
    sourceMatch: ['sub4me'],
    contract: () => sanitizeContract({ callable: true, capability: 'Open support tickets of one customer with priority and status.', accepts: 'A customer name or id (muster, hanse, lindenau) and which tickets or products matter.', returns: 'A short list with ticket ids, priority and who has to act.', releases: { public: 'answer', internal: 'answer', confidential: 'redact', personal: 'refuse' }, mayCall: [] }),
  },
  {
    template: DEMO_TEMPLATES.watcher, name: 'Renewal watcher',
    purpose: 'Prepares the renewal brief of one customer and asks Finance facts and Support facts for what it does not own.',
    instruction: 'For the customer you are given, read the renewals of that customer in the Renewals Space: decision dates, health, offers. Then ask the agent Finance facts for the overdue invoices of the customer and the agent Support facts for the open tickets (purpose: prepare the renewal talk; data class: internal). Write a short renewal brief: what decides when, the risks, what Finance and Support told you (name the agent for every statement) and the next best action. If an agent refuses or does not answer, say so in the brief and do not fill the gap with a guess. Do not send or change anything.',
    sourceMatch: ['space:renewals'],
    contract: (ids) => sanitizeContract({ callable: false, mayCall: [ids.finance, ids.support] }),
  },
];

/** Creates the three demo agents with their contracts (drafts: nothing runs before they are tested and published). */
export function demoAgents(catalog: Source[], now = Date.now()): StudioAgent[] {
  const ids = { finance: idOf(now, 'f'), support: idOf(now, 's'), watcher: idOf(now, 'w') };
  return DEMO.map((d) => {
    const base = newAgent(null, catalog, now);
    const key = d.template === DEMO_TEMPLATES.finance ? 'finance' : d.template === DEMO_TEMPLATES.support ? 'support' : 'watcher';
    return {
      ...base, id: ids[key], name: d.name, purpose: d.purpose, instruction: d.instruction, template: d.template,
      sources: catalog.filter((s) => d.sourceMatch.some((m) => s.id.toLowerCase().includes(m))).map((s) => s.id), contract: d.contract(ids),
    };
  });
}
export const hasDemo = (agents: StudioAgent[]) => agents.some((a) => a.template === DEMO_TEMPLATES.watcher);
