/**
 * Knowledge graph over the sample data: customer (Sub4Me), skills (Skill Marketplace), risks and agents (Control Tower)
 * and automation (n8n). The graph is derived from those sources plus a few curated links, embedded into the Knowledge Graph
 * Space and read by the chat tools. Fictional sample data.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from './tools.mjs';
import { economics } from './skill-profiles.mjs';
import { summarise } from './rating-math.mjs';

const here = (path) => join(dirname(fileURLToPath(import.meta.url)), path);

export const NODE_TYPES = {
  system: 'System',
  connector: 'Connector',
  tool: 'Tool',
  customer: 'Customer',
  family: 'Product family',
  product: 'Product',
  contract: 'Contract',
  deal: 'Deal (lead / opportunity)',
  offer: 'Offer',
  ticket: 'Ticket',
  call: 'Call',
  thread: 'E-mail conversation',
  skill: 'Skill',
  risk: 'Risk',
  agent: 'Agent family',
  workflow: 'Workflow',
  app: 'App',
  person: 'Person / role',
};

/** verb reads source -> target, inverse reads target -> source. weak edges are drawn faint (hubs). */
export const EDGE_TYPES = {
  HAS_CONTRACT: { verb: 'has contract', inverse: 'contract of' },
  COVERS: { verb: 'covers', inverse: 'covered by' },
  OFFERED_FOR: { verb: 'offers', inverse: 'offered in' },
  RENEWS: { verb: 'renews', inverse: 'renewed by' },
  ABOUT: { verb: 'concerns', inverse: 'has ticket' },
  IN_FAMILY: { verb: 'belongs to', inverse: 'includes' },
  USES_TOOL: { verb: 'uses tool', inverse: 'used by' },
  PROVIDED_BY: { verb: 'provided by', inverse: 'provides', weak: true },
  READS: { verb: 'reads from', inverse: 'read by', weak: true },
  DEPENDS_ON: { verb: 'depends on', inverse: 'needed by' },
  REPLACED_BY: { verb: 'replaced by', inverse: 'replaces' },
  RELATES_TO_RISK: { verb: 'relates to risk', inverse: 'risk of' },
  OBSERVES_AGENT: { verb: 'works with', inverse: 'worked with by' },
  AFFECTS: { verb: 'affects', inverse: 'affected by' },
  MANAGES: { verb: 'manages', inverse: 'managed by' },
  OWNS: { verb: 'owns', inverse: 'owned by' },
  SERVES: { verb: 'serves', inverse: 'served by' },
  USES_APP: { verb: 'uses app', inverse: 'used in' },
  RUNS_IN: { verb: 'runs in', inverse: 'runs', weak: true },
  LISTED_IN: { verb: 'listed in', inverse: 'lists', weak: true },
  MANAGED_IN: { verb: 'managed in', inverse: 'manages', weak: true },
  WATCHES: { verb: 'watches', inverse: 'watched by' },
  MONITORS: { verb: 'monitors', inverse: 'monitored by' },
  REPORTS_ON: { verb: 'reports on', inverse: 'reported by' },
  INTEGRATES: { verb: 'integrates', inverse: 'integrated by' },
  WRITES_TO: { verb: 'writes to', inverse: 'written by' },
  USES: { verb: 'uses', inverse: 'used by' },
  WITH_CUSTOMER: { verb: 'was held with', inverse: 'has conversations' },
  DISCUSSES: { verb: 'discusses', inverse: 'discussed in' },
  FOLLOWS_UP: { verb: 'follows up on', inverse: 'followed up by' },
  HAS_DEAL: { verb: 'has deal', inverse: 'deal of' },
  HAS_OFFER: { verb: 'has offer', inverse: 'offer of' },
  CONTACT_AT: { verb: 'is a contact at', inverse: 'has contact' },
  CONTACT_FOR: { verb: 'is contact for', inverse: 'has contact' },
  TOOK_PART_IN: { verb: 'took part in', inverse: 'had participant' },
  WROTE_IN: { verb: 'wrote in', inverse: 'has message from' },
};

export const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const money = (v) => `€${Math.round(v).toLocaleString('en-US')}`;

const SYSTEMS = {
  sub4me: { label: 'Sub4Me', note: 'Customer portal: contracts, offers, AI units, tickets', view: { space: 'sub4me', tab: 'overview' } },
  n8n: { label: 'n8n Cloud', note: 'Workflow automation', view: { space: 'automation-dashboard', tab: 'overview' } },
  'control-tower': { label: 'AI Control Tower', note: 'Risks, agent registry, budget', view: { space: 'ai-control-tower', tab: 'overview' } },
  marketplace: { label: 'Skill Marketplace', note: 'Shared skill registry', view: { space: 'skill-marketplace', tab: 'catalog' } },
};

const TOOL_SYSTEM = (name) => {
  if (/n8n/.test(name)) return 'n8n';
  if (/(contract|offer|ai_consumption|customer|product_overview|sub4me|ticket)/.test(name)) return 'sub4me';
  if (/(skill)/.test(name)) return 'marketplace';
  if (/(risk|agent|budget|unregistered|overprivileged)/.test(name)) return 'control-tower';
  return 'control-tower';
};
const SUB4ME_TOOLS = (name) => TOOL_SYSTEM(name) === 'sub4me';

const FAMILY_RULES = [
  [/S\/4HANA/i, 'S/4HANA'], [/BTP|Business Technology/i, 'BTP'], [/SuccessFactors/i, 'SuccessFactors'], [/Ariba/i, 'Ariba'],
  [/Concur/i, 'Concur'], [/Joule/i, 'Joule'], [/Document AI/i, 'Document AI'], [/AI units/i, 'AI units'],
];
const familyOf = (name) => FAMILY_RULES.find(([re]) => re.test(name))?.[1] ?? null;

export function extractAutomationData(html) {
  const match = /<script type="application\/json" id="aut-data">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('Automation data block not found');
  return JSON.parse(match[1]);
}

export function extractGraph(html) {
  const match = /<script type="application\/json" id="kg-data">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('Knowledge graph data block not found');
  return JSON.parse(match[1]);
}

/** sources: { sub4me, marketplace, controlTower, automation, links, communication?, sales? } (communication = { calls, threads } mockup data, sales = the Sales pipeline) */
export function buildGraph({ sub4me, marketplace, controlTower, automation, links, communication, sales }) {
  const nodes = new Map();
  const edges = [];
  const seen = new Set();
  const addNode = (id, type, label, meta = {}, view) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, label, meta, ...(view ? { view } : {}) });
    return nodes.get(id);
  };
  const addEdge = (source, target, type, label) => {
    if (!nodes.has(source) || !nodes.has(target) || source === target) return false;
    const key = `${source}|${type}|${target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    edges.push({ source, target, type, ...(label ? { label } : {}) });
    return true;
  };

  /* systems and connector */
  for (const [key, s] of Object.entries(SYSTEMS)) addNode(`system:${key}`, 'system', s.label, { Role: s.note }, s.view);
  addNode('connector:ai-control-tower', 'connector', 'ai-control-tower', { Role: 'MCP connector with all chat tools' });

  /* Sub4Me */
  const customer = sub4me.customer;
  const customerId = `customer:${slug(customer.name)}`;
  addNode(customerId, 'customer', customer.name, { 'Customer no.': customer.number, Country: customer.country, Contact: customer.contact }, { space: 'sub4me', tab: 'overview' });
  addEdge(customerId, 'system:sub4me', 'MANAGED_IN');

  const productNames = new Set([...sub4me.products.map((p) => p.name), ...sub4me.contracts.map((c) => c.product), ...sub4me.offers.map((o) => o.product)]);
  const productId = (name) => `product:${slug(name)}`;
  const families = new Set();
  for (const name of productNames) {
    const p = sub4me.products.find((x) => x.name === name);
    const meta = p ? { 'AI-unit allotment': p.allotment.toLocaleString('en-US'), 'Consumed so far': (p.monthly ?? []).reduce((a, b) => a + b, 0).toLocaleString('en-US'), Meters: p.meters } : {};
    addNode(productId(name), 'product', name, meta, { space: 'sub4me', tab: p ? 'usage' : 'contracts' });
    const fam = familyOf(name);
    if (fam) {
      families.add(fam);
      addNode(`family:${slug(fam)}`, 'family', fam, { Role: 'Product family' });
      addEdge(productId(name), `family:${slug(fam)}`, 'IN_FAMILY');
    }
  }
  const productByText = (text) => [...productNames].filter((n) => n !== 'AI units (Joule, AI Core, Document AI)' && String(text).toLowerCase().includes(n.toLowerCase()));

  const personId = (name) => `person:${slug(name)}`;
  const addPerson = (name, role) => { if (name) addNode(personId(name), 'person', name, role ? { Role: role } : {}); };

  for (const c of sub4me.contracts) {
    const detail = c;
    addNode(`contract:${c.id}`, 'contract', c.id, {
      Product: c.product, Status: c.status, 'Annual value': money(c.annualEur), Term: `${c.start} → ${c.end}`, 'Notice period': `${c.noticeDays} days`,
      ...(detail.sla ? { 'Service level': detail.sla.tier } : {}), ...(detail.paymentTerms ? { 'Payment terms': detail.paymentTerms } : {}),
    }, { space: 'sub4me', tab: 'contracts' });
    addEdge(customerId, `contract:${c.id}`, 'HAS_CONTRACT');
    if (nodes.has(productId(c.product))) addEdge(`contract:${c.id}`, productId(c.product), 'COVERS');
    for (const line of c.lines ?? []) for (const n of productByText(line.component)) addEdge(`contract:${c.id}`, productId(n), 'COVERS', line.component);
    for (const [key, role] of [['sapOwner', 'SAP account owner'], ['csm', 'Customer success'], ['customerOwner', 'Customer owner']]) {
      if (c[key]?.name) { addPerson(c[key].name, c[key].role); addEdge(personId(c[key].name), `contract:${c.id}`, 'MANAGES', role); }
    }
  }
  for (const o of sub4me.offers) {
    addNode(`offer:${o.id}`, 'offer', o.id, {
      Type: o.type, Product: o.product, 'Annual value': money(o.annualEur), 'Valid until': o.validUntil, Status: o.status,
      ...(o.stage ? { Stage: o.stage } : {}), ...(o.probabilityPct !== undefined ? { 'Win probability': `${o.probabilityPct}%` } : {}),
    }, { space: 'sub4me', tab: 'contracts' });
    if (nodes.has(productId(o.product))) addEdge(`offer:${o.id}`, productId(o.product), 'OFFERED_FOR');
    if (o.contractId) addEdge(`offer:${o.id}`, `contract:${o.contractId}`, 'RENEWS');
    if (o.owner?.name) { addPerson(o.owner.name, o.owner.role); addEdge(personId(o.owner.name), `offer:${o.id}`, 'MANAGES', 'SAP owner'); }
  }
  for (const t of sub4me.tickets ?? []) {
    addNode(`ticket:${t.id}`, 'ticket', t.id, { Title: t.title, Priority: t.priority, Status: t.status, Created: t.created }, { space: 'sub4me', tab: 'tickets' });
    const p = [...productNames].find((n) => n.toLowerCase() === String(t.product).toLowerCase());
    if (p) addEdge(`ticket:${t.id}`, productId(p), 'ABOUT');
  }

  /* Control Tower: agent families and risks */
  const agentsAll = controlTower.agents?.registry ?? [];
  const agentId = (family) => `agent:${slug(family)}`;
  const ensureAgent = (family) => {
    const list = agentsAll.filter((a) => a.family === family);
    if (!list.length) return false;
    if (!nodes.has(agentId(family))) {
      const live = list.filter((a) => a.lifecycle !== 'retired');
      addNode(agentId(family), 'agent', family, {
        Agents: String(list.length), 'In production': String(list.filter((a) => a.lifecycle === 'production').length),
        Overprivileged: String(live.filter((a) => a.overprivileged).length), Platform: [...new Set(list.map((a) => a.platform))].join(', '), Type: list[0].type,
      }, { space: 'ai-control-tower', tab: 'agents' });
    }
    return true;
  };
  for (const r of controlTower.risks ?? []) {
    addNode(`risk:${r.id}`, 'risk', `${r.id} ${r.short}`, { Title: r.title, Severity: r.severity, Owner: r.owner, ETA: r.eta, Progress: `${r.progressPct}%` }, { space: 'ai-control-tower', tab: 'risks' });
    addPerson(r.owner, 'Risk owner');
    addEdge(personId(r.owner), `risk:${r.id}`, 'OWNS');
  }
  const overFamilies = [...new Set(agentsAll.filter((a) => a.overprivileged && a.lifecycle !== 'retired').map((a) => a.family))];
  for (const f of overFamilies) if (ensureAgent(f)) addEdge('risk:R2', agentId(f), 'AFFECTS');
  const euHigh = [...new Set(agentsAll.filter((a) => a.euRisk === 'high' && a.lifecycle !== 'retired').map((a) => a.family))];
  for (const f of euHigh) if (ensureAgent(f)) addEdge('risk:R6', agentId(f), 'AFFECTS');

  /* Skills */
  const profiles = marketplace.profiles ?? {};
  const rate = marketplace.assumptions?.hourlyRateEur ?? 85;
  const toolNode = (name) => {
    if (!nodes.has(`tool:${name}`)) {
      addNode(`tool:${name}`, 'tool', name, { System: SYSTEMS[TOOL_SYSTEM(name)].label });
      addEdge(`tool:${name}`, 'connector:ai-control-tower', 'PROVIDED_BY');
      addEdge(`tool:${name}`, `system:${TOOL_SYSTEM(name)}`, 'READS');
    }
    return `tool:${name}`;
  };
  for (const s of marketplace.skills) {
    const p = profiles[s.name];
    const meta = { Maturity: s.maturity, 'Board area': s.boardArea || 'not classified', Reach: s.scope, ...(s.team ? { Team: s.team } : {}), ...(s.sample ? { Note: 'sample skill' } : {}) };
    const rated = marketplace.ratings?.skills?.[s.name];
    if (rated) meta.Rating = summarise(rated.distribution, marketplace.ratings.settings).label;
    if (p) {
      const e = economics(p, rate);
      Object.assign(meta, { 'EU AI Act': p.governance.aiActRisk, 'Next review': p.governance.nextReview, 'Value last full month': money(e.valueEur), 'Runs last full month': String(e.runsLastFullMonth) });
    }
    addNode(`skill:${s.name}`, 'skill', s.name, meta, { space: 'skill-marketplace', tab: 'catalog' });
    addEdge(`skill:${s.name}`, 'system:marketplace', 'LISTED_IN');
    if (s.owner) { addPerson(s.owner, 'Skill owner'); addEdge(personId(s.owner), `skill:${s.name}`, 'OWNS'); }
    const tools = [...new Set([...(s.tools ?? []), ...(p?.lifecycle.dependencies.tools ?? [])])];
    for (const t of tools) addEdge(`skill:${s.name}`, toolNode(t), 'USES_TOOL');
    if (tools.some(SUB4ME_TOOLS)) addEdge(`skill:${s.name}`, customerId, 'SERVES');
  }
  for (const s of marketplace.skills) {
    const p = profiles[s.name];
    if (!p) continue;
    for (const d of p.lifecycle.dependencies.skills) addEdge(`skill:${s.name}`, `skill:${d}`, 'DEPENDS_ON');
    if (p.lifecycle.replacedBy) addEdge(`skill:${s.name}`, `skill:${p.lifecycle.replacedBy}`, 'REPLACED_BY');
    for (const r of p.governance.linkedRisks) addEdge(`skill:${s.name}`, `risk:${r}`, 'RELATES_TO_RISK');
    for (const a of p.governance.linkedAgents) if (ensureAgent(a)) addEdge(`skill:${s.name}`, agentId(a), 'OBSERVES_AGENT');
  }

  /* n8n */
  for (const w of automation.workflows ?? []) {
    const id = `workflow:${slug(w.name)}`;
    const runs = (w.daily ?? []).reduce((a, d) => a + d.success + d.error + d.other, 0);
    const errors = (w.daily ?? []).reduce((a, d) => a + d.error, 0);
    addNode(id, 'workflow', w.name, { Category: w.category, Trigger: w.trigger, 'Runs (14 days)': String(runs), Errors: String(errors), Nodes: String(w.nodeCount) }, { space: 'automation-dashboard', tab: 'workflows' });
    addEdge(id, 'system:n8n', 'RUNS_IN');
    for (const a of w.apps ?? []) {
      addNode(`app:${slug(a)}`, 'app', a, {});
      addEdge(id, `app:${slug(a)}`, 'USES_APP');
    }
  }

  /* Communication: call transcripts and customer e-mail conversations (mockup data) */
  if (communication) {
    const { calls = [], threads = [] } = communication;
    const customerNode = (name) => {
      const id = `customer:${slug(name)}`;
      if (!nodes.has(id)) addNode(id, 'customer', name, { Note: 'Not part of the Sub4Me sample data' }, { space: 'call-transcripts', tab: 'calls' });
      return id;
    };
    const link = (from, links) => {
      if (links.contract) addEdge(from, `contract:${links.contract}`, 'DISCUSSES');
      if (links.offer) addEdge(from, `offer:${links.offer}`, 'DISCUSSES');
      if (links.ticket) addEdge(from, `ticket:${links.ticket}`, 'DISCUSSES');
    };
    for (const c of calls) {
      const open = c.actions.filter((a) => a.status !== 'done');
      const overdue = open.filter((a) => a.due < c.asOf);
      const top = ['high', 'medium', 'low'].find((l) => c.risks.some((r) => r.level === l));
      addNode(`call:${c.id}`, 'call', c.id, {
        Title: c.title, Customer: c.customer, Date: c.date, Duration: `${c.minutes} min`, Mood: c.mood,
        Participants: c.people.map((p) => p.name).join(', '), 'Open actions': `${open.length}${overdue.length ? ` (${overdue.length} overdue)` : ''}`,
        Decisions: String(c.decisions.length), ...(top ? { 'Highest risk': top } : {}),
      }, { space: 'call-transcripts', tab: 'calls' });
      Object.assign(nodes.get(`call:${c.id}`), { date: c.date, ...(top ? { riskLevel: top } : {}) });
      addEdge(`call:${c.id}`, customerNode(c.customer), 'WITH_CUSTOMER');
      link(`call:${c.id}`, c.links);
    }
    for (const t of threads) {
      const last = t.messages[t.messages.length - 1];
      addNode(`thread:${t.id}`, 'thread', t.id, {
        Subject: t.subject, Customer: t.customer, Status: t.status.replace('-', ' '), Intent: t.intent, Mood: t.mood, Messages: String(t.messages.length),
        'Last message': last.at.slice(0, 10), 'Open points': String(t.ai.open.length),
        ...(t.ai.flags.length ? { Flag: 'Contains instructions aimed at AI assistants (not followed)' } : {}),
      }, { space: 'customer-emails', tab: 'inbox' });
      nodes.get(`thread:${t.id}`).date = t.messages[0].at.slice(0, 10);
      addEdge(`thread:${t.id}`, customerNode(t.customer), 'WITH_CUSTOMER');
      link(`thread:${t.id}`, t.links);
      for (const x of t.ai.cross) if (x.kind === 'call') addEdge(`thread:${t.id}`, `call:${x.id}`, 'FOLLOWS_UP', x.topic);
    }
  }

  /* Sales: deals (ACV, TCV, win probability, close date), stakeholders per customer (role and contact strength from calls and mails) */
  if (sales) {
    const customerFor = (name) => {
      const id = `customer:${slug(name)}`;
      if (!nodes.has(id)) addNode(id, 'customer', name, { Note: 'Not part of the Sub4Me sample data' }, { space: 'sales', tab: 'pipeline' });
      return id;
    };
    const stageLabel = { lead: 'Lead', opportunity: 'Opportunity', sell: 'Offer in negotiation', contract: 'Contract' };
    const calls = communication?.calls ?? [];
    const threads = communication?.threads ?? [];
    const people = new Map();
    const person = (name, customer, title) => {
      const id = personId(name);
      if (!people.has(id)) people.set(id, { id, name, customer, titles: new Set(), calls: [], threads: [], deals: [], dates: [], first: null });
      const p = people.get(id);
      if (title) p.titles.add(title);
      return p;
    };
    for (const c of calls) for (const p of c.people.filter((x) => x.side === 'customer')) {
      const s = person(p.name, c.customer, p.role); s.calls.push(c.id); s.dates.push(c.date);
    }
    for (const th of threads) for (const name of new Set(th.messages.filter((m) => m.side === 'customer').map((m) => m.name))) {
      const s = person(name, th.customer); s.threads.push(th.id); s.dates.push(th.messages[0].at.slice(0, 10));
    }
    const dealIds = [];
    for (const d of sales.deals ?? []) {
      if (!d.value) continue; // interest signals have no value yet
      const id = d.stage === 'sell' ? `offer:${d.id}` : d.stage === 'contract' ? `contract:${d.id}` : `deal:${d.id}`;
      const acv = d.value, term = d.termMonths ?? 12, tcv = Math.round((acv * term) / 12);
      const extra = {
        ACV: money(acv), TCV: `${money(tcv)} (${term} months)`, ...(d.score != null ? { 'Win probability': `${d.score}%` } : {}),
        ...(d.closeDate ? { 'Close date': d.closeDate } : {}), 'Sales stage': stageLabel[d.stage] ?? d.stage, ...(d.risks?.length ? { Risk: d.risks[0] } : {}),
      };
      let node = nodes.get(id);
      if (!node) node = addNode(id, d.stage === 'sell' ? 'offer' : d.stage === 'contract' ? 'contract' : 'deal', d.id, { Title: d.title, Account: d.account, Owner: d.owner }, { space: 'sales', tab: 'pipeline' });
      Object.assign(node.meta, extra);
      node.sales = {
        acv, tcv, term, stage: d.stage, account: d.account, ...(d.score != null ? { prob: d.score } : {}), ...(d.closeDate ? { close: d.closeDate } : {}),
        risks: d.risks ?? [], ...(d.prev ? { prev: d.prev } : {}), ...(d.changeWhy ? { changeWhy: d.changeWhy } : {}),
      };
      const first = (d.timeline ?? []).map((x) => x.date).sort()[0];
      if (first && d.stage !== 'contract') node.date = first;
      dealIds.push(id);
      const cust = customerFor(d.account);
      addEdge(cust, id, d.stage === 'contract' ? 'HAS_CONTRACT' : d.stage === 'sell' ? 'HAS_OFFER' : 'HAS_DEAL');
      for (const cid of d.links?.calls ?? []) addEdge(`call:${cid}`, id, 'DISCUSSES');
      for (const tid of d.links?.threads ?? []) addEdge(`thread:${tid}`, id, 'DISCUSSES');
      if (d.owner) { addPerson(d.owner, 'Deal owner'); addEdge(personId(d.owner), id, 'MANAGES', 'Deal owner'); }
      const m = /^([A-ZÄÖÜ][\wäöüß'-]+ [A-ZÄÖÜ][\wäöüß'-]+)(?:, (.+))?$/.exec(d.contact ?? '');
      if (m) { const s = person(m[1], d.account, m[2]); s.deals.push(id); if (node.date && (!s.first || node.date < s.first)) s.first = node.date; }
      else if (/\((sponsor)\)/i.test(d.contact ?? '')) node.meta.Contact = d.contact;
    }
    const BLOCKER = /security|legal|compliance|works council|data protection|privacy|risk/i;
    const DECIDER = /procurement|purchas|cfo|finance|budget|director|chief|vp\b|head of it/i;
    const SPONSOR = /platform|lead|owner|sponsor|e-commerce|business/i;
    const roleOf = (p) => { const text = [...p.titles].join(' '); return BLOCKER.test(text) ? 'Blocker' : DECIDER.test(text) ? 'Decider' : SPONSOR.test(text) ? 'Sponsor' : 'Influencer'; };
    for (const p of people.values()) {
      const touches = p.calls.length + p.threads.length;
      const strength = touches >= 3 ? 'strong' : touches === 2 ? 'medium' : touches === 1 ? 'light' : 'none';
      const dates = [...p.dates].sort();
      const role = roleOf(p);
      const title = [...p.titles][0];
      addNode(p.id, 'person', p.name, {
        ...(title ? { Role: title } : {}), Customer: p.customer, Stakeholder: role, 'Contact strength': `${strength} (${p.calls.length} calls, ${p.threads.length} e-mails)`,
        ...(dates.length ? { 'Last contact': dates[dates.length - 1] } : {}),
      });
      const node = nodes.get(p.id);
      node.stake = { role, strength, touches, calls: p.calls.length, mails: p.threads.length, customer: p.customer, ...(dates.length ? { last: dates[dates.length - 1] } : {}) };
      const appears = [dates[0], p.first].filter(Boolean).sort()[0];
      if (appears) node.date = appears;
      addEdge(p.id, customerFor(p.customer), 'CONTACT_AT', role);
      for (const cid of p.calls) addEdge(p.id, `call:${cid}`, 'TOOK_PART_IN');
      for (const tid of p.threads) addEdge(p.id, `thread:${tid}`, 'WROTE_IN');
      for (const did of p.deals) addEdge(p.id, did, 'CONTACT_FOR');
    }
  }

  /* curated links */
  const missing = [];
  for (const l of links?.links ?? []) if (!addEdge(l.from, l.to, l.type, l.label)) missing.push(l);

  return {
    asOf: sales?.asOf && sales.asOf > sub4me.asOf ? sales.asOf : sub4me.asOf,
    nodeTypes: NODE_TYPES,
    edgeTypes: EDGE_TYPES,
    nodes: [...nodes.values()],
    edges,
    tours: links?.tours ?? [],
    ...(missing.length ? { unresolvedLinks: missing } : {}),
  };
}

export function loadGraph() {
  const candidates = [process.env.KNOWLEDGE_GRAPH_DATA, here('../data/knowledge-graph.json')].filter(Boolean);
  const file = candidates.find((path) => existsSync(path));
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  const page = here('../../../examples/knowledge-graph/index.html');
  if (existsSync(page)) return extractGraph(readFileSync(page, 'utf8'));
  throw new Error('Knowledge graph sample data not found');
}

const TYPE_KEYS = Object.keys(NODE_TYPES);
export const GRAPH_TOOL_DEFINITIONS = [
  {
    name: 'get_graph_overview',
    description:
      'Overview of the knowledge graph that connects the Sub4Me customer (contracts, offers, products, tickets), the Skill Marketplace (skills, tools), the Control Tower (risks, agent families), n8n (workflows, apps) and the customer communication (call transcripts, e-mail conversations): counts by node and relation type, the best-connected nodes and nodes without connections. Use it first to see what the graph contains. Sample data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_graph',
    description:
      'Find nodes in the knowledge graph by name or text, optionally of one type (customer, contract, offer, product, family, ticket, call, thread, skill, tool, risk, agent, workflow, app, person, system, connector). Returns ids to use with the other graph tools. Sample data.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text, at least 2 characters, for example "ariba" or "R2".' },
        type: { type: 'string', enum: TYPE_KEYS, description: 'Only nodes of this type.' },
        limit: { type: 'integer', minimum: 1, maximum: 30, description: 'Maximum number of results (default 10).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_graph_neighbors',
    description:
      'One node of the knowledge graph with its direct connections, grouped by node type and written as sentences ("Offer OFF-2026-0318 renews Contract C-2023-0390"). Give the node as id or name (for example "C-2023-0390", "renewal-radar", "R2"). Optionally only neighbours of one type. Sample data.',
    inputSchema: {
      type: 'object',
      properties: {
        node: { type: 'string', description: 'Node id (for example "contract:C-2023-0390") or name.' },
        type: { type: 'string', enum: TYPE_KEYS, description: 'Only neighbours of this type.' },
      },
      required: ['node'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_graph_path',
    description:
      'Shortest connection between two nodes of the knowledge graph, step by step with the relation on each step. Answers "Wie hängt Risiko R2 mit dem Kunden zusammen?" or "Wie ist der Ariba-Vertrag mit dem Skill renewal-radar verbunden?". Sample data.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start node, id or name.' },
        to: { type: 'string', description: 'Target node, id or name.' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_graph_impact',
    description:
      'Impact analysis: everything connected to a node within a number of steps, grouped by distance and node type, with the route to each. Answers "Was ist betroffen, wenn der Ariba-Vertrag nicht verlängert wird?" or "Was hängt an Risiko R2?". Hubs such as the connector and the systems are not followed, so the result stays about business relations. Sample data.',
    inputSchema: {
      type: 'object',
      properties: {
        node: { type: 'string', description: 'Node id or name.' },
        depth: { type: 'integer', minimum: 1, maximum: 4, description: 'How many steps to follow (default 2).' },
        types: { type: 'array', items: { type: 'string', enum: TYPE_KEYS }, description: 'Only report nodes of these types.' },
      },
      required: ['node'],
      additionalProperties: false,
    },
  },
];

const HUBS = new Set(['connector', 'system']);

export function createGraphHandlers(load = loadGraph) {
  const index = () => {
    let g;
    try {
      g = load();
    } catch (error) {
      throw new ToolError(`Knowledge graph sample data unavailable: ${error.message}`);
    }
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const adj = new Map(g.nodes.map((n) => [n.id, []]));
    for (const e of g.edges) {
      adj.get(e.source)?.push({ to: e.target, edge: e, out: true });
      adj.get(e.target)?.push({ to: e.source, edge: e, out: false });
    }
    return { g, byId, adj };
  };
  const resolve = ({ g, byId }, text, what = 'node') => {
    const needle = String(text ?? '').trim();
    if (!needle) throw new ToolError(`${what} is required`);
    if (byId.has(needle)) return byId.get(needle);
    const low = needle.toLowerCase();
    const exact = g.nodes.filter((n) => n.label.toLowerCase() === low || n.id.toLowerCase().endsWith(`:${low}`));
    if (exact.length === 1) return exact[0];
    const pool = exact.length ? exact : g.nodes.filter((n) => n.label.toLowerCase().includes(low) || n.id.toLowerCase().includes(low));
    if (pool.length === 1) return pool[0];
    if (!pool.length) throw new ToolError(`No node matches "${text}". Try search_graph.`);
    throw new ToolError(`"${text}" is ambiguous: ${pool.slice(0, 8).map((n) => `${n.id} (${n.label})`).join('; ')}. Use an id.`);
  };
  const brief = (n) => ({ id: n.id, type: n.type, label: n.label });
  const sentence = (ix, from, step) => {
    const spec = ix.g.edgeTypes[step.edge.type] ?? EDGE_TYPES[step.edge.type] ?? { verb: step.edge.type.toLowerCase(), inverse: step.edge.type.toLowerCase() };
    const other = ix.byId.get(step.to);
    const text = step.out ? spec.verb : spec.inverse;
    return `${from.label} ${text} ${NODE_TYPES[other.type]} ${other.label}${step.edge.label ? ` (${step.edge.label})` : ''}`;
  };
  const view = (n) => (n.view ? { view: n.view } : {});

  return {
    get_graph_overview() {
      const ix = index();
      const { g, adj } = ix;
      const degree = (n) => adj.get(n.id).length;
      return {
        asOf: g.asOf,
        nodes: g.nodes.length,
        edges: g.edges.length,
        nodesByType: Object.fromEntries(Object.keys(NODE_TYPES).map((t) => [NODE_TYPES[t], g.nodes.filter((n) => n.type === t).length]).filter(([, c]) => c)),
        edgesByType: Object.fromEntries(Object.entries(g.edges.reduce((a, e) => ({ ...a, [e.type]: (a[e.type] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1])),
        mostConnected: [...g.nodes].sort((a, b) => degree(b) - degree(a) || a.label.localeCompare(b.label)).slice(0, 8).map((n) => ({ ...brief(n), connections: degree(n) })),
        withoutConnections: g.nodes.filter((n) => degree(n) === 0).map(brief),
        hint: 'Use search_graph to find a node, get_graph_neighbors for its connections, find_graph_path between two nodes and analyze_graph_impact for what is affected.',
        view: { space: 'knowledge-graph', tab: 'graph' },
        dataSource: 'sample data (Knowledge Graph example Space)',
      };
    },

    search_graph(args = {}) {
      const query = String(args.query ?? '').trim().toLowerCase();
      if (query.length < 2) throw new ToolError('query must be at least 2 characters');
      if (args.type !== undefined && !TYPE_KEYS.includes(args.type)) throw new ToolError(`type must be one of: ${TYPE_KEYS.join(', ')}`);
      const limit = args.limit === undefined ? 10 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new ToolError('limit must be an integer between 1 and 30');
      const { g } = index();
      const score = (n) => {
        const label = n.label.toLowerCase();
        if (label === query || n.id.toLowerCase() === query) return 3;
        if (label.startsWith(query)) return 2;
        if (label.includes(query) || n.id.toLowerCase().includes(query)) return 1;
        return Object.values(n.meta ?? {}).some((v) => String(v).toLowerCase().includes(query)) ? 0.5 : 0;
      };
      const hits = g.nodes.filter((n) => (!args.type || n.type === args.type) && score(n) > 0).sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label));
      return { query: args.query, count: hits.length, nodes: hits.slice(0, limit).map((n) => ({ ...brief(n), ...(Object.keys(n.meta ?? {}).length ? { details: n.meta } : {}) })), dataSource: 'sample data (Knowledge Graph example Space)' };
    },

    get_graph_neighbors(args = {}) {
      const ix = index();
      if (args.type !== undefined && !TYPE_KEYS.includes(args.type)) throw new ToolError(`type must be one of: ${TYPE_KEYS.join(', ')}`);
      const n = resolve(ix, args.node);
      const steps = ix.adj.get(n.id).filter((s) => !args.type || ix.byId.get(s.to).type === args.type);
      const grouped = {};
      for (const s of steps) {
        const other = ix.byId.get(s.to);
        (grouped[NODE_TYPES[other.type]] ??= []).push({ ...brief(other), relation: sentence(ix, n, s) });
      }
      return { node: { ...brief(n), details: n.meta }, connections: steps.length, neighbours: grouped, ...view(n), dataSource: 'sample data (Knowledge Graph example Space)' };
    },

    find_graph_path(args = {}) {
      const ix = index();
      const a = resolve(ix, args.from, 'from');
      const b = resolve(ix, args.to, 'to');
      if (a.id === b.id) return { from: brief(a), to: brief(b), length: 0, steps: [], note: 'Same node.' };
      const prev = new Map([[a.id, null]]);
      const queue = [a.id];
      while (queue.length && !prev.has(b.id)) {
        const cur = queue.shift();
        for (const s of ix.adj.get(cur)) {
          if (prev.has(s.to)) continue;
          // hubs only as endpoints: otherwise everything is two steps apart via the connector
          if (HUBS.has(ix.byId.get(s.to).type) && s.to !== b.id) continue;
          prev.set(s.to, { from: cur, step: s });
          queue.push(s.to);
        }
      }
      if (!prev.has(b.id)) return { from: brief(a), to: brief(b), connected: false, note: 'No path without going through a system or connector hub.', dataSource: 'sample data (Knowledge Graph example Space)' };
      const chain = [];
      for (let at = b.id; prev.get(at); at = prev.get(at).from) chain.unshift(prev.get(at));
      return {
        from: brief(a),
        to: brief(b),
        connected: true,
        length: chain.length,
        steps: chain.map((c) => ({ text: sentence(ix, ix.byId.get(c.from), c.step), from: c.from, to: c.step.to })),
        dataSource: 'sample data (Knowledge Graph example Space)',
      };
    },

    analyze_graph_impact(args = {}) {
      const ix = index();
      const depth = args.depth === undefined ? 2 : args.depth;
      if (!Number.isInteger(depth) || depth < 1 || depth > 4) throw new ToolError('depth must be an integer from 1 to 4');
      for (const t of args.types ?? []) if (!TYPE_KEYS.includes(t)) throw new ToolError(`types must be from: ${TYPE_KEYS.join(', ')}`);
      const start = resolve(ix, args.node);
      const dist = new Map([[start.id, 0]]);
      const via = new Map();
      const queue = [start.id];
      while (queue.length) {
        const cur = queue.shift();
        if (dist.get(cur) >= depth) continue;
        for (const s of ix.adj.get(cur)) {
          if (dist.has(s.to) || HUBS.has(ix.byId.get(s.to).type)) continue;
          dist.set(s.to, dist.get(cur) + 1);
          via.set(s.to, { from: cur, step: s });
          queue.push(s.to);
        }
      }
      const hit = [...dist.entries()].filter(([id, d]) => d > 0 && (!args.types?.length || args.types.includes(ix.byId.get(id).type)));
      const byDistance = {};
      for (const [id, d] of hit) {
        const n = ix.byId.get(id);
        const v = via.get(id);
        (byDistance[d] ??= []).push({ ...brief(n), via: sentence(ix, ix.byId.get(v.from), v.step) });
      }
      const byType = {};
      for (const [id] of hit) { const t = NODE_TYPES[ix.byId.get(id).type]; byType[t] = (byType[t] ?? 0) + 1; }
      return { node: brief(start), depth, affected: hit.length, byType, byDistance, ...view(start), dataSource: 'sample data (Knowledge Graph example Space)' };
    },
  };
}
