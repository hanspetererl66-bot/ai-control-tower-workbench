import { useCallback, useEffect, useMemo, useState } from 'react';
import HiringCriteria from './HiringCriteria';
import { KIND_LABEL, countByStatus, decisionError, groupByRequisition, readProposals, type Proposal } from '../hiring';

const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Hiring approvals: Joule's recruiting proposals wait here for the hiring manager. A click on Release or Decline is the only way a
 * proposal is decided; the agent has no tool for it, and the database accepts it only from the manager of the requisition.
 * Releasing does not change anything in a recruiting system yet (no SmartRecruiters connection exists).
 */
export default function HiringApprovals({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'proposed' | 'decided' | 'criteria'>('proposed');
  const [all, setAll] = useState<Proposal[]>([]);
  const [note, setNote] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [state, setState] = useState<{ kind: 'loading' | 'ready' | 'offline'; detail: string }>({ kind: 'loading', detail: 'Reading the proposals…' });
  const [error, setError] = useState('');
  const [imp, setImp] = useState('');

  const load = useCallback(async () => {
    const host = window.host;
    if (!host?.recruitingProposals) { setState({ kind: 'offline', detail: 'Available in the desktop app, with the shared database set up.' }); return; }
    setState({ kind: 'loading', detail: 'Reading the proposals…' });
    try {
      const mine: Proposal[] = [];
      for (const status of ['proposed', 'released', 'declined']) {
        const res = await host.recruitingProposals({ status });
        if (!res.ok) { setState({ kind: 'offline', detail: res.error }); return; }
        mine.push(...readProposals(res.data.proposals));
      }
      setAll(mine);
      setState({ kind: 'ready', detail: '' });
    } catch (e) { setState({ kind: 'offline', detail: e instanceof Error ? e.message : String(e) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => countByStatus(all), [all]);
  const shown = useMemo(() => groupByRequisition(all.filter((p) => (tab === 'proposed' ? p.status === 'proposed' : p.status !== 'proposed'))), [all, tab]);

  const decide = async (p: Proposal, decision: 'released' | 'declined') => {
    const host = window.host;
    if (!host?.recruitingDecide) return;
    setBusy(p.id); setError('');
    try {
      const res = await host.recruitingDecide(p.id, decision, (note[p.id] ?? '').trim());
      if (!res.ok) setError(decisionError(res.error));
      await load();
    } finally { setBusy(null); }
  };

  const runImport = async () => {
    const host = window.host;
    if (!host?.recruitingImport) return;
    setBusy(-1); setError(''); setImp('');
    try {
      const res = await host.recruitingImport();
      if (!res.ok) { setError(res.error); return; }
      const d = res.data as Record<string, unknown> & { dropped?: Record<string, number> };
      setImp(`Mock import done: ${d.requisitionsNew ?? 0} new and ${d.requisitionsUpdated ?? 0} updated requisitions, ${d.candidatesNew ?? 0} new and ${d.candidatesUpdated ?? 0} updated candidates; `
        + `${d.dropped?.notInProcess ?? 0} candidates not in the process and ${d.dropped?.personalLines ?? 0} CV lines with personal data were left out.`);
      await load();
    } finally { setBusy(null); }
  };

  return (
    <main className="develop develop-main hr">
      <div className="hr-head">
        <button className="sh-back" onClick={onBack} aria-label="Back">←</button>
        <h1 className="develop-title">Hiring approvals</h1>
      </div>
      <p className="develop-sub">Joule prepares, you decide. A proposal changes nothing for a candidate until the hiring manager of the requisition releases it, and a decision is final.</p>
      <div className="hr-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'proposed'} className={tab === 'proposed' ? 'on' : ''} onClick={() => setTab('proposed')}>Waiting <b>{counts.proposed}</b></button>
        <button role="tab" aria-selected={tab === 'decided'} className={tab === 'decided' ? 'on' : ''} onClick={() => setTab('decided')}>Decided <b>{counts.released + counts.declined}</b></button>
        <button role="tab" aria-selected={tab === 'criteria'} className={tab === 'criteria' ? 'on' : ''} onClick={() => setTab('criteria')}>Criteria</button>
        <button className="hr-reload" onClick={() => void load()}>Reload</button>
      </div>
      {tab === 'criteria' ? <HiringCriteria /> : <>
      <div className="hr-source">
        <span className="hr-tag">Source: SmartRecruiters (mock)</span>
        <button className="dialog-btn" disabled={busy === -1 || !window.host?.recruitingImport} onClick={() => void runImport()}>Import from the mock</button>
        <span className="hr-basis">A made-up SmartRecruiters answer with invented people. Names, e-mail and phone numbers are removed before anything is saved. No real connection exists.</span>
      </div>
      {imp && <p className="hr-note" role="status">{imp}</p>}
      {state.kind !== 'ready' && <p className="hr-note" role="status">{state.detail}</p>}
      {error && <p className="hr-error" role="alert">{error}</p>}
      {state.kind === 'ready' && shown.length === 0 && <p className="hr-note">{tab === 'proposed' ? 'Nothing is waiting. Ask Joule in the chat, for example for the shortlist of a requisition.' : 'No decisions yet.'}</p>}
      {shown.map((g) => (
        <section key={g.requisition} className="hr-group" aria-label={g.requisition}>
          <h2>{g.requisition}</h2>
          {g.items.map((p) => (
            <article key={p.id} className="hr-card">
              <div className="hr-line">
                <b className="hr-cand">{p.candidate}</b>
                <span className="hr-tag">{KIND_LABEL[p.kind]}</span>
                {p.status !== 'proposed' && <span className={`hr-tag ${p.status === 'released' ? 'ok' : ''}`}>{p.status === 'released' ? 'Released' : 'Declined'}</span>}
              </div>
              <p>{p.text}</p>
              {p.basis && <p className="hr-basis">Basis: {p.basis}</p>}
              {p.status === 'proposed' ? (
                <div className="hr-actions">
                  <input value={note[p.id] ?? ''} maxLength={300} onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} placeholder="Note (optional)" aria-label={`Note for ${p.candidate}`} />
                  <button className="dialog-btn dialog-btn-primary" disabled={busy === p.id} onClick={() => void decide(p, 'released')}>Release</button>
                  <button className="dialog-btn" disabled={busy === p.id} onClick={() => void decide(p, 'declined')}>Decline</button>
                </div>
              ) : (
                <p className="hr-basis">{p.status === 'released' ? 'Released' : 'Declined'} by {p.decidedBy} on {fmt(p.decidedAt ?? '')}{p.note ? `: ${p.note}` : ''}. Nothing was changed in a recruiting system: that connection is not built.</p>
              )}
              <p className="hr-basis">Proposed by {p.proposedBy} on {fmt(p.at)}</p>
            </article>
          ))}
        </section>
      ))}
      </>}
    </main>
  );
}
