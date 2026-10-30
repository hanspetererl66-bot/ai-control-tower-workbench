import { useEffect, useState, type ReactNode } from 'react';
import { readSkill, type Skill } from '../skills';
import { reviewOutcome, reviewSkill, type CheckResult } from '../skill-review';
import { APPROVER, approvalSteps, type ApprovalStep } from '../skill-approval';
import { CHECKS, decide, demote, levelOf, loadGov, pendingFor, renameLevel, requestPromotion, saveGov, type LevelIndex, type SkillGov } from '../skill-governance';

type Tab = 'map' | 'approvals';
const ROLE = ['Individual', 'Department', 'Organization'] as const;
const MARK = { done: '✓', active: '…', todo: '', rejected: '✕' } as const;

function Steps({ steps }: { steps: ApprovalStep[] }) {
  return (
    <ol className="sgov-steps">
      {steps.map((st, i) => (
        <li key={st.id} className={`sgov-st sgov-st-${st.state}`}>
          <span className="sgov-st-dot">{MARK[st.state] || i + 1}</span>
          <b>{st.title}</b>
          <small>{st.who}</small>
        </li>
      ))}
    </ol>
  );
}

/**
 * Skills grouped by organisation level (three, with names the person chooses) plus the approval queue
 * that moves a skill one level up. `renderRow` draws the skill itself; this adds the level controls.
 */
const CHECK_MARK = { pass: '✓', warn: '!', fail: '✕' } as const;
const CHECK_TITLE: Record<string, string> = { secrets: 'Secrets scan', scripts: 'Script review', permissions: 'Permissions', harness: 'Harness policy', data: 'Data class' };

/** The five automatic checks, revealed one after the other, with what was found. */
function Checks({ results, version }: { results: { id: string; status: 'pass' | 'warn' | 'fail'; detail: string }[] | null; version?: string }) {
  if (!results) return <p className="sgov-checking" role="status">Reading the skill and running the checks…</p>;
  const blocked = results.some((r) => r.status === 'fail'), warns = results.filter((r) => r.status === 'warn').length;
  return (
    <div className="sgov-checks">
      <div className="sgov-checks-h"><b>Automatic review{version ? ` of ${version}` : ''}</b>
        <span className={`sgov-badge ${blocked ? 'sgov-badge-no' : warns ? 'sgov-badge-wait' : 'sgov-badge-ok'}`}>{blocked ? 'Blocked: fix the red points' : warns ? `Passed with ${warns} note${warns > 1 ? 's' : ''} for the reviewer` : 'All five checks passed'}</span>
      </div>
      <ul>
        {results.map((r, i) => (
          <li key={r.id} className={`sgov-ck sgov-ck-${r.status}`} style={{ animationDelay: `${i * 140}ms` }}>
            <span className="sgov-ck-dot" aria-label={r.status}>{CHECK_MARK[r.status]}</span>
            <span><b>{CHECK_TITLE[r.id] ?? r.id}</b><small>{r.detail}</small></span>
          </li>
        ))}
      </ul>
      <p className="sgov-help">The reviewer sees these findings and the skill text. A skill that changes afterwards has to be requested again.</p>
    </div>
  );
}

export default function SkillGovernance({ skills, renderRow }: { skills: Skill[]; renderRow: (skill: Skill, extra: ReactNode) => ReactNode }) {
  const [gov, setGov] = useState<SkillGov>(() => loadGov());
  const [tab, setTab] = useState<Tab>('map');
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[]>(CHECKS.map(() => false));
  const [note, setNote] = useState('');
  const [review, setReview] = useState<CheckResult[] | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});

  useEffect(() => saveGov(gov), [gov]);
  const change = (fn: (g: SkillGov) => SkillGov) => setGov((g) => fn(g));
  const pending = gov.requests.filter((r) => r.status === 'pending');
  const levels: LevelIndex[] = [0, 1, 2];

  const startEdit = () => { setDraft([...gov.levels]); setEditing(true); };
  const saveEdit = () => {
    change((g) => levels.reduce((acc, i) => renameLevel(acc, i, draft[i] ?? acc.levels[i]), g));
    setEditing(false);
  };

  return (
    <div className="sgov">
      <div className="sgov-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'map'} className={`sgov-tab ${tab === 'map' ? 'on' : ''}`} onClick={() => setTab('map')}>Organization map <span className="sgov-n">{skills.length}</span></button>
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

      {tab === 'map' && (
        <>
          <div className="sgov-map" aria-label="Skills by organisation level">
            {([2, 1, 0] as LevelIndex[]).map((i) => {
              const inLane = skills.filter((s) => levelOf(gov, s.name) === i);
              const waiting = i > 0 ? pending.filter((r) => r.to === i).length : 0;
              return (
                <div key={i}>
                  {i < 2 && (
                    <div className="sgov-gate" aria-hidden="true">
                      <span>↑ approval by {APPROVER[(i + 1) as 1 | 2].role.split(' (')[0]}</span>
                      {pending.filter((r) => r.to === i + 1).length > 0 && <em>{pending.filter((r) => r.to === i + 1).length} waiting</em>}
                    </div>
                  )}
                  <section className={`sgov-lane sgov-lane-${i}`}>
                    <header>
                      <span className="sgov-role">{ROLE[i]}</span>
                      <b>{gov.levels[i]}</b>
                      <span className="sgov-n">{inLane.length} {inLane.length === 1 ? 'skill' : 'skills'}</span>
                      {i === 2 && <span className="sgov-reach">visible to everyone</span>}
                      {i === 1 && <span className="sgov-reach">visible to the team</span>}
                      {i === 0 && <span className="sgov-reach">visible to you only</span>}
                    </header>
                    <div className="sgov-chips">
                      {inLane.length === 0 && <span className="sgov-none">Nothing here yet{waiting ? `, ${waiting} in review` : ''}</span>}
                      {inLane.map((s) => {
                        const req = pendingFor(gov, s.name);
                        return (
                          <button key={s.dir} className={`sgov-chip ${picked === s.name ? 'on' : ''}`} aria-pressed={picked === s.name} onClick={() => setPicked(picked === s.name ? null : s.name)}>
                            {s.name}{req && <span className="sgov-badge sgov-badge-wait">in review</span>}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </div>
              );
            })}
          </div>

          {(() => {
            const s = skills.find((x) => x.name === picked);
            if (!s) {
              return (
                <div className="sgov-flow">
                  <h3>How a skill moves up <small>(mockup of the approval process)</small></h3>
                  <p className="sgov-help">Pick a skill above to publish it. Every step up needs an approval; a skill never skips a level.</p>
                  <Steps steps={approvalSteps(1)} />
                  <p className="sgov-help"><b>Automatic review</b> before anyone looks at it: secrets, scripts and downloads, tools that change data, the harness rules (no bypassing approvals) and the data class. A red finding blocks the request; notes go to the reviewer.</p>
                  <ul className="sgov-roles">
                    <li><b>{gov.levels[0]} → {gov.levels[1]}</b><span>{APPROVER[1].role}, {APPROVER[1].sla}</span></li>
                    <li><b>{gov.levels[1]} → {gov.levels[2]}</b><span>{APPROVER[2].role}, {APPROVER[2].sla}</span></li>
                  </ul>
                  <p className="sgov-help">Simulation: in this prototype one person plays every role and the approval is stored on this computer. A real rollout needs the shared database described in the architecture note.</p>
                </div>
              );
            }
            const lvl = levelOf(gov, s.name), req = pendingFor(gov, s.name);
            const extra = (
              <div className="sgov-extra">
                {req && <span className="sgov-badge sgov-badge-wait">In review for {gov.levels[req.to]}</span>}
                {!req && lvl < 2 && asking !== s.name && (
                  <button className="dialog-btn dialog-btn-primary" onClick={() => { setAsking(s.name); setChecked(CHECKS.map(() => false)); setNote(''); setReview(null); const target = lvl + 1 === 2 ? 'organization' : 'department'; void readSkill(s.dir).then((body) => { window.setTimeout(() => setReview(body ? reviewSkill(body, target) : [{ id: 'secrets', title: 'Secrets scan', question: '', status: 'fail', detail: 'The SKILL.md could not be read, so nothing could be checked.' }]), 450); }); }}>
                    Publish to {gov.levels[(lvl + 1) as LevelIndex]}
                  </button>
                )}
                {!req && lvl === 2 && <span className="sgov-badge sgov-badge-ok">Top level</span>}
                {lvl > 0 && !req && <button className="dialog-btn" onClick={() => change((g) => demote(g, s.name))}>Move down</button>}
              </div>
            );
            return (
              <div className="sgov-sel">
                {renderRow(s, extra)}
                {(req || asking === s.name) && <Steps steps={approvalSteps(req ? req.to : ((lvl + 1) as LevelIndex), req, review ? (reviewOutcome(review) === 'blocked' ? 'rejected' : 'done') : 'active')} />}
                {req?.checks && <Checks results={req.checks} />}
                {asking === s.name && !req && <Checks results={review} version="the current version" />}
                {asking === s.name && lvl < 2 && (
                  <div className="sgov-form">
                    <strong>Publish to {gov.levels[(lvl + 1) as LevelIndex]}: {gov.levels[lvl]} → {gov.levels[(lvl + 1) as LevelIndex]}</strong>
                    <small>Approver: {APPROVER[(lvl + 1) as 1 | 2].role}, {APPROVER[(lvl + 1) as 1 | 2].sla}.</small>
                    {CHECKS.map((c, k) => (
                      <label key={c} className="sgov-check"><input type="checkbox" checked={checked[k]} onChange={() => setChecked((cs) => cs.map((v, j) => (j === k ? !v : v)))} />{c}</label>
                    ))}
                    <textarea placeholder="Why should this skill be published? Who will use it?" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
                    <div className="sgov-actions">
                      <button className="dialog-btn dialog-btn-primary" disabled={!checked.every(Boolean) || !review || reviewOutcome(review) === 'blocked'} onClick={() => { change((g) => requestPromotion(g, s.name, note, Date.now(), review?.map(({ id, status, detail }) => ({ id, status, detail })))); setAsking(null); }}>Submit for approval</button>
                      <button className="dialog-btn" onClick={() => setAsking(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {tab === 'approvals' && (
        <div className="sgov-queue">
          {gov.requests.length === 0 && <p className="manage-empty">No requests yet. Pick a skill on the map and choose “Publish”.</p>}
          {gov.requests.map((r) => (
            <div key={r.id} className="sgov-req">
              <div className="sgov-req-head">
                <strong>{r.skill}</strong>
                <span>{gov.levels[r.from]} → {gov.levels[r.to]}</span>
                <span className={`sgov-badge ${r.status === 'approved' ? 'sgov-badge-ok' : r.status === 'rejected' ? 'sgov-badge-no' : 'sgov-badge-wait'}`}>{r.status === 'pending' ? 'Pending' : r.status === 'approved' ? 'Approved' : 'Rejected'}</span>
              </div>
              <Steps steps={approvalSteps(r.to, r)} />
              {r.checks && <Checks results={r.checks} />}
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
