import { useMemo, useState } from 'react';
import {
  HEALTH_LABEL, filterTerms, healthOf, kpis, ownerLabel, qualityFindings, setMeta, usedLabel,
  type Governance, type Ontology, type OntologyData, type TermFilter,
} from '../ontology-manager';
import OntologyDetails from './OntologyDetails';
import OntologyHistory from './OntologyHistory';
import OntologyMap from './OntologyMap';
import OntologyProposals from './OntologyProposals';
import OntologyQuality from './OntologyQuality';
import OntologyUse from './OntologyUse';

type Generate = (prompt: string, title: string, session?: string) => Promise<string>;
type Tab = 'catalog' | 'map' | 'proposals' | 'quality' | 'use' | 'history';

const FILTERS: Array<{ id: TermFilter; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'metrics', label: 'Metrics' }, { id: 'classes', label: 'Classes' }, { id: 'attention', label: 'Needs attention' },
];

/**
 * Ontology Manager: catalog, proposals from documents (review and confirm), quality rules, who uses which term (and
 * the view each agent gets), and the history of each ontology. It shows the catalog of the Ontology Manager connector;
 * when that cannot be read it shows the bundled Finance Pre-Close sample and says why. Owners, declared users, views
 * and plans are saved in `governance.json` next to the catalog; the catalog itself is only changed by the connector.
 */
export default function OntologyManagerView({ data, onReload, onBack, onGovernance, saveNote, generate, onStop, ready, knownSkills }: {
  data: OntologyData; onReload: () => void; onBack: () => void; onGovernance: (g: Governance) => void; saveNote: string;
  generate?: Generate; onStop?: () => void; ready: boolean; knownSkills: string[];
}) {
  const { ontologies, source, proposals, history, governance } = data;
  const [tab, setTab] = useState<Tab>('catalog');
  const [focus, setFocus] = useState<{ slug: string; term: string } | null>(null);
  const toReview = proposals.filter((p) => p.status === 'proposed').length;
  const findings = useMemo(() => qualityFindings(ontologies, governance).length, [ontologies, governance]);
  const TABS: Array<{ id: Tab; label: string; n?: number }> = [
    { id: 'catalog', label: 'Catalog' }, { id: 'map', label: 'Map' }, { id: 'proposals', label: 'Proposals', n: toReview }, { id: 'quality', label: 'Quality', n: findings },
    { id: 'use', label: 'Use' }, { id: 'history', label: 'History' },
  ];

  return (
    <main className="om">
      <header className="om-hero">
        <button className="om-back" onClick={onBack} aria-label="Back to the Admin console">←</button>
        <div className="om-hero-text">
          <p className="om-crumb">Admin console</p>
          <h1>Know what every term means, <span>and who stands behind it.</span></h1>
          <p className="om-lede">The shared vocabulary of your agents in one place: owned, reviewed and traceable to the document it came from.</p>
        </div>
      </header>

      <div className="om-source">
        {source.kind === 'example' && <p className="om-note" role="note">Example data: the bundled Finance Pre-Close sample. {source.reason} Changes you make here stay on this screen and are not saved.</p>}
        {source.kind === 'loading' && <p className="om-note" role="status">Reading the ontology catalog…</p>}
        {source.kind === 'catalog' && (
          <p className="om-note" role="note">
            Read from your ontology catalog{source.folder ? ` (${source.folder})` : ''}. The catalog is changed only by the connector, after you confirm a proposal.
            {source.instances === 'bundled' && ' Metrics, checks and links come from the bundled Finance Pre-Close instances.'}
            {source.instances === 'none' && ' No instances file was found, so metrics and links are not shown.'}
            {source.warnings.length > 0 && ` Skipped: ${source.warnings.join('; ')}.`}
          </p>
        )}
        {saveNote && <span className="om-chip" role="status">{saveNote}</span>}
        <button className="om-filter" onClick={onReload} disabled={source.kind === 'loading'}>Reload</button>
      </div>

      <nav className="om-tabs" aria-label="Ontology Manager sections">
        {TABS.map((t) => (
          <button key={t.id} className={`om-tab ${tab === t.id ? 'om-tab-on' : ''}`} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}{t.n ? <span className="om-badge">{t.n}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'catalog' && <Catalog ontologies={ontologies} gov={governance} onGovernance={onGovernance} focus={focus} onReload={onReload} onBack={onBack} loading={source.kind === 'loading'} />}
      {tab === 'map' && <OntologyMap ontologies={ontologies} gov={governance} onOpen={(slug, term) => { setFocus({ slug, term }); setTab('catalog'); }} />}
      {tab === 'proposals' && <OntologyProposals proposals={proposals} ontologies={ontologies} generate={generate} onStop={onStop} ready={ready} onReload={onReload} />}
      {tab === 'quality' && <OntologyQuality ontologies={ontologies} gov={governance} onOpen={(slug, term) => { setFocus({ slug, term }); setTab('catalog'); }} />}
      {tab === 'use' && <OntologyUse ontologies={ontologies} gov={governance} onGovernance={onGovernance} knownSkills={knownSkills} generate={generate} ready={ready} />}
      {tab === 'history' && <OntologyHistory ontologies={ontologies} history={history} />}
    </main>
  );
}

function Catalog({ ontologies, gov, onGovernance, focus, onReload, onBack, loading }: {
  ontologies: Ontology[]; gov: Governance; onGovernance: (g: Governance) => void; focus: { slug: string; term: string } | null;
  onReload: () => void; onBack: () => void; loading: boolean;
}) {
  const [slug, setSlug] = useState(focus?.slug ?? ontologies[0]?.slug ?? '');
  const [filter, setFilter] = useState<TermFilter>('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(focus?.term ?? 'DSO');
  const onto = ontologies.find((o) => o.slug === slug) ?? ontologies[0];
  const k = useMemo(() => (onto ? kpis(onto) : null), [onto]);
  const rows = useMemo(() => (onto ? filterTerms(onto, filter, query) : []), [onto, filter, query]);
  if (loading && !onto) return <p className="om-note" role="status">Reading the ontology catalog…</p>;
  if (!onto || !k) {
    return (
      <div className="om-source">
        <p className="om-note">No ontology in the catalog yet. Create one from a document in the tab Proposals.</p>
        <button className="om-filter" onClick={onReload}>Reload</button><button className="om-filter" onClick={onBack}>Back to Admin console</button>
      </div>
    );
  }
  const selected = onto.terms.find((t) => t.id === picked) ?? rows[0] ?? onto.terms[0];
  const counts: Record<TermFilter, number> = { all: onto.terms.length, metrics: k.metrics, classes: k.classes, attention: k.needAttention };

  return (
    <>
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
                <span className="om-sub">Owner: {o.owner || 'not assigned'}{o.domain ? ` · ${o.domain}` : ''}</span>
                <i className="om-meter"><i style={{ width: `${Math.round(ok.coverage * 100)}%` }} /></i>
              </button>
            );
          })}
          <OwnerForm key={onto.slug} onto={onto} gov={gov} onGovernance={onGovernance} />
        </aside>

        <section className="om-table" aria-label="Terms">
          <div className="om-table-head">
            <h2>Terms in {onto.slug}</h2>
            <label className="om-search om-search-inline">
              <span className="om-sr">Search terms</span>
              <input type="search" value={query} placeholder="Search terms, definitions, owners" onChange={(e) => setQuery(e.target.value)} />
            </label>
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

        {selected && <OntologyDetails key={`${onto.slug}:${selected.id}`} onto={onto} term={selected} gov={gov} onGovernance={onGovernance} />}
      </div>
    </>
  );
}

/** Owner, domain and approver of one ontology (saved in governance.json, not in the Turtle). */
function OwnerForm({ onto, gov, onGovernance }: { onto: Ontology; gov: Governance; onGovernance: (g: Governance) => void }) {
  const [owner, setOwner] = useState(onto.owner);
  const [domain, setDomain] = useState(onto.domain);
  const [approver, setApprover] = useState(onto.approver);
  const changed = owner !== onto.owner || domain !== onto.domain || approver !== onto.approver;
  return (
    <section className="om-new" aria-label="Owner and approver">
      <h3>About {onto.slug}</h3>
      <label className="om-field"><span>Owner</span><input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Team or person" /></label>
      <label className="om-field"><span>Domain</span><input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Finance, Procurement …" /></label>
      <label className="om-field"><span>Approves changes</span><input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Who must agree" /></label>
      <button className="om-filter om-filter-on" disabled={!changed} onClick={() => onGovernance(setMeta(gov, onto.slug, { owner, domain, approver }))}>Save</button>
    </section>
  );
}
