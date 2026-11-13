/**
 * The window's read access to the ontology catalog of the Ontology Manager connector (OntoRAG).
 * The catalog is a folder: `<ontology folder>/ontologies/catalog.json` plus one `<slug>.ttl` per ontology; metrics,
 * checks and company codes live in the instances file the connector reads. This module only reads (never writes) and
 * turns the Turtle files into the shape the Ontology view draws. The page gets data, never file paths to open.
 */
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
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
      slug: p.entry.slug, title: p.entry.label || p.entry.slug, status: 'published', owner: '', domain: '', approver: '', properties: p.props,
      openProposals: proposals.filter((m) => m?.slug === p.entry.slug && m?.status === 'proposed').length,
      example: false, terms, nodes, edges,
    };
  });
  return { ontologies, warnings };
}

// ------------------------------------------------------------------ governance (our own sidecar file)

const SLUG = /^[A-Za-z0-9_-]{1,80}$/;
const KINDS = ['agent', 'skill', 'report'];
const PLAN_STATUS = ['draft', 'asked', 'approved', 'rejected'];
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const emptyGovernance = () => ({ version: 1, ontologies: {}, bindings: [], views: [], plans: [], termMeta: {}, questions: [], usageDecisions: {} });
const TERM_STATUSES = ['draft', 'approved', 'deprecated'];

/**
 * Pure: whatever the page sends becomes the one shape we store, with limits. Owners and domains per ontology, which
 * agents/skills/reports use which term, which ontologies an agent gets as its view, and planned changes.
 * This file is ours (`governance.json` next to the catalog); the catalog itself is never written by the app.
 */
export function normalizeGovernance(input) {
  const g = emptyGovernance();
  const src = input && typeof input === 'object' ? input : {};
  for (const [slug, v] of Object.entries(src.ontologies && typeof src.ontologies === 'object' ? src.ontologies : {})) {
    if (!SLUG.test(slug)) continue;
    g.ontologies[slug] = { owner: str(v?.owner, 120), domain: str(v?.domain, 120), approver: str(v?.approver, 120) };
  }
  const seen = new Set();
  for (const b of Array.isArray(src.bindings) ? src.bindings.slice(0, 1000) : []) {
    const item = { slug: str(b?.slug, 80), term: str(b?.term, 120), kind: str(b?.kind, 20), name: str(b?.name, 120) };
    const key = `${item.slug}|${item.term}|${item.kind}|${item.name.toLowerCase()}`;
    if (!SLUG.test(item.slug) || !item.term || !KINDS.includes(item.kind) || !item.name || seen.has(key)) continue;
    seen.add(key);
    g.bindings.push(item);
  }
  for (const v of Array.isArray(src.views) ? src.views.slice(0, 100) : []) {
    const name = str(v?.name, 120);
    const slugs = [...new Set((Array.isArray(v?.slugs) ? v.slugs : []).map((x) => str(x, 80)).filter((x) => SLUG.test(x)))].slice(0, 50);
    if (name && !g.views.some((x) => x.name.toLowerCase() === name.toLowerCase())) g.views.push({ name, slugs });
  }
  for (const p of Array.isArray(src.plans) ? src.plans.slice(0, 200) : []) {
    const plan = {
      id: str(p?.id, 40), slug: str(p?.slug, 80), term: str(p?.term, 120), change: str(p?.change, 2000),
      status: PLAN_STATUS.includes(p?.status) ? p.status : 'draft', createdAt: str(p?.createdAt, 40),
      asked: (Array.isArray(p?.asked) ? p.asked : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 20),
    };
    if (plan.id && SLUG.test(plan.slug) && plan.term && plan.change) g.plans.push(plan);
  }
  // Lifecycle, synonyms and mappings per term, keyed "<slug>|<term id>" (additive: older files simply have none).
  const words = (list, max) => {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const v = str(raw, 80).replace(/\s+/g, ' ');
      if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
      if (out.length >= max) break;
    }
    return out;
  };
  let metaCount = 0;
  for (const [key, v] of Object.entries(src.termMeta && typeof src.termMeta === 'object' ? src.termMeta : {})) {
    const [slug, ...rest] = String(key).split('|');
    const term = str(rest.join('|'), 120);
    if (!SLUG.test(slug) || !term || metaCount >= 5000) continue;
    const status = TERM_STATUSES.includes(v?.status) ? v.status : '';
    const meta = {
      status, replacedBy: status === 'deprecated' ? str(v?.replacedBy, 120) : '', synonyms: words(v?.synonyms, 20),
      mappings: (Array.isArray(v?.mappings) ? v.mappings : []).map((x) => ({ system: str(x?.system, 60), ref: str(x?.ref, 120) })).filter((x) => x.system && x.ref).slice(0, 10),
    };
    if (!meta.status && !meta.replacedBy && !meta.synonyms.length && !meta.mappings.length) continue;
    g.termMeta[`${slug}|${term}`] = meta; metaCount++;
  }
  const qseen = new Set();
  for (const q of Array.isArray(src.questions) ? src.questions.slice(0, 500) : []) {
    const item = { id: str(q?.id, 40), slug: str(q?.slug, 80), text: str(q?.text, 300), terms: [...new Set((Array.isArray(q?.terms) ? q.terms : []).map((x) => str(x, 120)).filter(Boolean))].slice(0, 20) };
    if (!item.id || !SLUG.test(item.slug) || !item.text || !item.terms.length || qseen.has(item.id)) continue;
    qseen.add(item.id); g.questions.push(item);
  }
  // Decisions about found users: key "<slug>|<term>|<kind>:<ref>", decision confirmed or dismissed (additive: older files have none).
  let decisionCount = 0;
  for (const [key, v] of Object.entries(src.usageDecisions && typeof src.usageDecisions === 'object' ? src.usageDecisions : {})) {
    const k = str(key, 400);
    const [slug, term, rest] = k.split('|');
    if (decisionCount >= 2000 || !SLUG.test(slug ?? '') || !term || !/^(agent|workflow|feature|skill|space|report):.+/.test(rest ?? '')) continue;
    if (v?.decision !== 'confirmed' && v?.decision !== 'dismissed') continue;
    g.usageDecisions[k] = { decision: v.decision, by: str(v?.by, 120), at: str(v?.at, 40) };
    decisionCount++;
  }
  return g;
}

// ------------------------------------------------------------------ history (the connector keeps one backup per extension)

/** Names of the classes and properties a Turtle text declares (local names), for comparing versions. */
export function declaredNames(ttl) {
  const kinds = new Set([`${OWL}Class`, `${RDFS}Class`, `${OWL}ObjectProperty`, `${OWL}DatatypeProperty`]);
  const names = new Set();
  for (const [iri, s] of indexOf(quadsOf(ttl))) if (s.types.some((t) => kinds.has(t))) names.add(local(iri));
  return names;
}

/** Pure: versions oldest to newest (the backups, then the current one), each with what it added and removed compared with the one before. */
export function versionsOf(backups, currentTtl) {
  const list = [...backups].sort((a, b) => a.stamp.localeCompare(b.stamp)).map((b) => ({ file: b.file, stamp: b.stamp, names: declaredNames(b.ttl) }));
  list.push({ file: 'current', stamp: '', names: declaredNames(currentTtl) });
  return list.map((v, i) => {
    const prev = i ? list[i - 1].names : null;
    return {
      file: v.file, at: stampToIso(v.stamp), terms: v.names.size,
      added: prev ? [...v.names].filter((n) => !prev.has(n)).sort() : [],
      removed: prev ? [...prev].filter((n) => !v.names.has(n)).sort() : [],
    };
  });
}

function stampToIso(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : '';
}

/** Pure: a proposal's meta and report for the review screen (counts, items with evidence, what needs attention). */
export function proposalView(meta, report) {
  const pick = (key) => (Array.isArray(report?.[key]) ? report[key].slice(0, 200).map((it) => ({
    name: str(it?.name, 120), action: ['new', 'extend', 'reuse'].includes(it?.action) ? it.action : 'new',
    description: str(it?.description, 600), evidence: (Array.isArray(it?.evidence) ? it.evidence : []).map((q) => str(String(q), 400)).slice(0, 3),
    domain: str(it?.domain, 120), range: str(it?.range, 120), baseline: str(it?.baseline, 200),
    confidence: str(it?.confidence, 20), rationale: str(it?.rationale, 400),
  })) : []);
  return {
    id: str(meta?.id, 100), slug: str(meta?.slug, 80), mode: meta?.mode === 'extend' ? 'extend' : 'new',
    label: str(meta?.label, 160), status: str(meta?.status, 20), createdAt: str(meta?.created_at, 40), model: str(meta?.model, 120),
    error: str(meta?.error, 400),
    documents: (Array.isArray(meta?.documents) ? meta.documents : []).slice(0, 25).map((d) => ({ file: str(d?.file, 200), chunks: Number(d?.chunks) || 0 })),
    counts: meta?.counts ?? report?.counts ?? {},
    classes: pick('classes'), datatypeProperties: pick('datatype_properties'), objectProperties: pick('object_properties'),
    needsAttention: (Array.isArray(report?.needs_attention) ? report.needs_attention : []).slice(0, 100).map((n) => ({ kind: str(n?.kind, 40), name: str(n?.name, 120), why: str(n?.why, 200) })),
    warnings: (Array.isArray(report?.warnings) ? report.warnings : []).map((w) => str(String(w), 300)).slice(0, 10),
  };
}

const readText = (file) => {
  const text = readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`${basename(file)} is larger than 5 MB`);
  return text;
};

/** `readSettings()` returns { folder, instancesFile } from the connector's settings, or null when it is not installed. */
export function createOntologyStore({ readSettings, bundledInstances }) {
  const dirOf = (s) => join(s.folder, 'ontologies');
  const readJson = (file) => JSON.parse(readText(file));
  return {
    read() {
      const s = readSettings();
      if (!s?.folder) return { ok: false, code: 'not-configured', detail: 'The Ontology Manager connector is not installed or has no ontology folder yet.' };
      const dir = dirOf(s);
      const manifest = join(dir, 'catalog.json');
      if (!existsSync(manifest)) return { ok: false, code: 'no-catalog', detail: `No catalog in ${dir} yet. It is created when the connector starts for the first time.` };
      try {
        const catalog = readJson(manifest);
        const files = {};
        for (const e of catalog.ontologies ?? []) {
          // the manifest may only name files directly in the catalog folder
          if (typeof e.slug !== 'string' || typeof e.path !== 'string' || basename(e.path) !== e.path || !e.path.endsWith('.ttl')) continue;
          const f = join(dir, e.path);
          if (existsSync(f)) files[e.slug] = readText(f);
        }
        const instFile = s.instancesFile && existsSync(s.instancesFile) ? s.instancesFile : bundledInstances;
        const instancesTtl = instFile && existsSync(instFile) ? readText(instFile) : '';

        // proposals: meta.json (+ report.json) per folder; drafts for new ontologies are read from staging.ttl
        const metas = [];
        const proposals = [];
        const pdir = join(s.folder, 'proposals');
        const draftFiles = {};
        const draftEntries = [];
        const warnings = [];
        if (existsSync(pdir)) {
          for (const d of readdirSync(pdir, { withFileTypes: true })) {
            const m = join(pdir, d.name, 'meta.json');
            if (!d.isDirectory() || !existsSync(m)) continue;
            try {
              const meta = readJson(m);
              metas.push(meta);
              const rp = join(pdir, d.name, 'report.json');
              proposals.push(proposalView(meta, existsSync(rp) ? readJson(rp) : null));
              const st = join(pdir, d.name, 'staging.ttl');
              if (meta.status === 'proposed' && meta.mode === 'new' && !files[meta.slug] && existsSync(st) && SLUG.test(String(meta.slug))) {
                draftFiles[meta.slug] = readText(st);
                draftEntries.push({ slug: meta.slug, label: meta.label || meta.slug, path: `${meta.slug}.ttl` });
              }
            } catch { /* skip unreadable */ }
          }
        }
        proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const built = buildOntologies({ catalog, files, instancesTtl, proposals: metas });
        warnings.push(...built.warnings);
        const drafts = buildOntologies({ catalog: { ontologies: draftEntries }, files: draftFiles, instancesTtl: '', proposals: metas });
        warnings.push(...drafts.warnings);
        for (const o of drafts.ontologies) o.status = 'draft';

        // history: one backup per extension in _history, compared version by version
        const history = {};
        const hdir = join(dir, '_history');
        const backups = existsSync(hdir) ? readdirSync(hdir).filter((f) => f.endsWith('.ttl')) : [];
        for (const o of built.ontologies) {
          const mine = [];
          for (const f of backups) {
            const m = /^(.+)-(\d{8}T\d{6}Z)\.ttl$/.exec(f);
            if (m && m[1] === o.slug) { try { mine.push({ file: f, stamp: m[2], ttl: readText(join(hdir, f)) }); } catch { /* skip */ } }
          }
          if (mine.length) { try { history[o.slug] = versionsOf(mine, files[o.slug]); } catch (e) { warnings.push(`${o.slug}: history not readable (${e?.message ?? e})`); } }
        }

        const gfile = join(dir, 'governance.json');
        let governance = emptyGovernance();
        if (existsSync(gfile)) { try { governance = normalizeGovernance(readJson(gfile)); } catch (e) { warnings.push(`governance.json: not readable (${e?.message ?? e})`); } }

        return {
          ok: true, ontologies: [...built.ontologies, ...drafts.ontologies], warnings, folder: s.folder,
          instances: instancesTtl ? (instFile === bundledInstances ? 'bundled' : 'configured') : 'none',
          proposals, history, governance,
        };
      } catch (e) {
        return { ok: false, code: 'unreadable', detail: `The catalog could not be read: ${e?.message ?? e}` };
      }
    },

    /** Which shared revision the local governance.json is based on, and whether it has changes the database does not have yet. */
    sharedMeta() {
      const s = readSettings();
      if (!s?.folder) return { rev: 0, dirty: false };
      try {
        const m = readJson(join(dirOf(s), 'governance.shared.json'));
        return { rev: Math.max(0, Number(m?.rev) || 0), dirty: m?.dirty === true };
      } catch { return { rev: 0, dirty: false }; }
    },
    setSharedMeta(meta) {
      const s = readSettings();
      if (!s?.folder) return false;
      const dir = dirOf(s);
      if (!existsSync(dir)) return false;
      writeFileSync(join(dir, 'governance.shared.json'), `${JSON.stringify({ rev: Math.max(0, Number(meta?.rev) || 0), dirty: meta?.dirty === true })}\n`, 'utf8');
      return true;
    },
    /** Keeps the person's own version next to the shared one when somebody else saved first. */
    saveLocalCopy(input) {
      const s = readSettings();
      if (!s?.folder || !existsSync(dirOf(s))) return false;
      writeFileSync(join(dirOf(s), 'governance.local-copy.json'), `${JSON.stringify(normalizeGovernance(input), null, 2)}\n`, 'utf8');
      return true;
    },

    /** Writes our own `governance.json` next to the catalog (never the catalog). Returns the stored, normalized content. */
    saveGovernance(input) {
      const s = readSettings();
      if (!s?.folder) return { ok: false, detail: 'The Ontology Manager connector is not installed or has no ontology folder yet.' };
      const dir = dirOf(s);
      if (!existsSync(dir)) return { ok: false, detail: `No catalog folder at ${dir} yet.` };
      try {
        const governance = normalizeGovernance(input);
        const text = `${JSON.stringify(governance, null, 2)}\n`;
        if (Buffer.byteLength(text) > 1024 * 1024) return { ok: false, detail: 'The governance data is larger than 1 MB.' };
        const target = join(dir, 'governance.json');
        const tmp = `${target}.tmp`;
        writeFileSync(tmp, text, 'utf8');
        renameSync(tmp, target);
        return { ok: true, governance };
      } catch (e) {
        return { ok: false, detail: `Could not save: ${e?.message ?? e}` };
      }
    },
  };
}
