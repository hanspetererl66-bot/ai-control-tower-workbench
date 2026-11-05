import { useMemo, useState } from 'react';
import { RULE_LABEL, qualityFindings, type Governance, type Ontology, type Severity } from '../ontology-manager';

const SEV: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** What a steward should look at: rules over all ontologies, worst first. Each finding opens its term in the catalog. */
export default function OntologyQuality({ ontologies, gov, onOpen }: { ontologies: Ontology[]; gov: Governance; onOpen: (slug: string, term: string) => void }) {
  const findings = useMemo(() => qualityFindings(ontologies, gov), [ontologies, gov]);
  const [rule, setRule] = useState('all');
  const rules = useMemo(() => [...new Set(findings.map((f) => f.rule))], [findings]);
  const shown = rule === 'all' ? findings : findings.filter((f) => f.rule === rule);
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  return (
    <section className="om-table" aria-label="Quality">
      <div className="om-table-head">
        <h2>Quality</h2>
        <div className="om-filters" role="group" aria-label="Filter by rule">
          <button className={`om-filter ${rule === 'all' ? 'om-filter-on' : ''}`} aria-pressed={rule === 'all'} onClick={() => setRule('all')}>All {findings.length}</button>
          {rules.map((r) => (
            <button key={r} className={`om-filter ${rule === r ? 'om-filter-on' : ''}`} aria-pressed={rule === r} onClick={() => setRule(r)}>{RULE_LABEL[r] ?? r} {findings.filter((f) => f.rule === r).length}</button>
          ))}
        </div>
      </div>
      <p className="om-note-small om-pad">{count('high')} high, {count('medium')} medium, {count('low')} low. Rules: owner, definition, formula, use, duplicates (also across ontologies), ontology owner. A term is "used" when something modelled points at it or someone declared it.</p>
      {shown.length === 0 && <p className="om-empty">{findings.length === 0 ? 'No findings. Every rule passes.' : 'No finding for this rule.'}</p>}
      {shown.map((f, i) => (
        <div key={f.id} className="om-finding" style={{ ['--i' as string]: i }}>
          <span className={`om-chip ${f.severity === 'high' ? 'om-bad' : f.severity === 'medium' ? 'om-warn' : ''}`}>{SEV[f.severity]}</span>
          <span><b>{RULE_LABEL[f.rule] ?? f.rule}</b> <span className="om-dim">{f.slug}</span><br />{f.message}</span>
          {f.term ? <button className="om-filter" onClick={() => onOpen(f.slug, f.term)}>Open</button> : <span />}
        </div>
      ))}
    </section>
  );
}
