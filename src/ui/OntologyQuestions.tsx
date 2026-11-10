import { useMemo, useState } from 'react';
import { QUESTION_LABEL, addQuestion, checkQuestion, questionCoverage, questionsOf, removeQuestion, type Governance, type Ontology, type QuestionState } from '../ontology-manager';

const TONE: Record<QuestionState, string> = { answerable: 'om-ok', partial: 'om-warn', blocked: 'om-bad' };

/**
 * Competency questions: what an ontology must be able to answer, and whether its vocabulary is there. Each question names the
 * terms it needs; the check says which are missing, undefined, deprecated or still drafts. It checks the vocabulary, not the data.
 */
export default function OntologyQuestions({ ontologies, gov, onGovernance, onOpen }: {
  ontologies: Ontology[]; gov: Governance; onGovernance: (g: Governance) => void; onOpen: (slug: string, term: string) => void;
}) {
  const [slug, setSlug] = useState(ontologies[0]?.slug ?? '');
  const onto = ontologies.find((o) => o.slug === slug) ?? ontologies[0];
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [state, setState] = useState<'all' | QuestionState>('all');
  const checks = useMemo(() => (onto ? questionsOf(gov, onto.slug).map((q) => checkQuestion(onto, gov, q)) : []), [onto, gov]);
  const cover = useMemo(() => (onto ? questionCoverage(onto, gov) : null), [onto, gov]);
  if (!onto || !cover) return <section className="om-table"><p className="om-empty">No ontology yet.</p></section>;
  const shown = state === 'all' ? checks : checks.filter((c) => c.state === state);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <section className="om-table" aria-label="Competency questions">
      <div className="om-table-head">
        <h2>Questions</h2>
        <select className="om-select" value={onto.slug} onChange={(e) => { setSlug(e.target.value); setPicked([]); }} aria-label="Ontology">
          {ontologies.map((o) => <option key={o.slug} value={o.slug}>{o.title}</option>)}
        </select>
      </div>
      <p className="om-note-small om-pad">What must this ontology be able to answer? Each question lists the terms it needs. A question is answerable when every term exists, has a definition and is neither deprecated nor a draft. This checks the vocabulary, not the data behind it.</p>
      <div className="om-qcover" role="group" aria-label="Coverage">
        <div className="om-kpi"><span>Answerable</span><b>{cover.answerable} <small>of {cover.total}</small></b>
          <i className="om-meter" role="img" aria-label={`${Math.round(cover.share * 100)} percent`}><i style={{ width: `${Math.round(cover.share * 100)}%` }} /></i></div>
        <div className="om-kpi"><span>Partly</span><b className="om-warn-text">{cover.partial}</b></div>
        <div className="om-kpi"><span>Cannot be answered yet</span><b className="om-bad-text">{cover.blocked}</b></div>
      </div>
      <div className="om-filters" role="group" aria-label="Filter questions">
        {(['all', 'answerable', 'partial', 'blocked'] as const).map((s) => (
          <button key={s} className={`om-filter ${state === s ? 'om-filter-on' : ''}`} aria-pressed={state === s} onClick={() => setState(s)}>
            {s === 'all' ? 'All' : QUESTION_LABEL[s]} {s === 'all' ? checks.length : checks.filter((c) => c.state === s).length}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="om-empty">{checks.length === 0 ? 'No question yet. Add the first one below.' : 'No question in this state.'}</p>}
      {shown.map((c, i) => (
        <div key={c.question.id} className="om-finding om-q" style={{ ['--i' as string]: i }}>
          <span className={`om-chip ${TONE[c.state]}`}>{QUESTION_LABEL[c.state]}</span>
          <span>
            <b>{c.question.text}</b><br />
            <span className="om-dim">Needs: </span>
            {c.question.terms.map((id) => {
              const bad = c.problems.some((p) => p.term === id);
              const exists = onto.terms.some((t) => t.id === id);
              return exists
                ? <button key={id} className={`om-tag om-tag-btn ${bad ? 'om-tag-warn' : ''}`} onClick={() => onOpen(onto.slug, id)}>{onto.terms.find((t) => t.id === id)?.label}</button>
                : <span key={id} className="om-tag om-tag-bad" title="Not in the ontology">{id}</span>;
            })}
            {c.problems.length > 0 && <><br /><span className="om-dim">{c.problems.map((p) => p.message).join(' ')}</span></>}
          </span>
          <button className="om-filter" aria-label={`Remove the question ${c.question.text}`} onClick={() => onGovernance(removeQuestion(gov, c.question.id))}>Remove</button>
        </div>
      ))}
      <form className="om-qform" onSubmit={(e) => { e.preventDefault(); const next = addQuestion(gov, onto.slug, text, picked); if (next !== gov) { onGovernance(next); setText(''); setPicked([]); } }}>
        <h3>Add a question</h3>
        <label className="om-field"><span>Question</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: Which contracts end in the next 90 days?" maxLength={300} /></label>
        <fieldset className="om-pick"><legend>Terms it needs</legend>
          {onto.terms.map((t) => (
            <label key={t.id} className={`om-tag om-tag-btn ${picked.includes(t.id) ? 'om-tag-on' : ''}`}>
              <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />{t.label}
            </label>
          ))}
        </fieldset>
        <button className="om-filter om-filter-on" disabled={!text.trim() || picked.length === 0}>Add the question</button>
      </form>
    </section>
  );
}
