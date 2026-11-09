import { useMemo, useState } from 'react';
import { EXPORT_FORMATS, exportName, exportText, type ExportFormat } from '../ontology-export';
import { metaOf, type Governance, type Ontology } from '../ontology-manager';

/** Export one ontology as Turtle, JSON-LD or a glossary, and see every mapping to other systems in one list. */
export default function OntologyExport({ ontologies, gov }: { ontologies: Ontology[]; gov: Governance }) {
  const [slug, setSlug] = useState(ontologies[0]?.slug ?? '');
  const [format, setFormat] = useState<ExportFormat>('turtle');
  const [copied, setCopied] = useState(false);
  const onto = ontologies.find((o) => o.slug === slug) ?? ontologies[0];
  const text = useMemo(() => (onto ? exportText(onto, gov, format) : ''), [onto, gov, format]);
  const maps = useMemo(() => ontologies.flatMap((o) => o.terms.flatMap((t) => metaOf(gov, o.slug, t.id).mappings.map((m) => ({ o, t, m })))), [ontologies, gov]);
  if (!onto) return <section className="om-table"><p className="om-empty">No ontology to export yet.</p></section>;
  const fmt = EXPORT_FORMATS.find((f) => f.id === format) ?? EXPORT_FORMATS[0];
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: `${fmt.mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url; a.download = exportName(onto, format); document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } };
  const lines = text.split('\n');
  return (
    <section className="om-table" aria-label="Export">
      <div className="om-table-head">
        <h2>Export</h2>
        <select className="om-select" value={onto.slug} onChange={(e) => setSlug(e.target.value)} aria-label="Ontology">
          {ontologies.map((o) => <option key={o.slug} value={o.slug}>{o.title}</option>)}
        </select>
        <div className="om-filters" role="group" aria-label="Format">
          {EXPORT_FORMATS.map((f) => <button key={f.id} className={`om-filter ${format === f.id ? 'om-filter-on' : ''}`} aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>{f.label}</button>)}
        </div>
      </div>
      <p className="om-note-small om-pad">{fmt.note} The file holds terms, definitions, synonyms, lifecycle status, mappings, resources and links of this ontology; it is made on this computer and nothing is sent.</p>
      <div className="om-plan-actions om-pad">
        <button className="om-filter om-filter-on" onClick={download}>Download {exportName(onto, format)}</button>
        <button className="om-filter" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy the text'}</button>
        <span className="om-dim">{lines.length - 1} lines</span>
      </div>
      <pre className="om-code om-export" aria-label={`Preview of ${exportName(onto, format)}`}>{lines.slice(0, 60).join('\n')}{lines.length > 60 ? '\n…' : ''}</pre>

      <h2 className="om-pad">Mappings to other systems</h2>
      <p className="om-note-small om-pad">The same thing under another name in SAP or a standard. Add them in the catalog, in the box "Same thing elsewhere".</p>
      {maps.length === 0 && <p className="om-empty">No mapping yet.</p>}
      {maps.map(({ o, t, m }) => (
        <div key={`${o.slug}:${t.id}:${m.system}:${m.ref}`} className="om-finding">
          <span className="om-chip">{m.system}</span>
          <span><b>{t.label}</b> <span className="om-dim">{o.slug}</span><br />{m.ref}</span><span />
        </div>
      ))}
    </section>
  );
}
