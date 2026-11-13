import { useMemo, useState } from 'react';
import OntologyUsers from './OntologyUsers';
import { useTermUsage, type TermUsage } from './useTermUsage';
import { approvePlan, mayApprove, ownerNotes, questionsAtRisk } from '../ontology-usage';
import {
  HEALTH_LABEL, MAX_MAPPINGS, MAX_SYNONYMS, PLAN_LABEL, STATUS_LABEL, TERM_STATUSES, addPlan, addSynonym, companyCodesIn, consumersOf, healthOf, impactOf, metaOf, newPlan,
  ownerLabel, planRequest, propLabel, removeSynonym, setPlanStatus, setTermMeta, statusOf,
  type Governance, type Ontology, type PlanStatus, type Term, type TermStatus,
} from '../ontology-manager';

const SYSTEMS = ['SAP S/4HANA', 'SAP SuccessFactors', 'IFRS 15', 'schema.org', 'FIBO', 'AWX', 'Other'];

/** Details of one term: definition, owner, what hangs on it, who declares they use it, and a plan for changing it. */
export default function OntologyDetails({ onto, term, gov, onGovernance, ontologies, actor = '' }: { onto: Ontology; term: Term; gov: Governance; onGovernance: (g: Governance) => void; ontologies?: readonly Ontology[]; actor?: string }) {
  const impact = useMemo(() => impactOf(onto, term.id), [onto, term.id]);
  const codes = useMemo(() => companyCodesIn(onto, impact), [onto, impact]);
  const consumers = useMemo(() => consumersOf(gov, onto, term.id, impact), [gov, onto, term.id, impact]);
  const usage = useTermUsage(onto, term, ontologies, gov);
  const health = healthOf(term);
  return (
    <aside className="om-detail" aria-label="Term details" data-guide="detail">
      <div className="om-detail-top">
        <span className="om-dim">{term.kind === 'metric' ? 'Metric' : 'Class'}</span>
        <span className={`om-chip ${statusOf(onto, gov, term) === 'deprecated' ? 'om-bad' : statusOf(onto, gov, term) === 'draft' ? 'om-warn' : 'om-ok'}`}>{STATUS_LABEL[statusOf(onto, gov, term)]}</span>
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

      <Lifecycle onto={onto} term={term} gov={gov} onGovernance={onGovernance} />

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
        {ontologies && <OntologyUsers gov={gov} onGovernance={onGovernance} actor={actor} usage={usage} />}
        {impact.ask.length > 0 && <p><span className="om-chip om-warn">Ask first</span> <b>{impact.ask.join(', ')}</b></p>}
        <p className="om-note-small">Only what is modelled here, and what people declared, counts. Anything else that uses the term is not listed.</p>
      </section>

      <ChangePlan onto={onto} term={term} gov={gov} onGovernance={onGovernance} usage={usage} actor={actor} request={(change) => planRequest(onto, term.id, change, impact, consumers, codes)} ask={impact.ask} impactCount={impact.usedBy.length} />
    </aside>
  );
}

function ChangePlan({ onto, term, gov, onGovernance, request, ask, impactCount, usage, actor }: {
  onto: Ontology; term: Term; gov: Governance; onGovernance: (g: Governance) => void; request: (change: string) => string; ask: string[]; impactCount: number; usage: TermUsage; actor: string;
}) {
  const [open, setOpen] = useState(false);
  const [change, setChange] = useState('');
  const [copied, setCopied] = useState(false);
  const impact = useMemo(() => impactOf(onto, term.id), [onto, term.id]);
  const plans = gov.plans.filter((p) => p.slug === onto.slug && p.term === term.id);
  const text = change.trim() ? request(change) : '';
  const questions = useMemo(() => questionsAtRisk(gov, onto.slug, term.id), [gov, onto.slug, term.id]);
  const check = mayApprove({ approver: onto.approver, actor, actorIsAgent: false, summary: usage.summary, searched: usage.searched });
  const notes = useMemo(() => (change.trim() && usage.searched ? ownerNotes({ termLabel: term.label, ontologyTitle: onto.title, slug: onto.slug, change, approver: onto.approver, usages: usage.decided.usages }) : []), [change, usage.searched, usage.decided, term.label, onto.title, onto.slug, onto.approver]);
  const approve = (planId: string) => {
    const r = approvePlan(gov, planId, { actor, actorIsAgent: false, approver: onto.approver, decided: usage.decided, summary: usage.summary, searched: usage.searched, now: Date.now() });
    if (r.check.allowed) onGovernance(r.gov);
  };
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
          <p className="om-plan-reach" role="status">
            {usage.searched
              ? <><b>{usage.summary.total}</b> {usage.summary.total === 1 ? 'user' : 'users'} ({usage.summary.confirmed} declared or confirmed, {usage.summary.suspected} suspected)
                {usage.summary.owners.length ? `, ${usage.summary.owners.length} ${usage.summary.owners.length === 1 ? 'owner' : 'owners'} to ask` : ''}</>
              : <>Users not searched yet. <button className="om-filter" disabled={usage.phase === 'loading'} onClick={() => void usage.run()}>{usage.phase === 'loading' ? 'Reading…' : 'Find users'}</button></>}
            {questions.length > 0 && <> · {questions.length} competency {questions.length === 1 ? 'question needs' : 'questions need'} this term</>}
          </p>
          {questions.length > 0 && <ul className="om-note-small om-plan-questions">{questions.map((q) => <li key={q.id}>{q.text}</li>)}</ul>}
          {text && <textarea className="om-code" rows={7} readOnly value={text} aria-label="Request to the owners" />}
          {notes.length > 0 && (
            <details className="om-plan-notes">
              <summary>One draft per owner ({notes.length})</summary>
              {notes.map((n) => (
                <div key={n.owner}><b>{n.owner}</b>
                  <textarea className="om-code" rows={7} readOnly value={n.text} aria-label={`Draft for ${n.owner}`} />
                  <button className="om-filter" onClick={() => void navigator.clipboard?.writeText(n.text)}>Copy the draft for {n.owner}</button>
                </div>
              ))}
            </details>
          )}
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
                {(['asked', 'rejected'] as PlanStatus[]).filter((st) => st !== p.status).map((st) => (
                  <button key={st} className="om-filter" onClick={() => onGovernance(setPlanStatus(gov, p.id, st))}>{PLAN_LABEL[st]}</button>
                ))}
                {p.status !== 'approved' && <button className="om-filter om-filter-on" disabled={!check.allowed} title={check.allowed ? 'Approve this change' : check.reason} onClick={() => approve(p.id)}>Approve</button>}
              </span>
              {p.status !== 'approved' && !check.allowed && <p className="om-note-small om-plan-blocked" role="status">Approval blocked: {check.reason}</p>}
              {p.approval && p.status === 'approved' && (
                <details className="om-plan-record">
                  <summary>Approved by {p.approval.by || 'unknown'} on {new Date(p.approval.at).toLocaleDateString()}: {p.approval.users.length} {p.approval.users.length === 1 ? 'user' : 'users'} at that moment ({p.approval.confirmed} declared or confirmed, {p.approval.suspected} suspected)</summary>
                  <ul className="om-note-small">
                    {p.approval.users.map((u) => <li key={`${u.kind}:${u.name}`}>{u.name} ({u.kind}, {u.state}{u.owner ? `, ${u.owner}` : ''})</li>)}
                    {p.approval.questions.map((q) => <li key={q}>Competency question: {q}</li>)}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Lifecycle status, replacement, synonyms and mappings of one term. Saved in governance.json (not in the Turtle). */
function Lifecycle({ onto, term, gov, onGovernance }: { onto: Ontology; term: Term; gov: Governance; onGovernance: (g: Governance) => void }) {
  const meta = metaOf(gov, onto.slug, term.id);
  const status = statusOf(onto, gov, term);
  const [word, setWord] = useState('');
  const [system, setSystem] = useState(SYSTEMS[0]);
  const [ref, setRef] = useState('');
  const others = onto.terms.filter((t) => t.id !== term.id && statusOf(onto, gov, t) !== 'deprecated');
  const save = (patch: Parameters<typeof setTermMeta>[3]) => onGovernance(setTermMeta(gov, onto.slug, term.id, patch));
  return (
    <section className="om-life" aria-label="Lifecycle, synonyms and mappings">
      <h3>Lifecycle</h3>
      <div className="om-life-row">
        <label className="om-field"><span>Status</span>
          <select className="om-select" value={status} onChange={(e) => save({ status: e.target.value as TermStatus })} aria-label="Status of the term">
            {TERM_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
          </select>
        </label>
        {status === 'deprecated' && (
          <label className="om-field"><span>Replaced by</span>
            <select className="om-select" value={meta.replacedBy} onChange={(e) => save({ replacedBy: e.target.value })} aria-label="Term that replaces this one">
              <option value="">Nothing yet</option>
              {others.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {status === 'deprecated' && <p className="om-note-small">A deprecated term should not get new users. The Quality tab lists what still uses it.</p>}

      <h3>Also called</h3>
      <div className="om-tags">
        {meta.synonyms.length === 0 && <span className="om-dim">No synonym yet. Add the words people really use.</span>}
        {meta.synonyms.map((w) => <span key={w} className="om-tag">{w}<button aria-label={`Remove ${w}`} onClick={() => onGovernance(removeSynonym(gov, onto.slug, term.id, w))}>×</button></span>)}
      </div>
      <form className="om-inline" onSubmit={(e) => { e.preventDefault(); if (word.trim()) { onGovernance(addSynonym(gov, onto.slug, term.id, word)); setWord(''); } }}>
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Add a synonym" aria-label="New synonym" disabled={meta.synonyms.length >= MAX_SYNONYMS} />
        <button className="om-filter" disabled={!word.trim()}>Add</button>
      </form>

      <h3>Same thing elsewhere</h3>
      <ul className="om-list">
        {meta.mappings.length === 0 && <li className="om-dim">Not mapped to another system or standard.</li>}
        {meta.mappings.map((m) => (
          <li key={`${m.system}:${m.ref}`}><b>{m.system}</b> <span className="om-dim">{m.ref}</span>{' '}
            <button className="om-filter" aria-label={`Remove mapping ${m.system} ${m.ref}`} onClick={() => save({ mappings: meta.mappings.filter((x) => x !== m) })}>Remove</button></li>
        ))}
      </ul>
      <form className="om-inline" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) { save({ mappings: [...meta.mappings, { system, ref }] }); setRef(''); } }}>
        <select className="om-select" value={system} onChange={(e) => setSystem(e.target.value)} aria-label="System or standard">{SYSTEMS.map((x) => <option key={x}>{x}</option>)}</select>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Name there, for example Business Partner" aria-label="Name in that system" disabled={meta.mappings.length >= MAX_MAPPINGS} />
        <button className="om-filter" disabled={!ref.trim()}>Add</button>
      </form>
    </section>
  );
}
