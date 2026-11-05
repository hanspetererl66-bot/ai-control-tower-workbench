import { useMemo, useState } from 'react';
import { CONSUMER_KINDS, addBinding, removeBinding, removeView, upsertView, viewPrompt, type AgentView, type ConsumerKind, type Governance, type Ontology } from '../ontology-manager';

type Generate = (prompt: string, title: string, session?: string) => Promise<string>;

/**
 * Who uses which term, and which ontologies an agent gets. Both are declared by people; the app cannot look inside
 * an agent. A view only reaches an agent when its prompt asks the Ontology Manager to compose it.
 */
export default function OntologyUse({ ontologies, gov, onGovernance, knownSkills, generate, ready }: {
  ontologies: Ontology[]; gov: Governance; onGovernance: (g: Governance) => void; knownSkills: string[]; generate?: Generate; ready: boolean;
}) {
  const published = ontologies.filter((o) => o.status === 'published');
  const [slug, setSlug] = useState(published[0]?.slug ?? '');
  const onto = ontologies.find((o) => o.slug === slug);
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<ConsumerKind>('agent');
  const [name, setName] = useState('');
  const termId = onto?.terms.some((t) => t.id === term) ? term : onto?.terms[0]?.id ?? '';
  const termList = useMemo(() => [...(onto?.terms ?? []), ...(onto?.nodes ?? []).filter((n) => !onto?.terms.some((t) => t.id === n.id)).map((n) => ({ id: n.id, label: n.label }))], [onto]);

  return (
    <div className="om-grid om-grid-two">
      <section className="om-table" aria-label="Declared users">
        <div className="om-table-head"><h2>Who uses which term</h2></div>
        <p className="om-note-small om-pad">People declare here which agents, skills and reports rely on a term. The impact of a change then names them too.</p>
        <div className="om-pad om-form-row">
          <label className="om-field"><span>Ontology</span>
            <select value={slug} onChange={(e) => { setSlug(e.target.value); setTerm(''); }}>{published.map((o) => <option key={o.slug} value={o.slug}>{o.title}</option>)}</select>
          </label>
          <label className="om-field"><span>Term</span>
            <select value={termId} onChange={(e) => setTerm(e.target.value)}>{termList.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </label>
          <label className="om-field"><span>Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as ConsumerKind)}>{CONSUMER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
          </label>
          <label className="om-field"><span>Name</span>
            <input list="om-skill-names" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'skill' ? 'Pick an installed skill' : 'Name as people know it'} />
            <datalist id="om-skill-names">{(kind === 'skill' ? knownSkills : []).map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <button className="om-filter om-filter-on" disabled={!slug || !termId || !name.trim()} onClick={() => { onGovernance(addBinding(gov, { slug, term: termId, kind, name })); setName(''); }}>Declare use</button>
        </div>
        {gov.bindings.length === 0 && <p className="om-empty">Nothing declared yet.</p>}
        {gov.bindings.map((b) => (
          <div key={`${b.slug}|${b.term}|${b.kind}|${b.name}`} className="om-finding">
            <span className="om-chip">{b.kind}</span>
            <span><b>{b.name}</b> <span className="om-dim">uses {ontologies.find((o) => o.slug === b.slug)?.terms.find((t) => t.id === b.term)?.label ?? b.term} · {b.slug}</span></span>
            <button className="om-filter" onClick={() => onGovernance(removeBinding(gov, b))}>Remove</button>
          </div>
        ))}
      </section>
      <Views ontologies={published} gov={gov} onGovernance={onGovernance} generate={generate} ready={ready} />
    </div>
  );
}

function Views({ ontologies, gov, onGovernance, generate, ready }: { ontologies: Ontology[]; gov: Governance; onGovernance: (g: Governance) => void; generate?: Generate; ready: boolean }) {
  const [name, setName] = useState('');
  const [slugs, setSlugs] = useState<string[]>([]);
  const [answer, setAnswer] = useState<{ view: string; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const show = async (v: AgentView) => {
    if (!generate) return;
    setBusy(v.name); setAnswer(null);
    try { setAnswer({ view: v.name, text: await generate(viewPrompt(v), 'Agent view', 'ontology-view') }); }
    catch (e) { setAnswer({ view: v.name, text: `Could not read the view: ${(e as Error)?.message ?? e}` }); }
    finally { setBusy(''); }
  };
  return (
    <section className="om-detail" aria-label="Agent views">
      <h2>Views for agents</h2>
      <p className="om-note-small">An agent gets only the ontologies it needs. The view lists them; the agent receives it when its prompt asks the Ontology Manager to compose these ontologies.</p>
      {gov.views.map((v) => (
        <div key={v.name} className="om-view">
          <b>{v.name}</b>
          <span className="om-dim">{v.slugs.join(', ') || 'no ontology'}</span>
          <span className="om-plan-actions">
            <button className="om-filter" disabled={!generate || !ready || busy === v.name || v.slugs.length === 0} onClick={() => void show(v)}>{busy === v.name ? 'Reading…' : 'Show what it sees'}</button>
            <button className="om-filter" onClick={() => onGovernance(removeView(gov, v.name))}>Remove</button>
          </span>
          {answer?.view === v.name && <p className="om-note-small om-answer" role="status">{answer.text}</p>}
        </div>
      ))}
      <h3>New view</h3>
      <label className="om-field"><span>Agent</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the agent" /></label>
      <div className="om-checks">
        {ontologies.map((o) => (
          <label key={o.slug} className="om-check"><input type="checkbox" checked={slugs.includes(o.slug)} onChange={(e) => setSlugs(e.target.checked ? [...slugs, o.slug] : slugs.filter((s) => s !== o.slug))} /> {o.title}</label>
        ))}
      </div>
      <button className="om-filter om-filter-on" disabled={!name.trim() || slugs.length === 0} onClick={() => { onGovernance(upsertView(gov, { name, slugs })); setName(''); setSlugs([]); }}>Save the view</button>
      {!ready && <p className="om-note-small">Showing what an agent sees needs the desktop app with the Ontology Manager connector.</p>}
    </section>
  );
}
