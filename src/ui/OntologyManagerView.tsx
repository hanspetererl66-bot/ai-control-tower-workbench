import { useMemo, useState } from 'react';
import {
  HEALTH_LABEL, companyCodesIn, filterTerms, healthOf, impactOf, kpis, ownerLabel, propLabel, usedLabel,
  type Ontology, type Term, type TermFilter,
} from '../ontology-manager';

const FILTERS: Array<{ id: TermFilter; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'metrics', label: 'Metrics' }, { id: 'classes', label: 'Classes' }, { id: 'attention', label: 'Needs attention' },
];

/**
 * Ontology Manager, catalog (design proposal 1): the ontologies, every term with its owner, use and health, and the
 * details of the selected term including what depends on it. Read-only. Until the view is connected to the connector's
 * catalog it shows the bundled Finance Pre-Close sample and says so.
 */
export default function OntologyManagerView({ ontologies, onBack }: { ontologies: Ontology[]; onBack: () => void }) {
  const [slug, setSlug] = useState(ontologies[0]?.slug ?? '');
  const [filter, setFilter] = useState<TermFilter>('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState('DSO');
  const onto = ontologies.find((o) => o.slug === slug) ?? ontologies[0];
  const k = useMemo(() => (onto ? kpis(onto) : null), [onto]);
  const rows = useMemo(() => (onto ? filterTerms(onto, filter, query) : []), [onto, filter, query]);
  if (!onto || !k) return <main className="om"><p className="om-note">No ontology in the catalog yet.</p></main>;
  const selected = onto.terms.find((t) => t.id === picked) ?? rows[0] ?? onto.terms[0];
  const counts: Record<TermFilter, number> = {
    all: onto.terms.length, metrics: k.metrics, classes: k.classes, attention: k.needAttention,
  };

  return (
    <main className="om">
      <header className="om-hero">
        <button className="om-back" onClick={onBack} aria-label="Back to Develop">←</button>
        <div className="om-hero-text">
          <p className="om-crumb">Develop</p>
          <h1>Know what every term means, <span>and who stands behind it.</span></h1>
          <p className="om-lede">The shared vocabulary of your agents in one place: owned, reviewed and traceable to the document it came from.</p>
        </div>
        <label className="om-search">
          <span className="om-sr">Search terms</span>
          <input type="search" value={query} placeholder="Search terms, definitions, owners" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </header>

      {onto.example && <p className="om-note" role="note">Example data: the bundled Finance Pre-Close sample. It is not yet read from your ontology catalog, and nothing here can be changed.</p>}

      <section className="om-kpis" aria-label="Summary">
        <div className="om-kpi"><span>Classes</span><b>{k.classes}</b></div>
        <div className="om-kpi"><span>Properties</span><b>{k.properties}</b></div>
        <div className="om-kpi"><span>Certified metrics</span><b>{k.metrics}</b></div>
        <div className="om-kpi om-kpi-wide">
          <span>Classes with a definition</span>
          <b>{k.definedClasses} <small>of {k.classes}</small></b>
          <i className="om-meter" role="img" aria-label={`${Math.round(k.coverage * 100)} percent`}><i style={{ width: `${Math.round(k.coverage * 100)}%` }} /></i>
        </div>
        <div className="om-kpi"><span>Open proposals</span><b className="om-brand">{k.openProposals}</b></div>
      </section>

      <div className="om-grid">
        <aside className="om-side" aria-label="Ontologies">
          <h2>Ontologies</h2>
          {ontologies.map((o) => {
            const ok = kpis(o);
            return (
              <button key={o.slug} className={`om-ont ${o.slug === onto.slug ? 'om-ont-on' : ''}`} aria-pressed={o.slug === onto.slug}
                onClick={() => { setSlug(o.slug); setFilter('all'); setQuery(''); setPicked(o.terms[0]?.id ?? ''); }}>
                <span className="om-ont-top"><b>{o.title}</b><span className={`om-chip ${o.status === 'published' ? 'om-ok' : 'om-warn'}`}>{o.status === 'published' ? 'Published' : 'Draft'}</span></span>
                <span className="om-sub">{o.slug} · {ok.classes} classes · {o.properties} properties</span>
                <span className="om-sub">Owner: {o.owner || 'not assigned'}</span>
                <i className="om-meter"><i style={{ width: `${Math.round(ok.coverage * 100)}%` }} /></i>
              </button>
            );
          })}
          <p className="om-note-small">Each ontology gets an owner and a domain. An agent receives a view composed from the ontologies it needs.</p>
        </aside>

        <section className="om-table" aria-label="Terms">
          <div className="om-table-head">
            <h2>Terms in {onto.slug}</h2>
            <div className="om-filters" role="group" aria-label="Filter terms">
              {FILTERS.map((f) => (
                <button key={f.id} className={`om-filter ${filter === f.id ? 'om-filter-on' : ''} ${f.id === 'attention' ? 'om-filter-warn' : ''}`}
                  aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} {counts[f.id]}</button>
              ))}
            </div>
          </div>
          <div className="om-row om-row-head" aria-hidden="true"><span>Term</span><span>Kind</span><span>Owner</span><span>Used by</span><span>Health</span></div>
          {rows.length === 0 && <p className="om-empty">No term matches.</p>}
          {rows.map((t, i) => (
            <button key={t.id} className={`om-row ${t.id === selected?.id ? 'om-row-on' : ''}`} style={{ ['--i' as string]: i }}
              aria-pressed={t.id === selected?.id} onClick={() => setPicked(t.id)}>
              <span className="om-term">{t.label}</span>
              <span className="om-dim">{t.kind === 'metric' ? 'Metric' : 'Class'}</span>
              <span className="om-dim">{ownerLabel(t)}</span>
              <span>{usedLabel(onto, t)}</span>
              <span><span className={`om-chip ${healthOf(t) === 'complete' ? 'om-ok' : 'om-warn'}`}>{HEALTH_LABEL[healthOf(t)]}</span></span>
            </button>
          ))}
          <p className="om-foot">Showing {rows.length} of {onto.terms.length} terms</p>
        </section>

        {selected && <Details key={selected.id} onto={onto} term={selected} />}
      </div>
    </main>
  );
}

function Details({ onto, term }: { onto: Ontology; term: Term }) {
  const impact = useMemo(() => impactOf(onto, term.id), [onto, term.id]);
  const codes = useMemo(() => companyCodesIn(onto, impact), [onto, impact]);
  const health = healthOf(term);
  return (
    <aside className="om-detail" aria-label="Term details">
      <div className="om-detail-top">
        <span className="om-dim">{term.kind === 'metric' ? 'Metric' : 'Class'}</span>
        <span className={`om-chip ${health === 'complete' ? 'om-ok' : 'om-warn'}`}>{HEALTH_LABEL[health]}</span>
      </div>
      <h2>{term.label}</h2>
      <p className="om-sub">{term.id}</p>

      <h3>Definition</h3>
      <p>{term.definition || <span className="om-dim">Missing. A steward can propose one from a document.</span>}</p>

      {term.kind === 'metric' && (
        <>
          <h3>Formula</h3>
          <code className="om-code">{term.formula || 'Not stated'}</code>
          <h3>Certified by</h3>
          <p>{ownerLabel(term)}</p>
        </>
      )}
      {term.kind === 'class' && term.members.length > 0 && (
        <>
          <h3>{term.membersKind === 'subclasses' ? 'Subclasses' : 'Instances'}</h3>
          <p>{term.members.join(', ')}</p>
        </>
      )}

      {term.kind === 'metric' && (
        <section className="om-impact" aria-label="What depends on this term">
          <h3>What hangs on it</h3>
          <div className="om-impact-nums">
            <div><b>{impact.usedBy.length}</b><span>things depend on it</span></div>
            <div><b>{codes.length}</b><span>company codes in scope</span></div>
          </div>
          <h4>Depends on</h4>
          <ul className="om-list">
            {impact.dependsOn.length === 0 && <li className="om-dim">Nothing</li>}
            {impact.dependsOn.map((d) => <li key={d.node.id + d.prop}><b>{d.node.label}</b> <span className="om-dim">{d.node.type}, {propLabel(d.prop)}{d.node.note ? ` · ${d.node.note}` : ''}</span></li>)}
          </ul>
          <h4>Used by</h4>
          <ul className="om-list">
            {impact.usedBy.length === 0 && <li className="om-dim">Nothing is modelled as using it</li>}
            {impact.usedBy.map((d) => (
              <li key={d.node.id}><b>{d.node.label}</b> <span className="om-chip">Step {d.hop}</span>
                <span className="om-dim"> {d.node.type}</span>
                {d.links.filter((l) => l.prop === 'appliesTo').length > 0 && <span className="om-dim"> · applies to {d.links.filter((l) => l.prop === 'appliesTo').map((l) => l.to).join(', ')}</span>}
              </li>
            ))}
          </ul>
          {impact.ask.length > 0 && <p><span className="om-chip om-warn">Ask first</span> <b>{impact.ask.join(', ')}</b></p>}
          <p className="om-note-small">Only what is modelled in this ontology counts. Agents, skills and reports that use the term but are not modelled here are not listed.</p>
        </section>
      )}
    </aside>
  );
}
