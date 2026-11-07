import { useState } from 'react';
import {
  CRITICALITY, CRITICALITY_LABEL, DISCOVERY, DISCOVERY_LABEL, PHASES, PHASE_LABEL, REL_KINDS, REL_LABEL, RISK, RISK_LABEL, VERIFICATION, VERIFICATION_LABEL,
  sanitizeCard, type Criticality, type Discovery, type Phase, type RegisterCard, type RelKind, type Relation, type RiskClass, type Verification,
} from '../registry-card';
import { cardNote, cardProblems, emptyCard, markVerified } from '../register-store';
import { saveCard, hostApi, type RItem } from '../registry';

const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 240);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Editor of the register card. Writes the card as a new revision of the item (register.json, see register-store.ts); nothing else of the
 * item changes. A field left empty stays "not declared". The person is only who they type: there is no sign-in yet, so "Verified by"
 * is a free text and not proof of who clicked.
 */
export default function RegistryCardEditor({ item, api, solution, onSaved, onCancel }: { item: RItem; api: NonNullable<ReturnType<typeof hostApi>>; solution: boolean; onSaved: (text: string) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<RegisterCard>(() => item.card ?? emptyCard());
  const [relKind, setRelKind] = useState<RelKind>('capability');
  const [relName, setRelName] = useState('');
  const [relAccess, setRelAccess] = useState<'' | 'read' | 'write'>('');
  const [tagText, setTagText] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof RegisterCard>(k: K, v: RegisterCard[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setDate = (p: Phase, v: string) => setDraft((d) => { const dates = { ...d.dates }; if (v) dates[p] = v; else delete dates[p]; return { ...d, dates }; });
  const addRel = () => {
    const name = relName.trim();
    if (!name) return;
    const rel: Relation = { kind: relKind, name, ...(relKind === 'system' && relAccess ? { access: relAccess } : {}) };
    setDraft((d) => (d.relations.some((r) => r.kind === rel.kind && r.name.toLowerCase() === name.toLowerCase()) ? d : { ...d, relations: [...d.relations, rel] }));
    setRelName('');
  };
  const addTag = () => { const t = tagText.trim(); if (t && !draft.tags.includes(t)) set('tags', [...draft.tags, t]); setTagText(''); };

  const save = async () => {
    const clean = sanitizeCard(draft)!; // the same reader as everywhere: lengths, vocabularies, dates
    const found = cardProblems(clean);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try { const rev = await saveCard(api, item, clean); await onSaved(`${cardNote(item.card, clean)} (revision ${rev}).`); }
    catch (e) { setProblems([msg(e)]); } finally { setBusy(false); }
  };

  return (
    <div className="rg-edit" role="form" aria-label="Edit the register card">
      <label className="rg-edit-wide">Purpose
        <textarea rows={2} maxLength={300} value={draft.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="What is it for, in one or two sentences" />
      </label>

      <h4 className="rg-sub">Ownership</h4>
      <div className="rg-edit-grid">
        <label>Accountable<input value={draft.steward} maxLength={120} onChange={(e) => set('steward', e.target.value)} placeholder="Name or e-mail" /></label>
        <label>Organization<input value={draft.organization} maxLength={80} onChange={(e) => set('organization', e.target.value)} placeholder="Department" /></label>
        <label>Runs on<input value={draft.provider} maxLength={60} onChange={(e) => set('provider', e.target.value)} placeholder="Platform" /></label>
        <label>Origin
          <select value={draft.discovery} onChange={(e) => set('discovery', e.target.value as Discovery)}>{DISCOVERY.map((d) => <option key={d} value={d}>{DISCOVERY_LABEL[d]}</option>)}</select>
        </label>
      </div>
      <p className="sh-note">The responsible person is the owner of the item and is changed where the item is built.</p>

      <h4 className="rg-sub">Lifecycle</h4>
      <div className="rg-edit-grid">
        <label>Phase
          <select value={draft.phase ?? ''} onChange={(e) => set('phase', (e.target.value || null) as Phase | null)}>
            <option value="">Not declared</option>{PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
          </select>
        </label>
        {PHASES.map((p) => <label key={p}>{PHASE_LABEL[p]} on<input type="date" value={draft.dates[p] ?? ''} onChange={(e) => setDate(p, e.target.value)} /></label>)}
      </div>

      {solution && (
        <>
          <h4 className="rg-sub">Governance</h4>
          <div className="rg-edit-grid">
            <label>Business criticality
              <select value={draft.criticality ?? ''} onChange={(e) => set('criticality', (e.target.value || null) as Criticality | null)}>
                <option value="">Not declared</option>{CRITICALITY.map((c) => <option key={c} value={c}>{CRITICALITY_LABEL[c]}</option>)}
              </select>
            </label>
            <label>Verification
              <select value={draft.verification} onChange={(e) => set('verification', e.target.value as Verification)}>{VERIFICATION.map((v) => <option key={v} value={v}>{VERIFICATION_LABEL[v]}</option>)}</select>
            </label>
            <label>Verified by<input value={draft.verifiedBy} maxLength={120} onChange={(e) => set('verifiedBy', e.target.value)} placeholder="Name or e-mail" /></label>
            <label>Verified on<input type="date" value={draft.verifiedAt} onChange={(e) => set('verifiedAt', e.target.value)} /></label>
            <label>Next review<input type="date" value={draft.reviewDue} onChange={(e) => set('reviewDue', e.target.value)} /></label>
            <div className="rg-edit-act">
              <button type="button" onClick={() => setDraft((d) => markVerified(d, d.verifiedBy || d.steward || item.owner, today()))} title="Sets verified, today, and a review in six months">Verified today</button>
            </div>
            <label>Risk class (EU AI Act)
              <select value={draft.risk} onChange={(e) => set('risk', e.target.value as RiskClass)}>{RISK.map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}</select>
            </label>
            <label className="rg-edit-wide">Why this class<input value={draft.riskReason} maxLength={240} onChange={(e) => set('riskReason', e.target.value)} placeholder="A self-assessment, not a legal opinion" /></label>
          </div>
        </>
      )}

      <h4 className="rg-sub">Connections</h4>
      {draft.relations.length > 0 && (
        <p className="rg-edit-chips">
          {draft.relations.map((r) => (
            <span key={`${r.kind}:${r.name}`} className="rg-chip rg-chip-rel">{REL_LABEL[r.kind]}: {r.name}{r.access ? ` (${r.access})` : ''}
              <button type="button" aria-label={`Remove ${r.name}`} onClick={() => set('relations', draft.relations.filter((x) => x !== r))}>✕</button></span>
          ))}
        </p>
      )}
      <div className="rg-frow">
        <label>Kind<select value={relKind} onChange={(e) => setRelKind(e.target.value as RelKind)}>{REL_KINDS.map((k) => <option key={k} value={k}>{REL_LABEL[k]}</option>)}</select></label>
        <label className="rg-grow">Name<input value={relName} maxLength={100} onChange={(e) => setRelName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRel(); } }} placeholder="e.g. Order-to-cash" /></label>
        {relKind === 'system' && <label>Access<select value={relAccess} onChange={(e) => setRelAccess(e.target.value as '' | 'read' | 'write')}><option value="">Not declared</option><option value="read">Reads</option><option value="write">Writes</option></select></label>}
        <button type="button" disabled={!relName.trim()} onClick={addRel}>Add</button>
      </div>

      <h4 className="rg-sub">Tags</h4>
      {draft.tags.length > 0 && <p className="rg-edit-chips">{draft.tags.map((t) => <span key={t} className="rg-chip">{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => set('tags', draft.tags.filter((x) => x !== t))}>✕</button></span>)}</p>}
      <div className="rg-frow">
        <label className="rg-grow">Tag<input value={tagText} maxLength={30} onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} /></label>
        <button type="button" disabled={!tagText.trim()} onClick={addTag}>Add</button>
      </div>

      {problems.length > 0 && <ul className="rg-error" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="rg-frow">
        <button type="button" className="dialog-btn dialog-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save as a new revision'}</button>
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      <p className="sh-note">Saving adds a revision to the history, so the change can be compared and restored. The run numbers of the last 30 days are not edited here.</p>
    </div>
  );
}
