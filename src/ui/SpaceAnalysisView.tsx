import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackArrow } from './AdminHero';
import { FEATURES, analyzeSpace, failedReport, filterReports, fixRequest, summarize, HEALTH_LABEL, RULE_LABEL, type FeatureFilter, type HealthFilter, type SpaceReport } from '../space-analysis';
import { fetchSpaceHtml, type Space } from '../spaces';

const FILTERS: HealthFilter[] = ['all', 'fix', 'review', 'minor', 'ok'];
const chip = (h: SpaceReport['health']) => (h === 'ok' ? 'om-ok' : h === 'fix' ? 'om-bad' : h === 'review' ? 'om-warn' : '');
const kb = (b: number) => (b ? (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`) : '–');

/**
 * Space Analysis (Admin console): reads every installed Space and lists what breaks the Space rules (network, browser storage,
 * fixed colours) or the basic hygiene (cards, size, description, age). It only reads; "Copy fix request" puts a ready text on the
 * clipboard for the chat, and "Open Space" shows the Space. The result is from text patterns and is a hint, not a proof.
 */
export default function SpaceAnalysisView({ spaces, onBack, onOpenSpace, fetchHtml = fetchSpaceHtml }: {
  spaces: Space[]; onBack: () => void; onOpenSpace: (slug: string) => void; fetchHtml?: (slug: string, bust: number) => Promise<string>;
}) {
  const [reports, setReports] = useState<SpaceReport[]>([]);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthFilter>('all');
  const [domain, setDomain] = useState('');
  const [query, setQuery] = useState('');
  const [fn, setFn] = useState<FeatureFilter>(null);
  const [picked, setPicked] = useState('');
  const [copied, setCopied] = useState('');
  const run = useRef(0);

  const analyse = useCallback(async () => {
    const id = ++run.current, list = [...spaces], out: SpaceReport[] = [];
    setRunning(true); setDone(0); setReports([]);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const sp = list[next++];
        try { out.push(analyzeSpace(sp, await fetchHtml(sp.slug, Date.now()))); } catch (e) { out.push(failedReport(sp, e instanceof Error ? e.message : 'not readable')); }
        if (run.current === id) setDone(out.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
    if (run.current !== id) return;
    setReports(out); setAt(Date.now()); setRunning(false);
  }, [spaces, fetchHtml]);
  useEffect(() => { void analyse(); return () => { run.current++; }; }, [analyse]);

  const sum = useMemo(() => summarize(reports), [reports]);
  const domains = useMemo(() => [...new Set(reports.map((r) => r.domain).filter(Boolean))].sort(), [reports]);
  const rows = useMemo(() => filterReports(reports, health, domain, query, fn), [reports, health, domain, query, fn]);
  const selected = reports.find((r) => r.slug === picked) ?? rows[0] ?? null;
  const counts: Record<HealthFilter, number> = { all: sum.spaces, fix: sum.fix, review: sum.review, minor: sum.minor, ok: sum.clean };

  const copy = async (r: SpaceReport) => {
    try { await navigator.clipboard.writeText(fixRequest(r)); setCopied(r.slug); } catch { setCopied('!'); }
    window.setTimeout(() => setCopied(''), 2500);
  };

  return (
    <main className="sa">
      <header className="sa-hero">
        <button className="om-back" onClick={onBack} aria-label="Back to the Admin console"><BackArrow /></button>
        <div>
          <p className="om-crumb">Admin console</p>
          <h1>Space Analysis</h1>
          <p className="om-lede">Every installed Space checked against the Space rules: no network, no browser storage, colours only as tokens, plus cards, size, description and age.</p>
        </div>
      </header>

      <div className="om-source">
        <p className="om-note" role={running ? 'status' : 'note'}>
          {running ? `Reading Spaces… ${done} of ${spaces.length}` : at ? `Analysed ${sum.spaces} Spaces at ${new Date(at).toLocaleTimeString()}. The findings come from text patterns in each page: a hint, not a proof. Nothing is changed.` : 'No Space is installed.'}
        </p>
        <button className="om-filter" onClick={() => void analyse()} disabled={running}>Analyse again</button>
      </div>

      <section className="om-kpis" aria-label="Summary">
        <div className="om-kpi"><span>Clean</span><b className="sa-ok">{sum.clean}</b></div>
        <div className="om-kpi"><span>Minor only</span><b>{sum.minor}</b></div>
        <div className="om-kpi"><span>Review</span><b className="sa-warn">{sum.review}</b></div>
        <div className="om-kpi"><span>Must fix</span><b className="sa-bad">{sum.fix}</b></div>
        <div className="om-kpi om-kpi-wide">
          <span>Most common findings</span>
          <p className="sa-rules">{sum.byRule.length ? sum.byRule.slice(0, 4).map((r) => `${RULE_LABEL[r.rule]} (${r.spaces})`).join(' · ') : 'None'}</p>
        </div>
      </section>

      <section className="sa-fns" aria-label="Key functions of the Spaces" data-guide="functions">
        <h2>Key functions <span className="om-dim">in how many Spaces</span></h2>
        <p className="om-dim">Click a function to list the Spaces that have it; click again to list those that lack it; a third time clears the filter.</p>
        <div className="sa-fn-grid">
          {sum.features.map((f) => {
            const on = fn?.id === f.id, state = on ? (fn?.has ? 'has' : 'lacks') : '';
            const cycle = () => setFn(!on ? { id: f.id, has: true } : fn?.has ? { id: f.id, has: false } : null);
            return (
              <button key={f.id} className={`sa-fn ${on ? 'sa-fn-on' : ''}`} aria-pressed={on} onClick={cycle} title={f.hint}>
                <span className="sa-fn-name">{f.label}{on && <span className="om-chip om-chip-sm">{state === 'has' ? 'with' : 'without'}</span>}</span>
                <b>{f.spaces}<small> of {sum.spaces - reports.filter((r) => r.error).length}</small></b>
                <i className="om-meter" role="img" aria-label={`${Math.round(f.share * 100)} percent`}><i style={{ width: `${Math.round(f.share * 100)}%` }} /></i>
                <span className="om-dim">{f.total} in total</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="sa-grid">
        <section className="om-table" aria-label="Spaces">
          <div className="om-table-head">
            <h2>Spaces</h2>
            <label className="om-search om-search-inline">
              <span className="om-sr">Search Spaces</span>
              <input type="search" value={query} placeholder="Search by name, group or finding" onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="om-filters" role="group" aria-label="Filter by result">
              {FILTERS.map((f) => (
                <button key={f} className={`om-filter ${health === f ? 'om-filter-on' : ''}`} aria-pressed={health === f} onClick={() => setHealth(f)}>{f === 'all' ? 'All' : HEALTH_LABEL[f]} {counts[f]}</button>
              ))}
              <select className="sa-select" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Filter by group">
                <option value="">All groups</option>{domains.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="sa-row sa-row-head" aria-hidden="true"><span>Space</span><span>Group</span><span>Cards</span><span>Size</span><span>Findings</span><span>Result</span></div>
          {fn && <p className="om-note" role="status">Showing Spaces {fn.has ? 'with' : 'without'}: {sum.features.find((f) => f.id === fn.id)?.label}. Unreadable Spaces are left out.</p>}
          {!running && rows.length === 0 && <p className="om-empty">No Space matches.</p>}
          {rows.map((r) => (
            <button key={r.slug} className={`sa-row ${r.slug === selected?.slug ? 'om-row-on' : ''}`} aria-pressed={r.slug === selected?.slug} onClick={() => setPicked(r.slug)}>
              <span className="om-term">{r.title}<span className="om-aka">{r.slug}</span></span>
              <span className="om-dim">{r.domain || '–'}</span>
              <span className="om-dim">{r.cards}</span>
              <span className="om-dim">{kb(r.bytes)}</span>
              <span>{r.error ? 'unreadable' : r.findings.length}</span>
              <span><span className={`om-chip ${chip(r.health)}`}>{HEALTH_LABEL[r.health]}</span></span>
            </button>
          ))}
          <p className="om-foot">Showing {rows.length} of {sum.spaces} Spaces</p>
        </section>

        {selected && (
          <aside className="om-detail" aria-label="Findings of the chosen Space">
            <div className="om-detail-top"><span className="om-dim">{selected.domain || 'No group'}</span><span className={`om-chip ${chip(selected.health)}`}>{HEALTH_LABEL[selected.health]} · {selected.score}</span></div>
            <h2>{selected.title}</h2>
            <p className="om-dim">{selected.slug} · {selected.cards} cards · {kb(selected.bytes)}{selected.asOf ? ` · data as of ${selected.asOf}` : ''}</p>
            {selected.error && <p className="om-note" role="alert">The page could not be read: {selected.error}. It is not counted as clean.</p>}
            {!selected.error && selected.findings.length === 0 && <p className="om-note">No findings. This Space keeps the rules that were checked.</p>}
            <h3 className="sa-sub">Functions on this page</h3>
            <p className="sa-have">{FEATURES.filter((f) => selected.features[f.id] > 0).map((f) => `${f.label} (${selected.features[f.id]})`).join(' · ') || 'None found'}</p>
            <ul className="sa-findings">
              {selected.findings.map((f) => (
                <li key={f.rule}>
                  <span className={`om-chip om-chip-sm ${f.severity === 'high' ? 'om-bad' : 'om-warn'}`}>{f.severity === 'high' ? 'High' : f.severity === 'medium' ? 'Medium' : 'Low'}</span>
                  <b>{f.title}</b>
                  <p>{f.detail}</p>
                  <p className="om-dim">How to fix: {f.fix}</p>
                </li>
              ))}
            </ul>
            <div className="sa-actions">
              <button className="om-filter om-filter-on" onClick={() => onOpenSpace(selected.slug)}>Open Space</button>
              {selected.findings.length > 0 && <button className="om-filter" onClick={() => void copy(selected)}>Copy fix request</button>}
              {copied && <span className="om-chip" role="status">{copied === '!' ? 'Could not copy' : 'Copied: paste it in the chat'}</span>}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
