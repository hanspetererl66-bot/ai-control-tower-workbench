import { useCallback, useEffect, useMemo, useState } from 'react';
import { STATUS_LABEL, countPostings, openChannels, postingError, readPostings, sortPostings, type Channel, type Posting } from '../hiring-postings';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Job postings of the requisitions you manage. Joule writes drafts and sends them to you; releasing, publishing and withdrawing are
 * clicks here and nowhere else (the agent has no tool for them, and the database accepts them only from the hiring manager).
 * Publishing is a SIMULATION: no channel is connected, nothing leaves the computer.
 */
export default function HiringPostings() {
  const [rows, setRows] = useState<Posting[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [pick, setPick] = useState<Record<number, string[]>>({});
  const [note, setNote] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [state, setState] = useState('Reading your postings…');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    const host = window.host;
    if (!host?.recruitingPostings) { setState('Available in the desktop app, with the shared database set up.'); return; }
    const res = await host.recruitingPostings({});
    if (!res.ok) { setState(res.error); return; }
    const d = readPostings(res.data);
    setRows(sortPostings(d.postings)); setChannels(d.channels);
    setState(d.postings.length ? '' : 'No postings yet. Ask Joule in the chat to draft one for an open requisition, or use the Job posting tab in the Recruiting Workbench.');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => countPostings(rows), [rows]);

  const step = async (p: Posting, action: 'release' | 'send_back' | 'withdraw') => {
    const host = window.host;
    if (!host?.recruitingPostingStep) return;
    const text = (note[p.id] ?? '').trim();
    if (action === 'withdraw' && !text) { setError('Give a reason to withdraw a posting.'); return; }
    setBusy(p.id); setError(''); setDone('');
    try {
      const res = await host.recruitingPostingStep(action, p.id, text);
      if (!res.ok) setError(postingError(res.error)); else setDone(action === 'release' ? 'Released. It is not public yet: publish it to the channels you choose.' : action === 'send_back' ? 'Sent back as a draft.' : 'Withdrawn.');
      await load();
    } finally { setBusy(null); }
  };

  const publish = async (p: Posting) => {
    const host = window.host;
    const chosen = pick[p.id] ?? [];
    if (!host?.recruitingPostingPublish || !chosen.length) return;
    setBusy(p.id); setError(''); setDone('');
    try {
      const res = await host.recruitingPostingPublish(p.id, chosen);
      if (!res.ok) setError(postingError(res.error)); else setDone(`Simulated on ${chosen.length} channel${chosen.length === 1 ? '' : 's'}. Nothing was sent: no channel is connected.`);
      await load();
    } finally { setBusy(null); }
  };

  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? id;

  return (
    <>
      <p className="hr-note">Waiting for you <b>{counts.in_review}</b> · Released <b>{counts.released}</b> · Drafts <b>{counts.draft}</b> · Withdrawn <b>{counts.withdrawn}</b>
        <button className="hr-reload" onClick={() => void load()}>Reload</button></p>
      {state && <p className="hr-note" role="status">{state}</p>}
      {error && <p className="hr-error" role="alert">{error}</p>}
      {done && <p className="hr-note" role="status">{done}</p>}
      {rows.map((p) => (
        <article key={p.id} className="hr-card">
          <div className="hr-line">
            <b className="hr-cand">{p.title}</b>
            <span className="hr-tag">{p.requisition}</span>
            <span className={`hr-tag ${p.status === 'released' ? 'ok' : ''}`}>{STATUS_LABEL[p.status]}</span>
            <button className="hr-reload" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>{open === p.id ? 'Hide text' : 'Read the text'}</button>
          </div>
          {open === p.id && p.sections.map((s) => (
            <div key={s.key}><p className="hr-basis"><b>{s.label}</b>{s.locked ? ' (company text, locked)' : ''}</p><p style={{ whiteSpace: 'pre-wrap' }}>{s.text}</p></div>
          ))}
          {p.status === 'in_review' && (
            <div className="hr-actions">
              <input value={note[p.id] ?? ''} maxLength={300} onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} placeholder="Note (optional)" aria-label={`Note for ${p.title}`} />
              <button className="dialog-btn dialog-btn-primary" disabled={busy === p.id} onClick={() => void step(p, 'release')}>Release</button>
              <button className="dialog-btn" disabled={busy === p.id} onClick={() => void step(p, 'send_back')}>Send back</button>
            </div>
          )}
          {p.status === 'released' && (
            <>
              {p.publications.length > 0 && <p className="hr-basis">Simulated on: {p.publications.map((b) => channelName(b.channel)).join(', ')}. Nothing was sent.</p>}
              {openChannels(p, channels).length > 0 && (
                <div className="hr-actions">
                  {openChannels(p, channels).map((c) => (
                    <label key={c.id} className="hr-basis"><input type="checkbox" checked={(pick[p.id] ?? []).includes(c.id)}
                      onChange={(e) => setPick({ ...pick, [p.id]: e.target.checked ? [...(pick[p.id] ?? []), c.id] : (pick[p.id] ?? []).filter((x) => x !== c.id) })} /> {c.name}</label>
                  ))}
                  <button className="dialog-btn dialog-btn-primary" disabled={busy === p.id || !(pick[p.id] ?? []).length} onClick={() => void publish(p)}>Publish (simulated)</button>
                </div>
              )}
              <div className="hr-actions">
                <input value={note[p.id] ?? ''} maxLength={300} onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} placeholder="Reason to withdraw" aria-label={`Reason to withdraw ${p.title}`} />
                <button className="dialog-btn" disabled={busy === p.id} onClick={() => void step(p, 'withdraw')}>Withdraw</button>
              </div>
            </>
          )}
          <p className="hr-basis">{p.releasedBy ? `Released by ${p.releasedBy} on ${fmt(p.releasedAt)}. ` : ''}Written by {p.createdBy}, last change {fmt(p.updatedAt)}.</p>
        </article>
      ))}
    </>
  );
}
