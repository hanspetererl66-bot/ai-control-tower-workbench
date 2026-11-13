import { useMemo, useState } from 'react';
import type { Governance, Ontology, Term } from '../ontology-manager';
import { exampleRegistry } from '../registry-examples';
import { hostApi, loadRegistry } from '../registry';
import { listSkills, readSkill } from '../skills';
import { fetchSpaceHtml, listSpaces } from '../spaces';
import {
  applyDecisions, declaredUsages, decisionsOf, findUsages, searchTerms, setUsageDecision, summarize, type Evidence, type Usage,
} from '../ontology-usage';
import { loadUsageSources, type Loaded, type LoadNote } from '../ontology-usage-load';

const KIND_LABEL: Record<string, string> = { agent: 'Agent', workflow: 'Workflow', feature: 'Feature', skill: 'Skill', space: 'Space', report: 'Report' };
const FIELD_LABEL: Record<string, string> = {
  'relation.data': 'data relation', 'relation.process': 'process relation', 'relation.capability': 'capability relation', 'relation.other': 'relation',
  tag: 'tag', name: 'name', purpose: 'description', body: 'text',
};
const SOURCE_LABEL: Record<string, string> = { registry: 'Registry', skills: 'Skills', spaces: 'Spaces' };

/** The sources are read once and kept for a few minutes: opening the next term does not read everything again. */
const KEEP_MS = 5 * 60 * 1000;
let cache: { at: number; example: boolean; loaded: Loaded } | null = null;

async function readSources(): Promise<{ loaded: Loaded; example: boolean }> {
  const api = hostApi();
  const loaded = await loadUsageSources({
    // Without the database (a plain browser) the invented example registry stands in, and the page says so.
    registry: api ? () => loadRegistry(api) : async () => exampleRegistry().items,
    skills: () => listSkills(),
    readSkill: (dir) => readSkill(dir),
    spaces: () => listSpaces(),
    readSpaceHtml: (slug) => fetchSpaceHtml(slug, Date.now()),
  });
  return { loaded, example: !api };
}

const strongest = (u: Usage): Evidence | undefined => u.evidence[0];

/**
 * Who probably uses this term: found in registry cards, skills and spaces. Everything found is only "suspected", with the place it
 * was found; a person confirms or dismisses it, and only that decision is saved (governance.json). Reads only.
 */
export default function OntologyUsers({ onto, term, ontologies, gov, onGovernance, actor }: {
  onto: Ontology; term: Term; ontologies: readonly Ontology[]; gov: Governance; onGovernance: (g: Governance) => void; actor: string;
}) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>(cache && Date.now() - cache.at < KEEP_MS ? 'done' : 'idle');
  const [data, setData] = useState<{ loaded: Loaded; example: boolean } | null>(cache && Date.now() - cache.at < KEEP_MS ? cache : null);
  const [error, setError] = useState('');
  const [showWeak, setShowWeak] = useState(false);

  const run = async () => {
    setPhase('loading'); setError('');
    try {
      const read = await readSources();
      cache = { at: Date.now(), ...read };
      setData(read); setPhase('done');
    } catch (e) { setError(String((e as { message?: unknown })?.message ?? e).slice(0, 200)); setPhase('idle'); }
  };

  const terms = useMemo(() => searchTerms(ontologies, gov), [ontologies, gov]);
  const mine = useMemo(() => (data ? findUsages(terms, data.loaded.sources).usages.filter((u) => u.slug === onto.slug && u.term === term.id) : []), [data, terms, onto.slug, term.id]);
  const decisions = decisionsOf(gov);
  const declared = useMemo(() => declaredUsages(gov).filter((u) => u.slug === onto.slug && u.term === term.id), [gov, onto.slug, term.id]);
  const decided = useMemo(() => applyDecisions(mine, declared, decisions), [mine, declared, decisions]);
  const summary = useMemo(() => summarize(decided), [decided]);
  const dismissed = mine.filter((u) => decisions[u.key]?.decision === 'dismissed');
  const found = decided.usages.filter((u) => u.state !== 'declared' || u.evidence.length);
  const strong = found.filter((u) => u.state !== 'suspected' || u.strength !== 'weak');
  const weak = found.filter((u) => u.state === 'suspected' && u.strength === 'weak');

  const decide = (u: Usage, d: 'confirmed' | 'dismissed') => onGovernance(setUsageDecision(gov, u.key, d, actor, Date.now()));
  const row = (u: Usage) => {
    const ev = strongest(u);
    return (
      <li key={u.key} className="om-usage-row">
        <div>
          <b>{u.name}</b> <span className="om-chip">{KIND_LABEL[u.kind] ?? u.kind}</span>
          <span className={`om-chip ${u.state === 'suspected' ? 'om-warn' : 'om-ok'}`}>{u.state === 'suspected' ? 'Suspected' : u.state === 'declared' ? 'Declared' : 'Confirmed'}</span>
          {u.ambiguous && <span className="om-chip om-warn" title="The same name belongs to terms of two ontologies">Ambiguous</span>}
          {['critical', 'mission-critical'].includes(u.criticality) && <span className="om-chip om-bad">{u.criticality}</span>}
          {u.owner && <span className="om-dim"> · {u.owner}</span>}
        </div>
        {ev && <p className="om-usage-evidence"><span className="om-dim">{FIELD_LABEL[ev.field] ?? ev.field}{ev.via !== 'label' ? ` (via ${ev.via} "${ev.phrase}")` : ''}:</span> “{ev.excerpt}”</p>}
        <div className="om-plan-actions">
          {u.state === 'suspected' && <>
            <button className="om-filter om-filter-on" onClick={() => decide(u, 'confirmed')}>Confirm</button>
            <button className="om-filter" onClick={() => decide(u, 'dismissed')}>Not a user</button>
          </>}
          {u.state === 'confirmed' && <button className="om-filter" onClick={() => decide(u, 'confirmed')}>Undo</button>}
        </div>
      </li>
    );
  };
  const note = (n: LoadNote) => (
    <li key={n.source} className={n.status === 'ok' ? '' : 'om-usage-warn'}>
      <b>{SOURCE_LABEL[n.source]}</b>: {n.status === 'missing' || n.status === 'failed' ? 'not read' : `${n.read} of ${n.of} read`}
      {n.source === 'registry' && data?.example && n.status === 'ok' ? ' (the invented example registry, no database connection)' : ''}
      {n.detail ? ` — ${n.detail}` : ''}
    </li>
  );

  return (
    <section className="om-usage" aria-label="Probable users of this term">
      <h4>Probable users</h4>
      {phase === 'idle' && (
        <>
          <p className="om-note-small">Looks for this term in registry cards, skills and spaces. What it finds is only suspected until a person confirms it. Reads only.</p>
          {error && <p className="om-usage-warn">{error}</p>}
          <button className="om-filter om-filter-on" onClick={() => void run()}>Find users</button>
        </>
      )}
      {phase === 'loading' && <p className="om-note-small" role="status">Reading registry, skills and spaces…</p>}
      {phase === 'done' && data && (
        <>
          <p className="om-usage-summary" role="status">
            <b>{summary.total}</b> {summary.total === 1 ? 'user' : 'users'}: {summary.confirmed} declared or confirmed, {summary.suspected} suspected{summary.weak ? ` (${summary.weak} only weak hits)` : ''}.
            {summary.owners.length ? ` Ask first: ${summary.owners.join(', ')}.` : ''}
            {summary.dismissed ? ` ${summary.dismissed} dismissed.` : ''}
          </p>
          {summary.openCritical.length > 0 && <p><span className="om-chip om-warn">Critical and still suspected</span> {summary.openCritical.map((u) => u.name).join(', ')}</p>}
          <ul className="om-list om-usage-list">
            {strong.length === 0 && <li className="om-dim">{weak.length ? 'Only weak hits so far (below).' : 'No user found in the sources that were read.'}</li>}
            {strong.map(row)}
          </ul>
          {weak.length > 0 && (
            <>
              <button className="om-filter" aria-expanded={showWeak} onClick={() => setShowWeak((v) => !v)}>{showWeak ? 'Hide' : 'Show'} {weak.length} weak {weak.length === 1 ? 'hit' : 'hits'}</button>
              {showWeak && <ul className="om-list om-usage-list">{weak.map(row)}</ul>}
            </>
          )}
          {dismissed.length > 0 && (
            <ul className="om-list om-usage-list">
              {dismissed.map((u) => (
                <li key={u.key} className="om-usage-row"><span className="om-dim">Dismissed:</span> <b>{u.name}</b> <span className="om-chip">{KIND_LABEL[u.kind] ?? u.kind}</span>
                  <span className="om-plan-actions"><button className="om-filter" onClick={() => decide(u, 'dismissed')}>Undo</button></span></li>
              ))}
            </ul>
          )}
          <ul className="om-note-small om-usage-notes">{data.loaded.notes.map(note)}<li>Not seen: anything an agent only fetches while it runs, and code outside these sources.</li></ul>
          <button className="om-filter" onClick={() => void run()}>Read again</button>
        </>
      )}
    </section>
  );
}
