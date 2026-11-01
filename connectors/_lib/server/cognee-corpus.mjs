/**
 * Turns the Werkbank sample graph into plain-text documents that Cognee can read: one short document per node,
 * with its facts and its connections as sentences. Cognee then builds its own entities and relations from them,
 * so the result can be compared with the hand-built graph. Pure; nothing here needs Cognee.
 */

const sentence = (text) => `${text.replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '')}.`;

/** @returns {{ id: string, name: string, text: string }[]} */
export function graphToDocuments(graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const typeName = (node) => graph.nodeTypes?.[node.type]?.label ?? graph.nodeTypes?.[node.type] ?? node.type;
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    (outgoing.get(edge.source) ?? outgoing.set(edge.source, []).get(edge.source)).push(edge);
    (incoming.get(edge.target) ?? incoming.set(edge.target, []).get(edge.target)).push(edge);
  }
  const verbs = graph.edgeTypes ?? {};
  return graph.nodes.map((node) => {
    const lines = [sentence(`${node.label} is a ${typeName(node)} (${node.id})`)];
    for (const [key, value] of Object.entries(node.meta ?? {})) {
      if (value === '' || value === null || value === undefined) continue;
      lines.push(sentence(`${node.label}: ${key} is ${value}`));
    }
    for (const edge of outgoing.get(node.id) ?? []) {
      const other = byId.get(edge.target);
      lines.push(sentence(`${node.label} ${verbs[edge.type]?.verb ?? edge.type.toLowerCase().replaceAll('_', ' ')} ${other.label} (${typeName(other)})`));
    }
    for (const edge of incoming.get(node.id) ?? []) {
      const other = byId.get(edge.source);
      lines.push(sentence(`${node.label} ${verbs[edge.type]?.inverse ?? `is target of ${edge.type.toLowerCase().replaceAll('_', ' ')} from`} ${other.label} (${typeName(other)})`));
    }
    return { id: node.id, name: node.label, text: lines.join('\n') };
  });
}
