/**
 * Failure propagation over the knowledge graph ("what breaks if this fails?").
 *
 * A transparent rule model, not a forecast: the failed node starts at exposure 1. Exposure is passed on along
 * relations and shrinks with every step (strong relation x0.7, weak relation x0.3). Each node keeps the strongest
 * route to it. Nodes below the spread threshold are not affected. System and connector hubs are never passed through,
 * so the result stays about business relations (same rule as the chat tool analyze_graph_impact). People, tools, apps, customers and product families are affected but do not pass the failure on.
 *
 * The code between BEGIN-MODEL and END-MODEL is embedded verbatim into the Space page by
 * scripts/sync-knowledge-graph.mjs, so the page and the tests run the same rules.
 */
// BEGIN-MODEL
const FAILURE_RULES = { strong: 0.7, weak: 0.3, spread: 0.3, maxHops: 5, hubTypes: ['system', 'connector'], leafTypes: ['person', 'tool', 'app', 'customer', 'family'] };

/** "€2,840,000" -> 2840000, "70%" -> 70, anything else -> null. */
function parseNumber(text) {
  const digits = String(text ?? '').replace(/[^0-9.]/g, '');
  return digits && /\d/.test(digits) ? Number(digits) : null;
}

/** Money attached to a node, in EUR a year: contracts and offers (offers weighted by win probability) and skills (monthly value x 12). */
function nodeValueEur(node) {
  const m = node.meta ?? {};
  if (node.type === 'contract') return parseNumber(m['Annual value']) ?? 0;
  if (node.type === 'offer') {
    const p = parseNumber(m['Win probability']);
    return Math.round((parseNumber(m['Annual value']) ?? 0) * (p === null ? 1 : p / 100));
  }
  if (node.type === 'skill') return (parseNumber(m['Value last full month']) ?? 0) * 12;
  return 0;
}

function simulateFailure(graph, originId, options = {}) {
  const rules = { ...FAILURE_RULES, ...options };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const origin = byId.get(originId);
  if (!origin) throw new Error(`unknown node ${originId}`);
  const hub = new Set(rules.hubTypes);
  const leaf = new Set(rules.leafTypes);
  const adj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    const weak = !!(graph.edgeTypes?.[e.type] ?? {}).weak;
    adj.get(e.source)?.push({ to: e.target, e, weak });
    adj.get(e.target)?.push({ to: e.source, e, weak });
  }
  const best = new Map([[originId, { exposure: 1, hop: 0, via: null }]]);
  const open = new Set([originId]);
  while (open.size) {
    let cur = null;
    for (const id of open) if (cur === null || best.get(id).exposure > best.get(cur).exposure) cur = id;
    open.delete(cur);
    const here = best.get(cur);
    if (here.hop >= rules.maxHops || (cur !== originId && leaf.has(byId.get(cur).type))) continue;
    for (const s of adj.get(cur)) {
      if (hub.has(byId.get(s.to).type)) continue;
      const exposure = here.exposure * (s.weak ? rules.weak : rules.strong);
      if (exposure < rules.spread) continue;
      const known = best.get(s.to);
      if (known && known.exposure >= exposure) continue;
      best.set(s.to, { exposure, hop: here.hop + 1, via: { from: cur, edge: s.e } });
      open.add(s.to);
    }
  }
  const reached = [...best.entries()]
    .map(([id, b]) => {
      const n = byId.get(id);
      return { id, type: n.type, label: n.label, hop: b.hop, exposure: Math.round(b.exposure * 100) / 100, valueEur: nodeValueEur(n), via: b.via ? b.via.from : null, edge: b.via ? b.via.edge : null };
    })
    .sort((a, b) => b.exposure - a.exposure || a.hop - b.hop || a.label.localeCompare(b.label));
  const others = reached.filter((r) => r.id !== originId);
  const byType = {};
  for (const r of others) byType[r.type] = (byType[r.type] ?? 0) + 1;
  const sum = (list, f) => list.reduce((a, r) => a + f(r), 0);
  const meta = (r) => byId.get(r.id).meta ?? {};
  return {
    origin: { id: origin.id, type: origin.type, label: origin.label },
    spread: rules.spread,
    reached,
    affected: others.length,
    byType,
    exposedEur: sum(reached, (r) => r.valueEur),
    atRiskEur: Math.round(sum(reached, (r) => r.valueEur * r.exposure)),
    agentsInProduction: sum(others.filter((r) => r.type === 'agent'), (r) => parseNumber(meta(r)['In production']) ?? 0),
    workflowRuns14d: sum(others.filter((r) => r.type === 'workflow'), (r) => parseNumber(meta(r)['Runs (14 days)']) ?? 0),
    maxHop: reached.reduce((a, r) => Math.max(a, r.hop), 0),
    assumptions: [
      'Der Ausfall startet mit Exposition 1 und wird entlang der Beziehungen weitergegeben.',
      'Eine starke Beziehung behält 70 %, eine schwache (Betrieb, Listing) 30 % der Exposition, die Exposition sinkt also mit jedem Schritt.',
      `Knoten unter ${Math.round(rules.spread * 100)} % Exposition gelten als nicht betroffen.`,
      'Systeme und der Connector werden nicht durchlaufen; Personen, Tools, Apps, Kunden und Produktfamilien sind betroffen, geben den Ausfall aber nicht weiter.',
      'Geld: Jahreswert von Verträgen, Angeboten (gewichtet mit der Gewinnwahrscheinlichkeit) und Skills (Monatswert x 12); "gefährdet" ist der mit der Exposition gewichtete Anteil.',
    ],
  };
}
// END-MODEL

export { FAILURE_RULES, parseNumber, nodeValueEur, simulateFailure };
