import { useMemo, useState } from 'react';
import {
  HEALTH_LABEL, PLAN_LABEL, addPlan, companyCodesIn, consumersOf, healthOf, impactOf, newPlan, ownerLabel, planRequest, propLabel, setPlanStatus,
  type Governance, type Ontology, type PlanStatus, type Term,
} from '../ontology-manager';

/** Details of one term: definition, owner, what hangs on it, who declares they use it, and a plan for changing it. */
export default function OntologyDetails({ onto, term, gov, onGovernance }: { onto: Ontology; term: Term; gov: Governance; onGovernance: (g: Governance) => void }) {
  const impact = useMemo(() => impactOf(onto, term.id), [onto, term.id]);
  const codes = useMemo(() => companyCodesIn(onto, impact), [onto, impact]);
  const consumers = useMemo(() => consumersOf(gov, onto, term.id, impact), [gov, onto, term.id, impact]);
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
        <h4>Declared users</h4>
        <ul className="om-list">
          {consumers.length === 0 && <li className="om-dim">No agent, skill or report declares it (see the tab Use)</li>}
          {consumers.map((c) => (
            <li key={`${c.kind}:${c.name}:${c.term}`}><b>{c.name}</b> <span className="om-chip">{c.kind}</span>
              {!c.direct && <span className="om-dim"> via {c.term}</span>}</li>
          ))}
        </ul>
        {impact.ask.length > 0 && <p><span className="om-chip om-warn">Ask first</span> <b>{impact.ask.join(', ')}</b></p>}
        <p className="om-note-small">Only what is modelled here, and what people declared, counts. Anything else that uses the term is not listed.</p>
      </section>

      <ChangePlan onto={onto} term={term} gov={gov} onGovernance={onGovernance} request={(change) => planRequest(onto, term.id, change, impact, consumers, codes)} ask={impact.ask} impactCount={impact.usedBy.length} />
    </aside>
  );
}

function ChangePlan({ onto, term, gov, onGovernance, request, ask, impactCount }: {
  onto: Ontology; term: Term; gov: Governance; onGovernance: (g: Governance) => void; request: (change: string) => string; ask: string[]; impactCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [change, setChange] = useState('');
  const [copied, setCopied] = useState(false);
  const impact = useMemo(() => impactOf(onto, term.id), [onto, term.id]);
  const plans = gov.plans.filter((p) => p.slug === onto.slug && p.term === term.id);
  const text = change.trim() ? request(change) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
  };
  return (
    <section className="om-plan" aria-label="Plan a change">
      <button className="om-filter" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Close the plan' : 'Plan a change'}</button>
      {open && (
        <div className="om-plan-body">
          <label className="om-field"><span>What do you want to change?</span>
            <textarea rows={3} value={change} placeholder="For example: count only invoices that are not cancelled" onChange={(e) => setChange(e.target.value)} />
          </label>
          <p className="om-note-small">
            Reaches {impactCount} modelled {impactCount === 1 ? 'thing' : 'things'}. {ask.length ? `Ask first: ${ask.join(', ')}.` : 'Nobody is named as owner.'}
            {onto.approver ? ` Approver: ${onto.approver}.` : ' No approver is set for this ontology.'}
          </p>
          {text && <textarea className="om-code" rows={7} readOnly value={text} aria-label="Request to the owners" />}
          <div className="om-plan-actions">
            <button className="om-filter" disabled={!text} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy the request'}</button>
            <button className="om-filter om-filter-on" disabled={!text} onClick={() => { onGovernance(addPlan(gov, newPlan(onto, term.id, change, impact, Date.now()))); setChange(''); }}>Save the plan</button>
          </div>
          <p className="om-note-small">The app sends nothing. Copy the request to the people named, then record their answer here.</p>
        </div>
      )}
      {plans.length > 0 && (
        <ul className="om-list om-plans">
          {plans.map((p) => (
            <li key={p.id}>
              <b>{p.change}</b>
              <span className="om-dim"> {new Date(p.createdAt).toLocaleDateString()}</span>
              <span className={`om-chip ${p.status === 'approved' ? 'om-ok' : p.status === 'rejected' ? 'om-warn' : ''}`}>{PLAN_LABEL[p.status]}</span>
              <span className="om-plan-actions">
                {(['asked', 'approved', 'rejected'] as PlanStatus[]).filter((st) => st !== p.status).map((st) => (
                  <button key={st} className="om-filter" onClick={() => onGovernance(setPlanStatus(gov, p.id, st))}>{PLAN_LABEL[st]}</button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
