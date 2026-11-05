/**
 * The window's read access to the ontology catalog of the Ontology Manager connector (OntoRAG).
 * The catalog is a folder: `<ontology folder>/ontologies/catalog.json` plus one `<slug>.ttl` per ontology; metrics,
 * checks and company codes live in the instances file the connector reads. This module only reads (never writes) and
 * turns the Turtle files into the shape the Ontology view draws. The page gets data, never file paths to open.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Parser } from 'n3';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const MAX_BYTES = 5 * 1024 * 1024;

const local = (iri) => String(iri).split('#').pop().split('/').pop();

function quadsOf(text) {
  return new Parser().parse(text);
}

/** Literal values by subject and predicate, with their language tags, from parsed quads. */
function indexOf(quads) {
  const bySubject = new Map();
  for (const q of quads) {
    if (q.subject.termType !== 'NamedNode') continue;
    const s = bySubject.get(q.subject.value) ?? { types: [], lits: new Map(), links: [] };
    if (q.predicate.value === RDF_TYPE) { if (q.object.termType === 'NamedNode') s.types.push(q.object.value); }
    else if (q.object.termType === 'Literal') {
      const list = s.lits.get(q.predicate.value) ?? [];
      list.push({ value: q.object.value, lang: q.object.language || '' });
      s.lits.set(q.predicate.value, list);
    } else if (q.object.termType === 'NamedNode') s.links.push({ prop: q.predicate.value, to: q.object.value });
    bySubject.set(q.subject.value, s);
  }
  return bySubject;
}

/** English first, then German, then whatever there is. */
function pick(list) {
  if (!list?.length) return '';
  return (list.find((l) => l.lang === 'en') ?? list.find((l) => l.lang === 'de') ?? list[0]).value;
}
const lit = (s, iri) => pick(s?.lits.get(iri));
const named = (s, name) => {
  for (const [k, v] of s?.lits ?? []) if (local(k) === name) return pick(v);
  return '';
};

/**
 * Pure: catalog manifest, Turtle text per slug, instances Turtle, proposal metas -> ontologies for the view.
 * An instance belongs to the ontology that declares its class. A resource with a definition, formula or certifier is a metric.
 */
export function buildOntologies({ catalog, files, instancesTtl = '', proposals = [] }) {
  const warnings = [];
  const parsed = [];
  for (const entry of catalog?.ontologies ?? []) {
    const text = files[entry.slug];
    if (text == null) { warnings.push(`${entry.slug}: file missing`); continue; }
    try {
      const idx = indexOf(quadsOf(text));
      const classes = new Set([...idx].filter(([, s]) => s.types.some((t) => t === `${OWL}Class` || t === `${RDFS}Class`)).map(([iri]) => iri));
      const props = [...idx.values()].filter((s) => s.types.some((t) => t === `${OWL}ObjectProperty` || t === `${OWL}DatatypeProperty`)).length;
      parsed.push({ entry, idx, classes, props });
    } catch (e) { warnings.push(`${entry.slug}: not readable (${e?.message ?? e})`); }
  }
  let inst = new Map();
  if (instancesTtl.trim()) {
    try { inst = indexOf(quadsOf(instancesTtl)); } catch (e) { warnings.push(`instances: not readable (${e?.message ?? e})`); }
  }
  const classOwner = new Map();
  for (const p of parsed) for (const c of p.classes) classOwner.set(c, p);
  const classLabel = (iri) => {
    const p = classOwner.get(iri);
    return lit(p?.idx.get(iri), `${RDFS}label`) || local(iri);
  };
  const instOwner = (iri) => { for (const t of inst.get(iri)?.types ?? []) if (classOwner.has(t)) return classOwner.get(t); return null; };

  const ontologies = parsed.map((p) => {
    const mine = [...inst].filter(([iri]) => instOwner(iri) === p);
    const mineIri = new Set(mine.map(([iri]) => iri));
    const isMetric = (s) => [...s.lits.keys()].some((k) => ['definition', 'formula', 'certifiedBy'].includes(local(k)));
    const subclasses = new Map();
    for (const [iri, s] of p.idx) for (const l of s.links) if (l.prop === `${RDFS}subClassOf` && p.classes.has(iri)) subclasses.set(l.to, [...(subclasses.get(l.to) ?? []), iri]);

    const terms = [];
    for (const iri of [...p.classes].sort()) {
      if (local(iri).startsWith('_')) continue;
      const s = p.idx.get(iri);
      const subs = (subclasses.get(iri) ?? []).map(local).sort();
      const members = subs.length ? subs : mine.filter(([, v]) => v.types.includes(iri)).map(([i]) => local(i)).sort();
      terms.push({
        id: local(iri), label: lit(s, `${RDFS}label`) || local(iri), kind: 'class', definition: lit(s, `${RDFS}comment`),
        formula: '', owner: '', members, membersKind: members.length ? (subs.length ? 'subclasses' : 'instances') : 'none',
      });
    }
    for (const [iri, s] of mine) {
      if (!isMetric(s)) continue;
      terms.push({
        id: local(iri), label: lit(s, `${RDFS}label`) || local(iri), kind: 'metric', definition: named(s, 'definition'),
        formula: named(s, 'formula'), owner: named(s, 'certifiedBy'), members: [], membersKind: 'none',
      });
    }
    const nodes = mine.map(([iri, s]) => ({
      // a resource with a short code (DE10) is shown by its code; its descriptive name moves to the note
      id: local(iri), label: named(s, 'code') || lit(s, `${RDFS}label`) || local(iri),
      type: isMetric(s) ? 'Metric' : (s.types.map((t) => classLabel(t))[0] ?? 'Resource'),
      note: named(s, 'tableName') || (named(s, 'code') ? lit(s, `${RDFS}label`) : ''),
    }));
    const edges = [];
    for (const [iri, s] of mine) for (const l of s.links) if (mineIri.has(l.to)) edges.push({ from: local(iri), prop: local(l.prop), to: local(l.to) });
    return {
      slug: p.entry.slug, title: p.entry.label || p.entry.slug, status: 'published', owner: '', properties: p.props,
      openProposals: proposals.filter((m) => m?.slug === p.entry.slug && m?.status === 'proposed').length,
      example: false, terms, nodes, edges,
    };
  });
  return { ontologies, warnings };
}

const readText = (file) => {
  const text = readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`${basename(file)} is larger than 5 MB`);
  return text;
};

/** `readSettings()` returns { folder, instancesFile } from the connector's settings, or null when it is not installed. */
export function createOntologyStore({ readSettings, bundledInstances }) {
  return {
    read() {
      const s = readSettings();
      if (!s?.folder) return { ok: false, code: 'not-configured', detail: 'The Ontology Manager connector is not installed or has no ontology folder yet.' };
      const dir = join(s.folder, 'ontologies');
      const manifest = join(dir, 'catalog.json');
      if (!existsSync(manifest)) return { ok: false, code: 'no-catalog', detail: `No catalog in ${dir} yet. It is created when the connector starts for the first time.` };
      try {
        const catalog = JSON.parse(readText(manifest));
        const files = {};
        for (const e of catalog.ontologies ?? []) {
          // the manifest may only name files directly in the catalog folder
          if (typeof e.slug !== 'string' || typeof e.path !== 'string' || basename(e.path) !== e.path || !e.path.endsWith('.ttl')) continue;
          const f = join(dir, e.path);
          if (existsSync(f)) files[e.slug] = readText(f);
        }
        const instFile = s.instancesFile && existsSync(s.instancesFile) ? s.instancesFile : bundledInstances;
        const instancesTtl = instFile && existsSync(instFile) ? readText(instFile) : '';
        const proposals = [];
        const pdir = join(s.folder, 'proposals');
        if (existsSync(pdir)) {
          for (const d of readdirSync(pdir, { withFileTypes: true })) {
            const m = join(pdir, d.name, 'meta.json');
            if (d.isDirectory() && existsSync(m)) { try { proposals.push(JSON.parse(readText(m))); } catch { /* skip unreadable */ } }
          }
        }
        const built = buildOntologies({ catalog, files, instancesTtl, proposals });
        return { ok: true, ontologies: built.ontologies, warnings: built.warnings, folder: s.folder, instances: instancesTtl ? (instFile === bundledInstances ? 'bundled' : 'configured') : 'none' };
      } catch (e) {
        return { ok: false, code: 'unreadable', detail: `The catalog could not be read: ${e?.message ?? e}` };
      }
    },
  };
}
