import { useMemo, useState } from 'react';
import type { Governance, Ontology, Term } from '../ontology-manager';
import { exampleRegistry } from '../registry-examples';
import { hostApi, loadRegistry } from '../registry';
import { listSkills, readSkill } from '../skills';
import { fetchSpaceHtml, listSpaces } from '../spaces';
import { applyDecisions, declaredUsages, decisionsOf, findUsages, searchTerms, summarize, type Decided, type Usage, type UsageSummary } from '../ontology-usage';
import { loadUsageSources, type Loaded } from '../ontology-usage-load';

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

export interface TermUsage {
  phase: 'idle' | 'loading' | 'done';
  error: string;
  run: () => Promise<void>;
  data: { loaded: Loaded; example: boolean } | null;
  /** Everything found for this term, before the decisions of people. */
  mine: Usage[];
  decided: Decided;
  summary: UsageSummary;
  /** Found and dismissed by a person. */
  dismissed: Usage[];
  /** The users were searched in this window (the approval needs that). */
  searched: boolean;
}

/** The probable users of one term (found, declared, decided) and the way to search for them. Shared by the user list and the approval block. */
export function useTermUsage(onto: Ontology, term: Term, ontologies: readonly Ontology[] | undefined, gov: Governance): TermUsage {
  const fresh = cache && Date.now() - cache.at < KEEP_MS ? cache : null;
  const [phase, setPhase] = useState<TermUsage['phase']>(fresh ? 'done' : 'idle');
  const [data, setData] = useState<TermUsage['data']>(fresh);
  const [error, setError] = useState('');
  const run = async () => {
    setPhase('loading'); setError('');
    try {
      const read = await readSources();
      cache = { at: Date.now(), ...read };
      setData(read); setPhase('done');
    } catch (e) { setError(String((e as { message?: unknown })?.message ?? e).slice(0, 200)); setPhase('idle'); }
  };
  const terms = useMemo(() => searchTerms(ontologies ?? [], gov), [ontologies, gov]);
  const mine = useMemo(() => (data ? findUsages(terms, data.loaded.sources).usages.filter((u) => u.slug === onto.slug && u.term === term.id) : []), [data, terms, onto.slug, term.id]);
  const decisions = decisionsOf(gov);
  const declared = useMemo(() => declaredUsages(gov).filter((u) => u.slug === onto.slug && u.term === term.id), [gov, onto.slug, term.id]);
  const decided = useMemo(() => applyDecisions(mine, declared, decisions), [mine, declared, decisions]);
  const summary = useMemo(() => summarize(decided), [decided]);
  const dismissed = useMemo(() => mine.filter((u) => decisions[u.key]?.decision === 'dismissed'), [mine, decisions]);
  return { phase, error, run, data, mine, decided, summary, dismissed, searched: phase === 'done' && data !== null };
}

/**
 * The users that were found in this window (the sources are kept for a few minutes) and are still only suspected, for the map.
 * Reads nothing: without a search in this window there are none.
 */
export function cachedSuspected(ontologies: readonly Ontology[], gov: Governance): Array<{ slug: string; term: string; kind: string; name: string }> {
  if (!cache || Date.now() - cache.at >= KEEP_MS) return [];
  const found = findUsages(searchTerms(ontologies, gov), cache.loaded.sources).usages;
  const decided = applyDecisions(found, declaredUsages(gov), decisionsOf(gov));
  return decided.usages.filter((u) => u.state === 'suspected' && u.strength !== 'weak').map((u) => ({ slug: u.slug, term: u.term, kind: u.kind, name: u.name }));
}
