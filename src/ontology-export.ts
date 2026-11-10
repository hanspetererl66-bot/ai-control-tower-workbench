/**
 * Ontology Manager, export: the ontology as Turtle (OWL and SKOS), JSON-LD, or a glossary as CSV. Pure functions, no file access:
 * the screen hands the text to a download. What is exported is what the screen shows: terms, resources, links, and, from
 * governance.json, owner, lifecycle status, synonyms and mappings. Nothing about people is included except the names in the
 * owner field, and the catalog itself is never written.
 */
import { metaOf, statusOf, type Governance, type Ontology } from './ontology-manager.ts';

export type ExportFormat = 'turtle' | 'jsonld' | 'csv';
export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; ext: string; mime: string; note: string }> = [
  { id: 'turtle', label: 'Turtle (OWL + SKOS)', ext: 'ttl', mime: 'text/turtle', note: 'For tools that read RDF: Protégé, a triple store, OntoRAG.' },
  { id: 'jsonld', label: 'JSON-LD', ext: 'jsonld', mime: 'application/ld+json', note: 'The same graph as JSON, for web tools and APIs.' },
  { id: 'csv', label: 'Glossary (CSV)', ext: 'csv', mime: 'text/csv', note: 'One row per term for a spreadsheet or a wiki.' },
];

const NS = (slug: string) => `https://werkbank.example/ontology/${slug}#`;
const SAFE = (id: string) => id.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1') || '_';
const lit = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;

export const exportName = (o: Ontology, f: ExportFormat): string => `${o.slug}.${EXPORT_FORMATS.find((x) => x.id === f)?.ext ?? 'txt'}`;

/** Turtle: classes as owl:Class, metrics as skos:Concept of type wb:Metric, resources as individuals, links as wb: properties. */
export function toTurtle(o: Ontology, gov: Governance): string {
  const out: string[] = [
    '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
    '@prefix dct: <http://purl.org/dc/terms/> .',
    `@prefix wb: <${NS(o.slug)}> .`,
    '',
    `<${NS(o.slug).slice(0, -1)}> a owl:Ontology ; rdfs:label ${lit(o.title)} ; owl:versionInfo ${lit(o.status)} .`,
    '',
  ];
  const termIds = new Set(o.terms.map((t) => t.id));
  for (const t of o.terms) {
    const meta = metaOf(gov, o.slug, t.id);
    const st = statusOf(o, gov, t);
    const parts: string[] = [`${t.kind === 'metric' ? 'a skos:Concept, wb:Metric' : 'a owl:Class'}`, `rdfs:label ${lit(t.label)}`];
    if (t.definition.trim()) parts.push(`skos:definition ${lit(t.definition)}`);
    if (t.formula.trim()) parts.push(`wb:formula ${lit(t.formula)}`);
    if (t.owner.trim()) parts.push(`wb:owner ${lit(t.owner)}`);
    parts.push(`wb:status ${lit(st)}`);
    for (const w of meta.synonyms) parts.push(`skos:altLabel ${lit(w)}`);
    if (st === 'deprecated') {
      parts.push('owl:deprecated true');
      if (meta.replacedBy && termIds.has(meta.replacedBy)) parts.push(`dct:isReplacedBy wb:${SAFE(meta.replacedBy)}`);
    }
    for (const m of meta.mappings) parts.push(`wb:mappedTo [ wb:system ${lit(m.system)} ; wb:reference ${lit(m.ref)} ]`);
    out.push(`wb:${SAFE(t.id)}\n    ${parts.join(' ;\n    ')} .`, '');
  }
  for (const n of o.nodes) {
    if (termIds.has(n.id)) continue;
    const parts = [`a wb:${SAFE(n.type || 'Resource')}`, `rdfs:label ${lit(n.label)}`];
    if (n.note.trim()) parts.push(`rdfs:comment ${lit(n.note)}`);
    out.push(`wb:${SAFE(n.id)}\n    ${parts.join(' ;\n    ')} .`, '');
  }
  for (const e of o.edges) out.push(`wb:${SAFE(e.from)} wb:${SAFE(e.prop)} wb:${SAFE(e.to)} .`);
  return `${out.join('\n')}\n`;
}

/** JSON-LD with the same content. */
export function toJsonLd(o: Ontology, gov: Governance): string {
  const base = NS(o.slug);
  const iri = (id: string) => `${base}${SAFE(id)}`;
  const termIds = new Set(o.terms.map((t) => t.id));
  const graph: Array<Record<string, unknown>> = [{ '@id': base.slice(0, -1), '@type': 'owl:Ontology', 'rdfs:label': o.title, 'owl:versionInfo': o.status }];
  for (const t of o.terms) {
    const meta = metaOf(gov, o.slug, t.id);
    const st = statusOf(o, gov, t);
    const node: Record<string, unknown> = { '@id': iri(t.id), '@type': t.kind === 'metric' ? ['skos:Concept', 'wb:Metric'] : 'owl:Class', 'rdfs:label': t.label, 'wb:status': st };
    if (t.definition.trim()) node['skos:definition'] = t.definition;
    if (t.formula.trim()) node['wb:formula'] = t.formula;
    if (t.owner.trim()) node['wb:owner'] = t.owner;
    if (meta.synonyms.length) node['skos:altLabel'] = meta.synonyms;
    if (st === 'deprecated') {
      node['owl:deprecated'] = true;
      if (meta.replacedBy && termIds.has(meta.replacedBy)) node['dct:isReplacedBy'] = { '@id': iri(meta.replacedBy) };
    }
    if (meta.mappings.length) node['wb:mappedTo'] = meta.mappings.map((m) => ({ 'wb:system': m.system, 'wb:reference': m.ref }));
    for (const e of o.edges.filter((x) => x.from === t.id)) {
      const key = `wb:${SAFE(e.prop)}`;
      const cur = node[key] as Array<{ '@id': string }> | undefined;
      node[key] = [...(cur ?? []), { '@id': iri(e.to) }];
    }
    graph.push(node);
  }
  for (const n of o.nodes) {
    if (termIds.has(n.id)) continue;
    const node: Record<string, unknown> = { '@id': iri(n.id), '@type': `wb:${SAFE(n.type || 'Resource')}`, 'rdfs:label': n.label };
    if (n.note.trim()) node['rdfs:comment'] = n.note;
    for (const e of o.edges.filter((x) => x.from === n.id)) {
      const key = `wb:${SAFE(e.prop)}`;
      const cur = node[key] as Array<{ '@id': string }> | undefined;
      node[key] = [...(cur ?? []), { '@id': iri(e.to) }];
    }
    graph.push(node);
  }
  const context = { owl: 'http://www.w3.org/2002/07/owl#', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', skos: 'http://www.w3.org/2004/02/skos/core#', dct: 'http://purl.org/dc/terms/', wb: base };
  return `${JSON.stringify({ '@context': context, '@graph': graph }, null, 2)}\n`;
}

/** A cell that starts with = + - or @ would run as a formula in a spreadsheet; a leading apostrophe stops that. */
const cell = (v: string): string => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Glossary: one row per term. */
export function toGlossaryCsv(o: Ontology, gov: Governance): string {
  const head = ['Term', 'Id', 'Type', 'Status', 'Definition', 'Synonyms', 'Owner', 'Replaced by', 'Mappings', 'Formula'];
  const rows = o.terms.map((t) => {
    const meta = metaOf(gov, o.slug, t.id);
    const repl = o.terms.find((x) => x.id === meta.replacedBy)?.label ?? meta.replacedBy;
    return [t.label, t.id, t.kind === 'metric' ? 'Metric' : 'Class', statusOf(o, gov, t), t.definition, meta.synonyms.join('; '), t.owner, repl, meta.mappings.map((m) => `${m.system}: ${m.ref}`).join('; '), t.formula];
  });
  return `${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function exportText(o: Ontology, gov: Governance, f: ExportFormat): string {
  return f === 'turtle' ? toTurtle(o, gov) : f === 'jsonld' ? toJsonLd(o, gov) : toGlossaryCsv(o, gov);
}
