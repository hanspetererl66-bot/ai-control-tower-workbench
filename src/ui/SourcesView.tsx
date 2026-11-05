import { useEffect, useMemo, useState } from 'react';
import {
  CAN_HAND_OVER, CLASSES, signalLine, signalOf, localTarget, CLASS_LABEL, CLASS_RULE, MAX_ITEMS, SOURCES, classBase, clusterPrompt, commentOf, dismissSuggestion, fetchPrompt, handover, isExtension,
  mergeRequirements, moveRequirement, overrideClass, parseClusters, parseRequirements, setTarget,
  type Cluster, type Handover, type RegistryRef, type ReqClass, type Requirement, type SourceKind,
} from '../requirements';
import { hostApi, loadRegistry, targetsOf } from '../registry';
import { loadMap } from '../work-sync';
import { handoverComment, handoverLabels, handoverMarker, handoverTickets, isDone, parseWriteback, summaryOf, writebackPrompt, type WriteResult } from '../writeback';

const SESSION = 'sources';
const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 240);
const ACTION: Record<ReqClass, string> = { agent: 'Create agent', 'agent-extension': 'Start extension project', workflow: 'Create workflow', 'workflow-extension': 'Start extension project', feature: 'Add as feature' };

type Props = {
  generate: (prompt: string, title: string, session?: string) => Promise<string>;
  onStop: () => void;
  ready: boolean;
  onBack: () => void;
  /** Takes the hand-over to the right place (Agent Studio, workflow wizard, registry). Returns a line for the person. */
  onHandover: (h: Handover) => Promise<string>;
  onOpenRegistry: () => void;
};

/**
 * Tile 0 of Develop: start from requirements that already exist in Jira, Slack or Notion. Four steps: load, tick, cluster (with a check
 * of the requirements that were not ticked), hand over. Each cluster carries a comment with class, confidence and reason; the person can
 * change the class. Nothing is written back to the sources.
 */
export default function SourcesView({ generate, onStop, ready, onBack, onHandover, onOpenRegistry }: Props) {
  const [source, setSource] = useState<SourceKind>('jira');
  const [query, setQuery] = useState('');
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [find, setFind] = useState('');
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [registry, setRegistry] = useState<RegistryRef[]>([]);
  const [registryNote, setRegistryNote] = useState('');
  const [busy, setBusy] = useState<'' | 'load' | 'cluster'>('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<Record<string, string>>({});

  const meta = SOURCES.find((s) => s.id === source)!;
  const selected = useMemo(() => reqs.filter((r) => checked.has(r.id)), [reqs, checked]);
  const shown = useMemo(() => { const q = find.trim().toLowerCase(); return q ? reqs.filter((r) => `${r.key} ${r.title} ${r.text}`.toLowerCase().includes(q)) : reqs; }, [reqs, find]);

  // What already exists in the registry: the targets an extension can name.
  useEffect(() => {
    const api = hostApi();
    if (!api) { setRegistryNote('Without the desktop app and the shared database there is no registry: extensions cannot name an existing agent or workflow.'); return; }
    loadRegistry(api).then((items) => setRegistry(targetsOf(items))).catch((e) => setRegistryNote(`The registry could not be read: ${msg(e)}`));
  }, []);

  const ask = async (prompt: string, title: string): Promise<string | null> => {
    try { const text = await generate(prompt, title, SESSION); if (!text) { setNote('Stopped.'); return null; } return text; } catch (e) { setNote(msg(e)); return null; }
  };

  const load = async () => {
    if (!query.trim()) { setNote(`Say where to read from: ${meta.query.toLowerCase()}.`); return; }
    setBusy('load'); setNote('');
    const text = await ask(fetchPrompt(source, query), `Requirements from ${meta.label}`);
    setBusy('');
    if (text === null) return;
    const got = parseRequirements(text, source);
    if (!got) { setNote('The answer could not be read. Try again, or narrow the search.'); return; }
    setReqs((cur) => mergeRequirements(cur, got.items));
    setNote(got.items.length ? `${got.items.length} requirement${got.items.length > 1 ? 's' : ''} read from ${meta.label}.${got.error ? ` ${got.error}` : ''}` : got.error || 'Nothing was found.');
  };

  const toggle = (id: string) => setChecked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const cluster = async () => {
    setBusy('cluster'); setNote(''); setDone({});
    const others = reqs.filter((r) => !checked.has(r.id));
    const text = await ask(clusterPrompt(selected, others, registry), `Cluster ${selected.length} requirements`);
    setBusy('');
    if (text === null) return;
    const got = parseClusters(text, selected, others, registry);
    if (!got) { setNote('The answer could not be read as clusters. Try again.'); return; }
    setClusters(got.clusters); setWarnings(got.warnings);
  };

  const update = (id: string, f: (c: Cluster) => Cluster) => setClusters((cur) => cur && cur.map((c) => (c.id === id ? f(c) : c)));

  /** Hand-over with a note on Jira: `pending` is the cluster whose note the person is looking at. */
  const [pending, setPending] = useState<{ id: string; comment: string; picked: string[]; step: 'review' | 'writing' | 'failed'; results?: WriteResult[]; problem?: string } | null>(null);

  const handOverNow = async (c: Cluster) => {
    setNote('');
    try { const line = await onHandover(handover(c, reqs)); if (line) setDone((d) => ({ ...d, [c.id]: line })); } catch (e) { setNote(msg(e)); }
  };
  const give = async (c: Cluster, withNote: boolean) => {
    const h = handover(c, reqs);
    if (withNote && handoverTickets(h).length > 0) { setPending({ id: c.id, comment: handoverComment(h), picked: handoverTickets(h).map((t) => t.key), step: 'review' }); return; }
    await handOverNow(c);
  };
  /** Writes the note first; hands over only when every picked ticket is noted. A failure keeps the person here with the choice to go on. */
  const writeThenGive = async (c: Cluster) => {
    if (!pending) return;
    const h = handover(c, reqs);
    setPending({ ...pending, step: 'writing', problem: undefined });
    try {
      const text = await generate(writebackPrompt(pending.picked, handoverLabels(h), pending.comment), 'Note on Jira', 'jira-writeback');
      if (!text) { setPending({ ...pending, step: 'failed', problem: 'Stopped. Some tickets may already be noted; a second try skips those.' }); return; }
      const got = parseWriteback(text, pending.picked);
      if (!got) { setPending({ ...pending, step: 'failed', problem: 'The answer could not be read. Check the tickets in Jira before you try again.' }); return; }
      if (got.every(isDone)) { setPending(null); await handOverNow(c); setNote(`${summaryOf(got)} Handed over.`); return; }
      setPending({ ...pending, step: 'failed', results: got, picked: got.filter((r) => !isDone(r)).map((r) => r.key) });
    } catch (e) { setPending({ ...pending, step: 'failed', problem: msg(e) }); }
  };

  return (
    <main className="sh sx">
      <header className="sh-head">
        <button className="sh-back" onClick={clusters ? () => { setClusters(null); setNote(''); } : onBack} aria-label="Back">←</button>
        <div>
          <h1>Start from requirements</h1>
          <p>{clusters ? `${clusters.length} cluster${clusters.length === 1 ? '' : 's'} from ${selected.length} requirements` : 'Read them from Jira, Slack or Notion, tick the ones that belong together, then let Joule cluster and classify them.'}</p>
        </div>
      </header>
      <ol className="sx-steps" aria-label="Steps">
        {['Source', 'Select', 'Cluster', 'Hand over'].map((s, i) => {
          const at = clusters ? (Object.keys(done).length ? 3 : 2) : selected.length ? 1 : 0;
          return <li key={s} className={i === at ? 'sx-step-on' : i < at ? 'sx-step-done' : ''}><span>{i + 1}</span>{s}</li>;
        })}
      </ol>
      {!ready && <p className="sx-hint">The agent is not connected yet. Reading and clustering need it.</p>}

      {!clusters ? (
        <>
          <section className="sh-card sx-source">
            <div className="sx-tabs" role="tablist" aria-label="Source">
              {SOURCES.map((s) => <button key={s.id} role="tab" aria-selected={source === s.id} className={source === s.id ? 'sx-tab-on' : ''} onClick={() => setSource(s.id)}>{s.label}</button>)}
            </div>
            <label className="sx-q">{meta.query}
              <span className="sx-qrow">
                <input value={query} placeholder={meta.placeholder} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) void load(); }} />
                {busy === 'load' ? <button onClick={onStop}>Stop</button> : <button className="sh-primary" onClick={() => void load()} disabled={!ready || Boolean(busy)}>Load requirements</button>}
              </span>
            </label>
            <small className="sh-note">{meta.help} Read only: nothing is changed in {meta.label}.</small>
          </section>

          {reqs.length > 0 && (
            <section className="sh-card sx-list">
              <div className="sx-listhead">
                <h2>Requirements <small>{checked.size} of {reqs.length} ticked</small></h2>
                <input type="search" aria-label="Filter the list" placeholder="Filter" value={find} onChange={(e) => setFind(e.target.value)} />
                <button onClick={() => setChecked(new Set([...checked, ...shown.map((r) => r.id)].slice(0, MAX_ITEMS)))}>Tick shown</button>
                <button onClick={() => setChecked(new Set())} disabled={checked.size === 0}>Clear</button>
              </div>
              <ul className="sx-reqs">
                {shown.map((r) => (
                  <li key={r.id}>
                    <label>
                      <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} />
                      <span className="sx-key">{r.key}</span>
                      <span className="sx-rtext"><b>{r.title}</b>{r.text && r.text !== r.title && <small>{r.text}</small>}
                        <small className="sx-meta">{SOURCES.find((s) => s.id === r.source)?.label}{r.author ? ` · ${r.author}` : ''}{r.date ? ` · ${r.date}` : ''}{r.mentions && r.mentions > 1 ? ` · ${r.mentions} mentions` : ''}{r.url && <> · <a href={r.url} target="_blank" rel="noreferrer">open</a></>}</small></span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="sh-bulk">
                {busy === 'cluster' ? <button onClick={onStop}>Stop</button> : <button className="sh-primary" onClick={() => void cluster()} disabled={!ready || Boolean(busy) || selected.length === 0 || selected.length > MAX_ITEMS}>Cluster {selected.length || ''} requirement{selected.length === 1 ? '' : 's'}</button>}
                <span className="sh-note">{selected.length > MAX_ITEMS ? `At most ${MAX_ITEMS} at a time.` : 'Requirements you do not tick are still checked: Joule says if one belongs to a cluster.'}</span>
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          {warnings.length > 0 && <ul className="sx-warn" role="status">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {registryNote && <p className="sx-hint">{registryNote}</p>}
          <div className="sx-clusters">
            {clusters.map((c) => (
              <ClusterCard key={c.id} c={c} reqs={reqs} clusters={clusters} registry={registry} done={done[c.id]}
                onTitle={(t) => update(c.id, (x) => ({ ...x, title: t.slice(0, 100) }))}
                onClass={(cls) => update(c.id, (x) => overrideClass(x, cls, registry))}
                onTarget={(t) => update(c.id, (x) => setTarget(x, t))}
                onMove={(reqId, to) => setClusters((cur) => cur && moveRequirement(cur, reqId, to))}
                onDismiss={(reqId) => setClusters((cur) => cur && dismissSuggestion(cur, c.id, reqId))}
                onGive={(withNote) => void give(c, withNote)}
                pending={pending?.id === c.id ? pending : null} ready={ready} onStop={onStop}
                onComment={(t) => setPending((p) => (p ? { ...p, comment: t } : p))}
                onPick={(k) => setPending((p) => (p ? { ...p, picked: p.picked.includes(k) ? p.picked.filter((x) => x !== k) : [...p.picked, k] } : p))}
                onCancel={() => setPending(null)}
                onWrite={() => void writeThenGive(c)}
                onSkip={() => { setPending(null); void handOverNow(c); }} />
            ))}
          </div>
          {Object.keys(done).length > 0 && <p className="sh-note"><button onClick={onOpenRegistry}>Open the registry</button> to see what was created and its history.</p>}
        </>
      )}
      {note && <p className="sh-note sx-note" role="status">{note}</p>}
    </main>
  );
}

type Pending = { id: string; comment: string; picked: string[]; step: 'review' | 'writing' | 'failed'; results?: WriteResult[]; problem?: string };

function ClusterCard({ c, reqs, clusters, registry, done, onTitle, onClass, onTarget, onMove, onDismiss, onGive, pending, ready, onStop, onComment, onPick, onCancel, onWrite, onSkip }: {
  c: Cluster; reqs: Requirement[]; clusters: Cluster[]; registry: RegistryRef[]; done?: string;
  onTitle: (t: string) => void; onClass: (cls: ReqClass) => void; onTarget: (t: { id: string; name: string } | null) => void;
  onMove: (reqId: string, to: string) => void; onDismiss: (reqId: string) => void; onGive: (withNote: boolean) => void;
  pending: Pending | null; ready: boolean; onStop: () => void; onComment: (t: string) => void; onPick: (key: string) => void; onCancel: () => void; onWrite: () => void; onSkip: () => void;
}) {
  const byId = (id: string) => reqs.find((r) => r.id === id);
  const targets = registry.filter((r) => r.kind === classBase(c.cls));
  const pct = Math.round(c.confidence * 100);
  const h = useMemo(() => handover(c, reqs), [c, reqs]);
  const tickets = handoverTickets(h);
  const signal = useMemo(() => signalOf(c, reqs), [c, reqs]);
  const [wantNote, setWantNote] = useState(false);
  const valid = pending ? pending.comment.startsWith(handoverMarker(h)) && pending.comment.length <= 2000 : false;
  const inPlace = Boolean(isExtension(c.cls) && c.target && localTarget(loadMap(window.localStorage), c.target.id));
  return (
    <article className="sh-card sx-cluster" aria-label={c.title}>
      <div className="sx-chead">
        <input className="sx-title" value={c.title} aria-label="Cluster title" onChange={(e) => onTitle(e.target.value)} />
        <span className={`sx-class sx-class-${classBase(c.cls)}`}>{CLASS_LABEL[c.cls]}</span>
      </div>
      {c.summary && <p className="sx-summary">{c.summary}</p>}
      {signalLine(signal) && (
        <div className="sx-signal">
          <b>{signalLine(signal)}</b>
          <small> counted by the agent from what it read; check the quotes</small>
          {signal.evidence.length > 0 && (
            <details>
              <summary>Show what was said</summary>
              <ul>{signal.evidence.map((e, i) => <li key={i}><span className="sx-key">{e.key}</span> “{e.quote}”{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer">open</a></>}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      <ul className="sx-members">
        {c.reqIds.map((id) => {
          const r = byId(id);
          return (
            <li key={id}>
              <span className="sx-key">{r?.key ?? id}</span><span className="sx-mt">{r?.title ?? id}</span>
              {clusters.length > 1 && (
                <select aria-label={`Move ${r?.key ?? id}`} value="" onChange={(e) => { if (e.target.value) onMove(id, e.target.value); }}>
                  <option value="">Move…</option>
                  {clusters.filter((o) => o.id !== c.id).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
              )}
            </li>
          );
        })}
      </ul>

      {c.suggestions.length > 0 && (
        <div className="sx-sugg">
          <b>Also consider</b>
          {c.suggestions.map((s) => {
            const r = byId(s.reqId);
            return (
              <div key={s.reqId} className="sx-sugg-row">
                <span><span className="sx-key">{r?.key ?? s.reqId}</span> {r?.title}{s.reason && <small>{s.reason}</small>}</span>
                <button onClick={() => onMove(s.reqId, c.id)}>Add</button>
                <button onClick={() => onDismiss(s.reqId)}>Not this one</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="sx-classify">
        <label>Class
          <select value={c.cls} onChange={(e) => onClass(e.target.value as ReqClass)}>
            {CLASSES.map((k) => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}
          </select>
        </label>
        {isExtension(c.cls) && (
          <label>Extends
            <select value={c.target?.id ?? ''} onChange={(e) => { const t = targets.find((x) => x.id === e.target.value); onTarget(t ? { id: t.id, name: t.name } : null); }}>
              <option value="">Choose…</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <div className="sx-conf" title="How sure Joule is of the class"><span>Confidence {pct} %</span><i><b style={{ width: `${pct}%` }} /></i></div>
      </div>
      <small className="sh-note">{CLASS_RULE[c.cls]}</small>
      {c.warning && <p className="sx-cwarn" role="alert">{c.warning}</p>}
      {isExtension(c.cls) && c.target && (
        <small className="sh-note">{inPlace
          ? `"${c.target.name}" is on this computer: the requirements are added to it, and the next save is a new revision of the same registry entry. What was approved there has to be approved again.`
          : `"${c.target.name}" is not on this computer (yet). A new project linked to it is started; it does not change the existing revision.`}</small>
      )}
      <pre className="sx-comment" aria-label="Comment">{commentOf(c)}</pre>

      {tickets.length > 0 && !done && !pending && (
        <label className="sx-note-opt">
          <input type="checkbox" checked={wantNote} onChange={(e) => setWantNote(e.target.checked)} />
          Also note it on the {tickets.length} Jira ticket{tickets.length === 1 ? '' : 's'} ({tickets.slice(0, 4).map((t) => t.key).join(', ')}{tickets.length > 4 ? ', …' : ''}). You see the text first.
        </label>
      )}
      {pending && (
        <div className="rg-jira-confirm" role="group" aria-label="Note on Jira">
          <p className="sx-cwarn" role="alert">This changes Jira. Label {handoverLabels(h).join(', ')} and this comment are added to the ticket{pending.picked.length === 1 ? '' : 's'} {pending.picked.join(', ') || '(none ticked)'}. Nothing else is touched. The hand-over follows when it worked.</p>
          {pending.step === 'review' && (
            <div className="rg-jira-tickets">{tickets.map((t) => <label key={t.key}><input type="checkbox" checked={pending.picked.includes(t.key)} onChange={() => onPick(t.key)} />{t.key}</label>)}</div>
          )}
          <textarea aria-label="Comment for Jira" rows={5} value={pending.comment} disabled={pending.step === 'writing'} onChange={(e) => onComment(e.target.value)} />
          {!valid && <small className="sx-cwarn">The comment has to start with {handoverMarker(h)} (it tells a repeat that the ticket was noted already) and stay under 2000 characters.</small>}
          {pending.results && <ul className="rg-jira-results">{pending.results.map((r) => <li key={r.key}><b>{r.key}</b> {isDone(r) ? 'noted' : 'not done'}{r.skipped ? ` · ${r.skipped}` : ''}{r.error ? ` · ${r.error}` : ''}</li>)}</ul>}
          {pending.problem && <p className="rg-error" role="alert">{pending.problem}</p>}
          <div className="sh-bulk">
            {pending.step === 'writing'
              ? <><button onClick={onStop}>Stop</button><span className="sh-note">Writing…</span></>
              : <>
                  <button className="sh-primary" onClick={onWrite} disabled={!ready || !valid || pending.picked.length === 0}>{pending.step === 'failed' ? 'Try again' : 'Write to Jira, then hand over'}</button>
                  <button onClick={onSkip}>{pending.step === 'failed' ? 'Hand over anyway' : 'Hand over without the note'}</button>
                  <button onClick={onCancel}>Cancel</button>
                </>}
          </div>
        </div>
      )}
      <div className="sh-bulk">
        <button className="sh-primary" onClick={() => onGive(wantNote)} disabled={!CAN_HAND_OVER(c) || Boolean(done) || Boolean(pending)}>{done ? 'Handed over ✓' : inPlace ? `Extend "${c.target!.name.slice(0, 40)}"` : ACTION[c.cls]}</button>
        {done && <span className="sh-note">{done}</span>}
      </div>
    </article>
  );
}
