import { useCallback, useEffect, useState } from 'react';
import { criterionError, parseNeedles, readMyRequisitions, validateCriterion, type Criterion, type CriterionDraft, type MyRequisition } from '../hiring';

const EMPTY: CriterionDraft = { label: '', kind: 'text', minYears: '3', needles: '', partial: '' };

/**
 * Criteria of an open requisition. Only its hiring manager can change them (the database checks this); every change is logged.
 * Joule compares CV text against exactly these criteria. Proposals made earlier keep the criteria they were based on.
 */
export default function HiringCriteria() {
  const [reqs, setReqs] = useState<MyRequisition[]>([]);
  const [sel, setSel] = useState('');
  const [status, setStatus] = useState('Reading your requisitions…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string | null; must: boolean; draft: CriterionDraft } | null>(null);

  const load = useCallback(async () => {
    const host = window.host;
    if (!host?.recruitingCriteria) { setStatus('Available in the desktop app, with the shared database set up.'); return; }
    const res = await host.recruitingCriteria();
    if (!res.ok) { setStatus(res.error); return; }
    const rows = readMyRequisitions(res.data);
    setReqs(rows);
    setSel((cur) => (rows.some((r) => r.id === cur) ? cur : rows[0]?.id ?? ''));
    setStatus(rows.length ? '' : 'You are not the hiring manager of an open requisition. Import from the mock or ask an admin to assign one.');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const req = reqs.find((r) => r.id === sel);
  const open = (must: boolean, c?: Criterion) => {
    setError('');
    setEdit({ id: c?.id ?? null, must, draft: c
      ? { label: c.text, kind: c.kind, minYears: String(c.min ?? 3), needles: c.needles.join(', '), partial: c.partial.join(', ') } : EMPTY });
  };

  const save = async () => {
    const host = window.host;
    if (!host?.recruitingCriterionSet || !req || !edit) return;
    const d = edit.draft;
    const problem = validateCriterion(d, edit.id ? 0 : req.criteria.length);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      const res = await host.recruitingCriterionSet({
        requisition: req.id, id: edit.id, must: edit.must, label: d.label.trim(), kind: d.kind,
        minYears: d.kind === 'years' ? Number(d.minYears) : null, needles: d.kind === 'years' ? [] : parseNeedles(d.needles), partial: d.kind === 'years' ? [] : parseNeedles(d.partial),
      });
      if (!res.ok) { setError(criterionError(res.error)); return; }
      setEdit(null); await load();
    } finally { setBusy(false); }
  };

  const remove = async (c: Criterion) => {
    const host = window.host;
    if (!host?.recruitingCriterionDelete || !req) return;
    setBusy(true); setError('');
    try {
      const res = await host.recruitingCriterionDelete(req.id, c.id);
      if (!res.ok) setError(criterionError(res.error));
      await load();
    } finally { setBusy(false); }
  };

  const group = (must: boolean) => (req?.criteria ?? []).filter((c) => c.must === must);
  const list = (must: boolean, title: string) => (
    <section className="hr-group" aria-label={title}>
      <h2>{title}</h2>
      {group(must).length === 0 && <p className="hr-note">None yet.</p>}
      {group(must).map((c) => (
        <article key={c.id} className="hr-card">
          <div className="hr-line"><b className="hr-cand">{c.text}</b><span className="hr-tag">{c.kind === 'years' ? `At least ${c.min} years` : 'Text in the CV'}</span></div>
          {c.kind === 'text' && <p className="hr-basis">Looks for: {c.needles.join(', ')}{c.partial.length ? `. Partly met by: ${c.partial.join(', ')}` : ''}</p>}
          <div className="hr-actions">
            <button className="dialog-btn" disabled={busy} onClick={() => open(c.must, c)}>Edit</button>
            <button className="dialog-btn" disabled={busy} onClick={() => void remove(c)}>Delete</button>
          </div>
        </article>
      ))}
      <button className="dialog-btn" disabled={busy || !req || req.criteria.length >= 12} onClick={() => open(must)}>{must ? 'Add a must-have' : 'Add a nice-to-have'}</button>
    </section>
  );

  return (
    <div className="hr-criteria">
      <p className="hr-basis">Joule compares the CV text with these criteria and shows the line it used. It never rejects anyone and nothing about a person is scored. Earlier proposals keep the criteria they were based on. Criteria must not refer to age, gender, nationality, religion, family status or health.</p>
      {status && <p className="hr-note" role="status">{status}</p>}
      {reqs.length > 0 && (
        <label className="hr-basis">Requisition{' '}
          <select value={sel} onChange={(e) => { setSel(e.target.value); setEdit(null); setError(''); }}>
            {reqs.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.title}</option>)}
          </select>
        </label>
      )}
      {error && <p className="hr-error" role="alert">{error}</p>}
      {req && !edit && <>{list(true, 'Must-haves')}{list(false, 'Nice-to-haves')}</>}
      {req && edit && (
        <section className="hr-card" aria-label="Criterion">
          <h2>{edit.id ? `Edit ${edit.id}` : edit.must ? 'New must-have' : 'New nice-to-have'}</h2>
          <label className="hr-basis">Description
            <input value={edit.draft.label} maxLength={120} onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, label: e.target.value } })} />
          </label>
          <label className="hr-basis">Type{' '}
            <select value={edit.draft.kind} onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, kind: e.target.value as 'text' | 'years' } })}>
              <option value="text">Words or phrases in the CV</option>
              <option value="years">Minimum years of experience</option>
            </select>
          </label>
          {edit.draft.kind === 'years' ? (
            <label className="hr-basis">Minimum years
              <input inputMode="numeric" value={edit.draft.minYears} onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, minYears: e.target.value } })} />
            </label>
          ) : (<>
            <label className="hr-basis">Look for (separate with commas)
              <input value={edit.draft.needles} onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, needles: e.target.value } })} />
            </label>
            <label className="hr-basis">Partly met by (optional)
              <input value={edit.draft.partial} onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, partial: e.target.value } })} />
            </label>
          </>)}
          <div className="hr-actions">
            <button className="dialog-btn dialog-btn-primary" disabled={busy} onClick={() => void save()}>Save</button>
            <button className="dialog-btn" disabled={busy} onClick={() => { setEdit(null); setError(''); }}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}
