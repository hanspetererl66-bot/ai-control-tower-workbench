import { useEffect, useState, type ReactNode } from 'react';
import type { Skill } from '../skills';
import { CHECKS, decide, demote, levelOf, loadGov, pendingFor, renameLevel, requestPromotion, saveGov, type LevelIndex, type SkillGov } from '../skill-governance';

type Tab = LevelIndex | 'approvals';

/**
 * Skills grouped by organisation level (three, with names the person chooses) plus the approval queue
 * that moves a skill one level up. `renderRow` draws the skill itself; this adds the level controls.
 */
export default function SkillGovernance({ skills, renderRow }: { skills: Skill[]; renderRow: (skill: Skill, extra: ReactNode) => ReactNode }) {
  const [gov, setGov] = useState<SkillGov>(() => loadGov());
  const [tab, setTab] = useState<Tab>(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[]>(CHECKS.map(() => false));
  const [note, setNote] = useState('');
  const [reasons, setReasons] = useState<Record<number, string>>({});

  useEffect(() => saveGov(gov), [gov]);
  const change = (fn: (g: SkillGov) => SkillGov) => setGov((g) => fn(g));
  const pending = gov.requests.filter((r) => r.status === 'pending');
  const count = (i: LevelIndex) => skills.filter((s) => levelOf(gov, s.name) === i).length;
  const levels: LevelIndex[] = [0, 1, 2];

  const startEdit = () => { setDraft([...gov.levels]); setEditing(true); };
  const saveEdit = () => {
    change((g) => levels.reduce((acc, i) => renameLevel(acc, i, draft[i] ?? acc.levels[i]), g));
    setEditing(false);
  };

  return (
    <div className="sgov">
      <div className="sgov-tabs" role="tablist">
        {levels.map((i) => (
          <button key={i} role="tab" aria-selected={tab === i} className={`sgov-tab ${tab === i ? 'on' : ''}`} onClick={() => setTab(i)}>
            {gov.levels[i]} <span className="sgov-n">{count(i)}</span>
          </button>
        ))}
        <button role="tab" aria-selected={tab === 'approvals'} className={`sgov-tab ${tab === 'approvals' ? 'on' : ''}`} onClick={() => setTab('approvals')}>
          Approvals {pending.length > 0 && <span className="sgov-n sgov-n-hot">{pending.length}</span>}
        </button>
        <button className="sgov-edit" onClick={editing ? () => setEditing(false) : startEdit}>{editing ? 'Cancel' : 'Rename levels'}</button>
      </div>

      {editing && (
        <div className="sgov-rename">
          <p className="sgov-help">Name your three levels, lowest to highest. A skill moves up one level at a time, after approval.</p>
          <div className="sgov-fields">
            {levels.map((i) => (
              <label key={i}>
                <span>Level {i + 1}</span>
                <input value={draft[i] ?? ''} maxLength={40} onChange={(e) => setDraft((d) => d.map((v, k) => (k === i ? e.target.value : v)))} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }} />
              </label>
            ))}
          </div>
          <button className="dialog-btn" onClick={saveEdit}>Save names</button>
        </div>
      )}

      {tab !== 'approvals' && (
        <>
          {skills.filter((s) => levelOf(gov, s.name) === tab).length === 0 && <p className="manage-empty">No skills on this level yet.</p>}
          {skills.filter((s) => levelOf(gov, s.name) === tab).map((s) => {
            const lvl = levelOf(gov, s.name), req = pendingFor(gov, s.name);
            const extra = (
              <div className="sgov-extra">
                {req && <span className="sgov-badge sgov-badge-wait">In review for {gov.levels[req.to]}</span>}
                {!req && lvl < 2 && asking !== s.name && (
                  <button className="dialog-btn" onClick={() => { setAsking(s.name); setChecked(CHECKS.map(() => false)); setNote(''); }}>
                    Move up to {gov.levels[(lvl + 1) as LevelIndex]}
                  </button>
                )}
                {!req && lvl === 2 && <span className="sgov-badge sgov-badge-ok">Top level</span>}
                {lvl > 0 && !req && <button className="dialog-btn" onClick={() => change((g) => demote(g, s.name))}>Move down</button>}
              </div>
            );
            return (
              <div key={s.dir}>
                {renderRow(s, extra)}
                {asking === s.name && lvl < 2 && (
                  <div className="sgov-form">
                    <strong>Request: {gov.levels[lvl]} → {gov.levels[(lvl + 1) as LevelIndex]}</strong>
                    {CHECKS.map((c, k) => (
                      <label key={c} className="sgov-check"><input type="checkbox" checked={checked[k]} onChange={() => setChecked((cs) => cs.map((v, j) => (j === k ? !v : v)))} />{c}</label>
                    ))}
                    <textarea placeholder="Why should this skill move up? Who will use it?" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
                    <div className="sgov-actions">
                      <button className="dialog-btn" disabled={!checked.every(Boolean)} onClick={() => { change((g) => requestPromotion(g, s.name, note, Date.now())); setAsking(null); }}>Submit for approval</button>
                      <button className="dialog-btn" onClick={() => setAsking(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {tab === 'approvals' && (
        <div className="sgov-queue">
          {gov.requests.length === 0 && <p className="manage-empty">No requests yet. Use “Move up” on a skill.</p>}
          {gov.requests.map((r) => (
            <div key={r.id} className="sgov-req">
              <div className="sgov-req-head">
                <strong>{r.skill}</strong>
                <span>{gov.levels[r.from]} → {gov.levels[r.to]}</span>
                <span className={`sgov-badge ${r.status === 'approved' ? 'sgov-badge-ok' : r.status === 'rejected' ? 'sgov-badge-no' : 'sgov-badge-wait'}`}>{r.status === 'pending' ? 'Pending' : r.status === 'approved' ? 'Approved' : 'Rejected'}</span>
              </div>
              {r.note && <p className="row-detail">{r.note}</p>}
              <p className="row-detail">Requested {new Date(r.createdAt).toLocaleString()}{r.decidedAt ? ` · decided ${new Date(r.decidedAt).toLocaleString()}` : ''}{r.reason ? ` · “${r.reason}”` : ''}</p>
              {r.status === 'pending' && (
                <div className="sgov-actions">
                  <input placeholder="Reason (optional)" value={reasons[r.id] ?? ''} onChange={(e) => setReasons((m) => ({ ...m, [r.id]: e.target.value }))} />
                  <button className="dialog-btn" onClick={() => change((g) => decide(g, r.id, true, reasons[r.id] ?? '', Date.now()))}>Approve</button>
                  <button className="dialog-btn dialog-btn-danger" onClick={() => change((g) => decide(g, r.id, false, reasons[r.id] ?? '', Date.now()))}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
