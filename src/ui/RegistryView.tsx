import { useCallback, useEffect, useMemo, useState } from 'react';
import { FLOW, FLOW_LABEL, type FlowStep } from '../flow';
import {
  TYPES, TYPE_LABEL, addLink, diffRevisions, featureArgs, filterItems, hostApi, itemsForRef, loadHistory, loadRegistry, loadRevFiles, noFilter, parseFeature,
  restoreRevision, setStage, stageText, type FileDiff, type Filter, type RItem, type Rev, type RevFile,
} from '../registry';
import { MODE_LABEL, policyGaps, revisionPolicy, widens, type RevisionPolicy } from '../policy-manifest';
import { commentFor, isDone, labelsFor, loadLog, markerOf, notedAt, parseWriteback, record, saveLog, summaryOf, ticketsOf, writebackPrompt, type WriteResult } from '../writeback';

const when = (t: number) => (t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 240);

/**
 * Registry: everything built so far (agents, workflows, features) with the full history of each item. Reads the work items of the
 * shared database; every save there is a revision with author, time and note. Nothing here deletes a revision: "Restore" saves an old
 * revision as the newest one.
 */
type GenerateProps = { generate?: (prompt: string, title: string, session?: string) => Promise<string>; onStop?: () => void; ready?: boolean };

export default function RegistryView({ generate, onStop, ready = false, onBack }: GenerateProps & { onBack?: () => void }) {
  const api = useMemo(() => hostApi(), []);
  const [items, setItems] = useState<RItem[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>(noFilter());
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setError('');
    try { setItems(await loadRegistry(api)); } catch (e) { setError(msg(e)); setItems((cur) => cur ?? []); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => filterItems(items ?? [], filter), [items, filter]);
  const open = (items ?? []).find((i) => i.id === openId) ?? null;

  return (
    <main className="sh rg">
      <header className="sh-head">
        <div>
          {onBack && <button className="ghost-btn" onClick={onBack} aria-label="Back to Admin">← Admin</button>}
          <h1>Solution register</h1>
          <p>{items ? `${items.filter((i) => !i.archived).length} items · agents, workflows and features with their history` : 'Agents, workflows and features with their history'}</p>
        </div>
        <button className="rg-refresh" onClick={() => void load()} disabled={!api}>Refresh</button>
      </header>

      {!api ? (
        <p className="sh-empty">The solution register reads the shared database. It is available in the desktop app, once the connector "werkbank-workspace" has the Supabase URL and the secret key.</p>
      ) : (
        <>
          <div className="rg-filters">
            <input type="search" aria-label="Search the registry" placeholder="Search by name, owner or ticket (e.g. ABC-12)" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
            <select aria-label="Type" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value as Filter['type'] })}>
              <option value="all">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            <select aria-label="Status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as Filter['status'] })}>
              <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
            </select>
          </div>
          {error && <p className="rg-error" role="alert">{error}</p>}
          {items === null ? <p className="sh-empty">Loading…</p> : (
            <div className={`rg-split ${open ? 'rg-split-open' : ''}`}>
              <div className="sh-scroll rg-list">
                {shown.length === 0 ? <p className="sh-empty">{items.length === 0 ? 'Nothing here yet. Agents and workflows appear after their first save, features when you hand a cluster over from Sources.' : 'No item matches.'}</p> : (
                  <table className="sh-table">
                    <thead><tr><th>Type</th><th>Name</th><th>Where it stands</th><th>Owner</th><th>Rev</th><th>Changed</th></tr></thead>
                    <tbody>
                      {shown.map((i) => (
                        <tr key={i.id} className={`rg-row ${i.id === openId ? 'rg-row-on' : ''}`} onClick={() => setOpenId(i.id)}>
                          <td><span className={`rg-type rg-type-${i.type}`}>{TYPE_LABEL[i.type]}</span></td>
                          <td><button className="rg-name" onClick={(e) => { e.stopPropagation(); setOpenId(i.id); }}>{i.name}</button>
                            {i.extendsItem && <small>extends {i.extendsItem.name}</small>}
                            {i.refs.length > 0 && <small>{i.refs.slice(0, 3).map((r) => r.key).join(', ')}{i.refs.length > 3 ? ` +${i.refs.length - 3}` : ''}</small>}</td>
                          <td>{stageText(i) || '–'}</td>
                          <td>{i.owner}</td>
                          <td>{i.rev}</td>
                          <td>{when(i.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {open && <Detail key={open.id} item={open} all={items} generate={generate} onStop={onStop} ready={ready} onClose={() => setOpenId(null)} onChanged={load} onFind={(key) => { setFilter({ ...noFilter(), status: 'all', query: key }); setOpenId(null); }} />}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Detail({ item, all, onClose, onChanged, onFind, generate, onStop, ready }: { item: RItem; all: RItem[]; onClose: () => void; onChanged: () => Promise<void>; onFind: (key: string) => void } & GenerateProps) {
  const api = useMemo(() => hostApi()!, []);
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [sel, setSel] = useState<number>(item.rev);
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  const [pol, setPol] = useState<RevisionPolicy | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadRevs = useCallback(async () => {
    try { const r = await loadHistory(api, item.id); setRevs(r); setSel(r[0]?.rev ?? 0); } catch (e) { setNote(msg(e)); setRevs([]); }
  }, [api, item.id]);
  useEffect(() => { void loadRevs(); }, [loadRevs, item.rev]);

  // The differences of the chosen revision to the one before it.
  useEffect(() => {
    let live = true;
    setDiff(null); setPol(null);
    if (!sel) return;
    (async () => {
      try {
        const now = await loadRevFiles(api, item.id, sel);
        const before: RevFile[] = sel > 1 ? await loadRevFiles(api, item.id, sel - 1) : [];
        if (live) { setDiff(diffRevisions(before, now)); setPol(revisionPolicy(before, now)); }
      } catch (e) { if (live) { setDiff([]); setPol(null); setNote(msg(e)); } }
    })();
    return () => { live = false; };
  }, [api, item.id, sel]);

  const same = (item.refs[0] ? itemsForRef(all, item.refs[0].source, item.refs[0].key) : []).filter((i) => i.id !== item.id);
  const restore = async () => {
    if (!window.confirm(`Restore revision ${sel} of "${item.name}" as the newest revision? Nothing is deleted; the history keeps every revision.`)) return;
    setBusy(true); setNote('');
    try { const rev = await restoreRevision(api, item, sel); setNote(`Revision ${sel} is now revision ${rev}.`); await onChanged(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };

  return (
    <aside className="sh-card rg-detail" aria-label={`History of ${item.name}`}>
      <div className="rg-detail-head">
        <div>
          <h2>{item.name}</h2>
          <p className="sh-note"><span className={`rg-type rg-type-${item.type}`}>{TYPE_LABEL[item.type]}</span> · {item.owner} · revision {item.rev}{stageText(item) ? ` · ${stageText(item)}` : ''}{item.archived ? ' · archived' : ''}</p>
        </div>
        <button onClick={onClose} aria-label="Close the history">✕</button>
      </div>

      {(item.refs.length > 0 || item.extendsItem) && (
        <div className="rg-links">
          {item.extendsItem && <span className="rg-chip">extends {item.extendsItem.name}</span>}
          {item.refs.map((r) => (
            <span key={`${r.source}:${r.key}`} className="rg-chip" title={r.title}>
              <button onClick={() => onFind(r.key)} aria-label={`Show everything from ${r.key}`}>{r.key}</button>
              {r.url && <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.key} in ${r.source}`}>↗</a>}
            </span>
          ))}
        </div>
      )}
      {same.length > 0 && <p className="sh-note">Same source: {same.map((i) => i.name).join(', ')}</p>}

      {generate && !item.archived && item.type !== 'code' && ticketsOf(item).length > 0 && <JiraPanel item={item} generate={generate} onStop={onStop} ready={Boolean(ready)} />}

      {item.type === 'feature' && <FeaturePanel item={item} api={api} onSaved={async (text) => { setNote(text); await onChanged(); }} />}

      <h3 className="rg-h">History</h3>
      {revs === null ? <p className="sh-note">Loading…</p> : (
        <ol className="rg-timeline">
          {revs.map((r) => (
            <li key={r.rev} className={r.rev === sel ? 'rg-rev-on' : ''}>
              <button onClick={() => setSel(r.rev)} aria-pressed={r.rev === sel}>
                <b>Rev {r.rev}{r.rev === item.rev ? ' · current' : ''}</b>
                <span>{r.note || 'Saved'}</span>
                <small>{r.author} · {when(r.at)} · {r.files} file{r.files === 1 ? '' : 's'}</small>
              </button>
            </li>
          ))}
        </ol>
      )}

      {sel > 0 && item.type !== 'feature' && item.type !== 'code' && pol && (pol.policy || pol.note) && <PolicyPanel rev={sel} pol={pol} />}

      {sel > 0 && (
        <>
          <h3 className="rg-h">What changed in revision {sel}{sel > 1 ? ` (compared with ${sel - 1})` : ''}</h3>
          {diff === null ? <p className="sh-note">Loading…</p> : diff.filter((d) => d.status !== 'same').length === 0 ? <p className="sh-note">No file changed.</p> : (
            <div className="rg-diffs">
              {diff.filter((d) => d.status !== 'same').map((d) => (
                <details key={d.path} open={d.status === 'changed' && diff.length <= 3}>
                  <summary><code>{d.path}</code> <span className={`rg-st rg-st-${d.status}`}>{d.status}</span></summary>
                  {d.lines.length > 0 && <pre className="rg-diff">{d.lines.map((l, i) => <span key={i} className={`rg-l rg-l-${l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '…' ? 'gap' : 'eq'}`}>{l.t === '…' ? `… ${l.s}` : `${l.t} ${l.s}`}{'\n'}</span>)}</pre>}
                </details>
              ))}
            </div>
          )}
          {sel !== item.rev && <button className="sh-primary rg-restore" onClick={() => void restore()} disabled={busy}>Restore revision {sel} as the newest</button>}
        </>
      )}
      {note && <p className="sh-note" role="status">{note}</p>}
    </aside>
  );
}

/**
 * What the revision declares it may do (policy.json, derived from the project) and what became wider or narrower since the revision
 * before. Declared, not enforced: nothing here stops an action. Undeclared limits are named as gaps, never shown as limits.
 */
function PolicyPanel({ rev, pol }: { rev: number; pol: RevisionPolicy }) {
  const m = pol.policy;
  if (!m) return <><h3 className="rg-h">Declared rights</h3><p className="sh-note">{pol.note}</p></>;
  const gaps = policyGaps(m);
  const wider = widens(pol.changes);
  return (
    <section className="rg-policy" aria-label={`Declared rights of revision ${rev}`}>
      <h3 className="rg-h">Declared rights in revision {rev}</h3>
      <p className="rg-pol-line">
        <span className="rg-chip">{MODE_LABEL[m.mode]}</span>
        <span className="rg-chip">{m.humanApproval ? 'A person approves changes' : 'No approval step'}</span>
        <span className="rg-chip">{m.run.unattended ? 'Can run without a person' : 'Started by a person'}</span>
        {m.limits.maxSteps !== null && <span className="rg-chip">Up to {m.limits.maxSteps} steps</span>}
      </p>
      <p className="sh-note">{m.systems.length ? `Systems: ${m.systems.map((s) => `${s.label} (${s.access})`).join(', ')}` : 'No systems named.'}</p>
      {gaps.length > 0 && <p className="sh-note">Not declared yet: {gaps.join(', ')}. These are not limits.</p>}
      {pol.note && <p className="sh-note">{pol.note}</p>}
      {pol.changes.length > 0 && (
        <>
          <p className={`rg-pol-head${wider ? ' rg-pol-wider' : ''}`}>{wider ? 'This revision gives the item more room' : 'Rights changed in this revision'}</p>
          <ul className="rg-pol-list">
            {pol.changes.map((c) => (
              <li key={c.field} className={`rg-pol-${c.direction}`}>
                <b>{c.direction === 'wider' ? '↑ wider' : c.direction === 'narrower' ? '↓ narrower' : 'changed'}</b> {c.label}: {c.from} → {c.to}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A feature has no definition to restore from the list: its events are stage changes and links. */
function FeaturePanel({ item, api, onSaved }: { item: RItem; api: NonNullable<ReturnType<typeof hostApi>>; onSaved: (text: string) => Promise<void> }) {
  const [stage, setStageState] = useState<FlowStep>((FLOW as readonly string[]).includes(item.stage) ? (item.stage as FlowStep) : 'intent');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (change: (doc: NonNullable<ReturnType<typeof parseFeature>>) => { doc: ReturnType<typeof parseFeature>; note: string }) => {
    setBusy(true); setProblem('');
    try {
      const cur = await api.call('get_work_item', { id: item.id, include_content: true });
      const doc = parseFeature(cur?.files ?? []);
      if (!doc) throw new Error('This item is not a feature of the Werkbank.');
      const out = change(doc);
      if (!out.doc) throw new Error(out.note);
      await api.call('save_work_item', featureArgs(out.doc, { id: item.id, expectedRev: Number(cur.current_rev) || item.rev, note: out.note }));
      setLabel(''); setUrl('');
      await onSaved(out.note);
    } catch (e) { setProblem(msg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="rg-feature">
      <div className="rg-frow">
        <label>Stage
          <select value={stage} onChange={(e) => setStageState(e.target.value as FlowStep)}>
            {FLOW.map((s) => <option key={s} value={s}>{FLOW_LABEL[s]}</option>)}
          </select>
        </label>
        <button disabled={busy || stage === item.stage} onClick={() => void save((d) => ({ doc: setStage(d, stage), note: `Stage: ${FLOW_LABEL[stage]}` }))}>Save stage</button>
      </div>
      <div className="rg-frow">
        <label>Link
          <input aria-label="Link label" placeholder="Label (e.g. PR 181)" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="rg-grow">Address
          <input aria-label="Link address" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button disabled={busy || !url.trim()} onClick={() => void save((d) => { const next = addLink(d, label, url); return next ? { doc: next, note: `Link added: ${label.trim() || url.trim()}`.slice(0, 300) } : { doc: null, note: 'Enter a full http(s) address that is not in the list yet.' }; })}>Add link</button>
      </div>
      {problem && <p className="rg-error" role="alert">{problem}</p>}
    </div>
  );
}

/**
 * Note this entry on the Jira tickets it came from: one label and one comment. Two steps on purpose: first the exact text and the
 * tickets are shown, only the second click lets the agent write. The agent may use three Jira tools and touch only these tickets.
 */
function JiraPanel({ item, generate, onStop, ready }: { item: RItem; generate: NonNullable<GenerateProps['generate']>; onStop?: () => void; ready: boolean }) {
  const tickets = ticketsOf(item);
  const [log, setLog] = useState(() => loadLog(window.localStorage));
  const [picked, setPicked] = useState<string[]>(() => tickets.map((t) => t.key).filter((k) => !notedAt(loadLog(window.localStorage), item.id, k)));
  const [edited, setEdited] = useState<string | null>(null);
  const [step, setStep] = useState<'idle' | 'confirm' | 'running'>('idle');
  const [results, setResults] = useState<WriteResult[] | null>(null);
  const [problem, setProblem] = useState('');
  const comment = edited ?? commentFor(item);
  const labels = labelsFor(item);
  const valid = comment.startsWith(markerOf(item)) && comment.length <= 2000;

  const write = async () => {
    setStep('running'); setProblem(''); setResults(null);
    try {
      const text = await generate(writebackPrompt(picked, labels, comment), 'Note on Jira', 'jira-writeback');
      if (!text) { setProblem('Stopped. Some tickets may already have been changed; the agent skips what is already there when you try again.'); return; }
      const got = parseWriteback(text, picked);
      if (!got) { setProblem('The answer could not be read. Check the tickets in Jira before you try again.'); return; }
      setResults(got);
      const next = record(log, item.id, item.rev, got);
      setLog(next); saveLog(window.localStorage, next);
      setPicked((cur) => cur.filter((k) => !got.some((r) => r.key === k && isDone(r))));
    } catch (e) { setProblem(msg(e)); } finally { setStep('idle'); }
  };

  return (
    <section className="rg-jira" aria-label="Note on Jira">
      <h3 className="rg-h">Note on Jira</h3>
      <div className="rg-jira-tickets">
        {tickets.map((t) => {
          const was = notedAt(log, item.id, t.key);
          return (
            <label key={t.key} title={t.title}>
              <input type="checkbox" checked={picked.includes(t.key)} disabled={step !== 'idle'} onChange={() => setPicked((cur) => (cur.includes(t.key) ? cur.filter((k) => k !== t.key) : [...cur, t.key]))} />
              {t.key}{was && <small>noted {when(was.at)} (rev {was.rev})</small>}
            </label>
          );
        })}
      </div>
      {step === 'idle' && (
        <button className="sh-primary" disabled={!ready || picked.length === 0} onClick={() => { setResults(null); setProblem(''); setStep('confirm'); }}>Review the note for {picked.length} ticket{picked.length === 1 ? '' : 's'}…</button>
      )}
      {!ready && <small className="sh-note">The agent is not connected yet.</small>}
      {step !== 'idle' && (
        <div className="rg-jira-confirm">
          <p className="sx-cwarn" role="alert">This changes Jira. Label {labels.join(', ')} and this comment are added to {picked.join(', ')}. Nothing else is touched.</p>
          <textarea aria-label="Comment for Jira" rows={6} value={comment} disabled={step === 'running'} onChange={(e) => setEdited(e.target.value)} />
          {!valid && <small className="sx-cwarn">The comment has to start with {markerOf(item)} (it tells the next run that this ticket was noted already) and stay under 2000 characters.</small>}
          <div className="sh-bulk">
            {step === 'running'
              ? <button onClick={onStop}>Stop</button>
              : <><button className="sh-primary" onClick={() => void write()} disabled={!valid || picked.length === 0}>Write to Jira</button><button onClick={() => setStep('idle')}>Cancel</button></>}
            {step === 'running' && <span className="sh-note">Writing…</span>}
          </div>
        </div>
      )}
      {results && (
        <div role="status">
          <p className="sh-note">{summaryOf(results)}</p>
          <ul className="rg-jira-results">{results.map((r) => <li key={r.key}><b>{r.key}</b> {isDone(r) ? 'noted' : 'not done'}{r.skipped ? ` · ${r.skipped}` : ''}{r.error ? ` · ${r.error}` : ''}</li>)}</ul>
        </div>
      )}
      {problem && <p className="rg-error" role="alert">{problem}</p>}
    </section>
  );
}
