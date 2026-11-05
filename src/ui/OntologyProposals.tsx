import { useState } from 'react';
import { applyPrompt, discardPrompt, needsLook, proposalTotals, proposePrompt, type Ontology, type Proposal, type ProposalItem } from '../ontology-manager';

type Generate = (prompt: string, title: string, session?: string) => Promise<string>;
const STATUS: Record<string, string> = { proposed: 'To review', applied: 'Applied', failed: 'Failed', running: 'Running' };

/**
 * Review of ontology proposals made from documents. The person sees every proposed class and property with the quote
 * from the document it came from, then confirms; only then does the agent call the connector with confirmed=true.
 */
export default function OntologyProposals({ proposals, ontologies, generate, onStop, ready, onReload }: {
  proposals: Proposal[]; ontologies: Ontology[]; generate?: Generate; onStop?: () => void; ready: boolean; onReload: () => void;
}) {
  const [picked, setPicked] = useState<string>(proposals.find((p) => p.status === 'proposed')?.id ?? proposals[0]?.id ?? '');
  const open = proposals.find((p) => p.id === picked) ?? proposals[0];
  return (
    <div className="om-grid om-grid-two">
      <aside className="om-side" aria-label="Proposals">
        <h2>Proposals</h2>
        {proposals.length === 0 && <p className="om-note-small">No proposal yet. Create one from a document below.</p>}
        {proposals.map((p) => (
          <button key={p.id} className={`om-ont ${p.id === open?.id ? 'om-ont-on' : ''}`} aria-pressed={p.id === open?.id} onClick={() => setPicked(p.id)}>
            <span className="om-ont-top"><b>{p.label || p.slug}</b><span className={`om-chip ${p.status === 'proposed' ? 'om-warn' : p.status === 'applied' ? 'om-ok' : ''}`}>{STATUS[p.status] ?? p.status}</span></span>
            <span className="om-sub">{p.mode === 'new' ? 'New ontology' : 'Extends'} {p.slug} · {p.documents.map((d) => d.file).join(', ') || 'no documents'}</span>
            <span className="om-sub">{p.createdAt ? new Date(p.createdAt).toLocaleString() : ''}</span>
          </button>
        ))}
        <NewProposal ontologies={ontologies} generate={generate} onStop={onStop} ready={ready} onDone={onReload} />
      </aside>
      {open ? <Review key={open.id} p={open} generate={generate} ready={ready} onDone={onReload} /> : <section className="om-table"><p className="om-empty">Nothing to review.</p></section>}
    </div>
  );
}

function NewProposal({ ontologies, generate, onStop, ready, onDone }: { ontologies: Ontology[]; generate?: Generate; onStop?: () => void; ready: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<'new' | 'extend'>('extend');
  const [slug, setSlug] = useState(ontologies.find((o) => o.status === 'published')?.slug ?? '');
  const [docs, setDocs] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const valid = /^[A-Za-z0-9_-]{1,80}$/.test(slug);
  const can = Boolean(generate) && ready && valid && !busy;
  const run = async () => {
    if (!generate) return;
    setBusy(true); setAnswer('');
    try { setAnswer(await generate(proposePrompt(slug, mode, docs), 'Ontology proposal', 'ontology-proposal')); onDone(); }
    catch (e) { setAnswer(`The proposal could not be made: ${(e as Error)?.message ?? e}`); }
    finally { setBusy(false); }
  };
  return (
    <section className="om-new" aria-label="New proposal">
      <h3>New proposal from documents</h3>
      <label className="om-field"><span>Kind</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'extend')}>
          <option value="extend">Extend an existing ontology</option><option value="new">Create a new ontology</option>
        </select>
      </label>
      <label className="om-field"><span>{mode === 'extend' ? 'Ontology' : 'Name (letters, digits, - and _)'}</span>
        {mode === 'extend'
          ? <select value={slug} onChange={(e) => setSlug(e.target.value)}>{ontologies.filter((o) => o.status === 'published').map((o) => <option key={o.slug} value={o.slug}>{o.title}</option>)}</select>
          : <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="procurement_docs" />}
      </label>
      <label className="om-field"><span>Documents (optional)</span>
        <input value={docs} onChange={(e) => setDocs(e.target.value)} placeholder="Names in the documents folder; empty takes all" />
      </label>
      <button className="om-filter om-filter-on" disabled={!can} onClick={() => void run()}>{busy ? 'Reading the documents…' : 'Create the proposal'}</button>
      {busy && onStop && <button className="om-filter" onClick={onStop}>Stop</button>}
      {!ready && <p className="om-note-small">Needs the desktop app with the Ontology Manager connector and a model key. Nothing is changed in the catalog by a proposal.</p>}
      {answer && <p className="om-note-small om-answer" role="status">{answer}</p>}
    </section>
  );
}

function Review({ p, generate, ready, onDone }: { p: Proposal; generate?: Generate; ready: boolean; onDone: () => void }) {
  const [onlyLook, setOnlyLook] = useState(false);
  const [sure, setSure] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const totals = proposalTotals(p);
  const look = [...p.classes, ...p.datatypeProperties, ...p.objectProperties].filter((it) => needsLook(p, it)).length;
  const run = async (prompt: string, title: string) => {
    if (!generate) return;
    setBusy(true); setAnswer('');
    try { setAnswer(await generate(prompt, title, 'ontology-proposal')); onDone(); }
    catch (e) { setAnswer(`That did not work: ${(e as Error)?.message ?? e}`); }
    finally { setBusy(false); setSure(false); setDiscarding(false); }
  };
  const can = Boolean(generate) && ready && !busy;
  const group = (title: string, items: ProposalItem[]) => {
    const shown = onlyLook ? items.filter((it) => needsLook(p, it)) : items;
    if (!shown.length) return null;
    return (
      <div className="om-review-group" key={title}>
        <h3>{title} <span className="om-dim">{shown.length}</span></h3>
        {shown.map((it) => (
          <article key={`${title}:${it.name}`} className={`om-item ${needsLook(p, it) ? 'om-item-look' : ''}`}>
            <header>
              <b>{it.name}</b>
              <span className={`om-chip ${it.action === 'new' ? '' : 'om-ok'}`}>{it.action === 'new' ? 'New' : it.action === 'extend' ? 'Extends' : 'Reuses'}</span>
              {needsLook(p, it) && <span className="om-chip om-warn">Needs a look</span>}
              {(it.domain || it.range) && <span className="om-dim">{it.domain} → {it.range}</span>}
            </header>
            {it.description && <p>{it.description}</p>}
            {it.baseline && <p className="om-dim">Matches {it.baseline}{it.confidence ? `, confidence ${it.confidence}` : ''}{it.rationale ? `. ${it.rationale}` : ''}</p>}
            {it.evidence.length > 0
              ? it.evidence.map((q) => <blockquote key={q}>{q}</blockquote>)
              : <p className="om-dim">No quote from the documents supports this item.</p>}
          </article>
        ))}
      </div>
    );
  };
  return (
    <section className="om-table om-review" aria-label="Review">
      <div className="om-table-head">
        <h2>{p.mode === 'new' ? 'New ontology' : 'Extension of'} {p.slug}</h2>
        <div className="om-filters">
          <span className="om-chip">{totals.new} new</span><span className="om-chip om-ok">{totals.extend} extend</span><span className="om-chip om-ok">{totals.reuse} reuse</span>
          <button className={`om-filter ${onlyLook ? 'om-filter-on' : ''} om-filter-warn`} aria-pressed={onlyLook} onClick={() => setOnlyLook((v) => !v)}>Needs a look {look}</button>
        </div>
      </div>
      <p className="om-note-small om-pad">Read from {p.documents.map((d) => `${d.file} (${d.chunks} chunks)`).join(', ') || 'no documents'}{p.model ? ` with ${p.model}` : ''}. Nothing is in the catalog until you confirm.</p>
      {p.status === 'failed' && <p className="om-note om-pad">This proposal failed: {p.error || 'no reason recorded'}.</p>}
      <div className="om-pad">
        {group('Classes', p.classes)}
        {group('Data properties', p.datatypeProperties)}
        {group('Links between things', p.objectProperties)}
        {p.warnings.length > 0 && <p className="om-note-small">Warnings: {p.warnings.join('; ')}</p>}
      </div>
      {p.status === 'proposed' && (
        <footer className="om-confirm">
          <label className="om-check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I reviewed these terms and want them in the catalog{p.mode === 'extend' ? '. The old version is saved first.' : '.'}</label>
          <div className="om-plan-actions">
            <button className="om-filter om-filter-on" disabled={!can || !sure} onClick={() => void run(applyPrompt(p), 'Apply ontology proposal')}>{busy ? 'Working…' : 'Apply to the catalog'}</button>
            {!discarding
              ? <button className="om-filter" disabled={!can} onClick={() => setDiscarding(true)}>Discard…</button>
              : <button className="om-filter om-filter-warn" disabled={!can} onClick={() => void run(discardPrompt(p), 'Discard ontology proposal')}>Yes, discard this proposal</button>}
          </div>
          {!ready && <p className="om-note-small">Applying needs the desktop app with the Ontology Manager connector.</p>}
        </footer>
      )}
      {answer && <p className="om-note om-pad om-answer" role="status">{answer}</p>}
    </section>
  );
}
