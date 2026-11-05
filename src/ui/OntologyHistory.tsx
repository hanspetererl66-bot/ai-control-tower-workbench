import { useState } from 'react';
import type { Ontology, VersionEntry } from '../ontology-manager';

/** Versions of an ontology: the connector saves the old one before every extension; each version shows what it added and removed. */
export default function OntologyHistory({ ontologies, history }: { ontologies: Ontology[]; history: Record<string, VersionEntry[]> }) {
  const published = ontologies.filter((o) => o.status === 'published');
  const [slug, setSlug] = useState(published.find((o) => history[o.slug])?.slug ?? published[0]?.slug ?? '');
  const versions = [...(history[slug] ?? [])].reverse();
  const when = (v: VersionEntry) => (v.file === 'current' ? 'Current version' : v.at ? new Date(v.at).toLocaleString() : v.file);
  return (
    <section className="om-table" aria-label="History">
      <div className="om-table-head">
        <h2>History</h2>
        <div className="om-filters" role="group" aria-label="Ontology">
          {published.map((o) => <button key={o.slug} className={`om-filter ${o.slug === slug ? 'om-filter-on' : ''}`} aria-pressed={o.slug === slug} onClick={() => setSlug(o.slug)}>{o.title}</button>)}
        </div>
      </div>
      <p className="om-note-small om-pad">Each time a proposal extends an ontology, the connector first saves the old version. Versions are compared by the classes and properties they declare. Restoring a version is not offered here.</p>
      {versions.length === 0 && <p className="om-empty">{slug ? 'No earlier version yet. The ontology has not been extended.' : 'No ontology.'}</p>}
      {versions.map((v, i) => (
        <div key={v.file} className="om-version" style={{ ['--i' as string]: i }}>
          <span className="om-dot" aria-hidden="true" />
          <div>
            <b>{when(v)}</b> <span className="om-dim">{v.terms} classes and properties</span>
            {v.added.length > 0 && <p className="om-diff"><span className="om-chip om-ok">+ {v.added.length}</span> {v.added.join(', ')}</p>}
            {v.removed.length > 0 && <p className="om-diff"><span className="om-chip om-warn">− {v.removed.length}</span> {v.removed.join(', ')}</p>}
            {v.added.length === 0 && v.removed.length === 0 && i < versions.length - 1 && <p className="om-dim">Changes compared with the version before: none</p>}
          </div>
        </div>
      ))}
    </section>
  );
}
