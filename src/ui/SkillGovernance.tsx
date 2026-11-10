import { useEffect, useState, type ReactNode } from 'react';
import { readSkill, type Skill } from '../skills';
import { reviewOutcome, reviewSkill, type CheckResult } from '../skill-review';
import { APPROVER, approvalSteps, type ApprovalStep } from '../skill-approval';
import { reconcile, applyDbLevels, dbTarget, type DbRequest } from '../skill-db';
import { CHECKS, decide, demote, levelOf, loadGov, pendingFor, renameLevel, requestPromotion, saveGov, type LevelIndex, type SkillGov } from '../skill-governance';

type Tab = 'map' | 'approvals';
type MapView = 'board' | 'steps' | 'rings';
const MAP_VIEW_LABEL: Record<MapView, string> = { board: 'Board', steps: 'Steps', rings: 'Rings' };
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
export function Checks({ results, version }: { results: { id: string; status: 'pass' | 'warn' | 'fail'; detail: string }[] | null; version?: string }) {
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
  const [mapView, setMapView] = useState<MapView>('board');
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[]>(CHECKS.map(() => false));
  const [note, setNote] = useState('');
  const [review, setReview] = useState<CheckResult[] | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  // Shared database: 'unknown' until the first answer, 'off' when it is not set up (the queue then stays a local simulation).
  const [db, setDb] = useState<'unknown' | 'on' | 'off'>('unknown');
  const [dbMsg, setDbMsg] = useState('');
  const [dbBusy, setDbBusy] = useState(false);
  const [groups, setGroups] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [groupId, setGroupId] = useState('');
  const [canDecide, setCanDecide] = useState<Record<string, boolean>>({});
  const host = window.host;

  /** Ask the database for the state of the requests and bring the local queue in line. */
  const syncDb = async () => {
    if (!host?.skillDbPromotion) { setDb('off'); return; }
    const r = await host.skillDbPromotion('list_skill_requests', {});
    if (!r.ok) { setDb('off'); setDbMsg(r.detail ?? ''); return; }
    const rows = (r.data?.requests ?? []) as Array<DbRequest>;
    setDb('on'); setDbMsg('');
    setCanDecide(Object.fromEntries(rows.map((x) => [x.id, !!x.can_decide])));
    setGov((g) => reconcile(g, rows));
    // The database decides the level of every skill; the local map is only a copy of it (and the simulation when there is no database).
    const health = await host.skillDbHealth?.().catch(() => undefined);
    if (health?.ok) setGov((g) => applyDbLevels(g, health.data?.skills));
    const gr = await host.skillDbGroups?.();
    if (gr?.ok && gr.rows) { setGroups(gr.rows); setGroupId((cur) => cur || gr.rows?.[0]?.id || ''); }
  };
  useEffect(() => { void syncDb(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Register the skill in the database (Individual) and ask for the next level there. Returns the database request id. */
  const submitDb = async (dir: string, lvl: LevelIndex): Promise<{ id?: string; error?: string }> => {
    const reg = await host!.skillDbRegister?.(dir);
    if (!reg?.ok) return { error: reg?.detail ?? 'The skill could not be stored in the database.' };
    const to = dbTarget((lvl + 1) as 1 | 2);
    const r = await host!.skillDbPromotion!('request_skill_promotion', { name: dir, to, ...(to === 'team' ? { group: groupId } : {}), note });
    if (!r.ok) return { error: r.detail };
    const req = r.data?.request;
    if (req?.status === 'blocked') {
      await host!.skillDbPromotion!('withdraw_skill_request', { id: req.id });
      return { error: 'The database’s own automatic checks failed for this version. Fix the skill and ask again.' };
    }
    return { id: req?.id };
  };

  useEffect(() => saveGov(gov), [gov]);
  const change = (fn: (g: SkillGov) => SkillGov) => setGov((g) => fn(g));
  const pending = gov.requests.filter((r) => r.status === 'pending');
  const levels: LevelIndex[] = [0, 1, 2];
  const levelHead = (i: LevelIndex): ReactNode => {
    const n = skills.filter((s) => levelOf(gov, s.name) === i).length;
    return (
      <header>
        <span className="sgov-role">{ROLE[i]}</span>
        <b>{gov.levels[i]}</b>
        <span className="sgov-n">{n} {n === 1 ? 'skill' : 'skills'}</span>
        <span className="sgov-reach">{i === 2 ? 'visible to everyone' : i === 1 ? 'visible to the team' : 'visible to you only'}</span>
      </header>
    );
  };
  const chips = (i: LevelIndex): ReactNode => {
    const inLane = skills.filter((s) => levelOf(gov, s.name) === i);
    const waiting = i > 0 ? pending.filter((r) => r.to === i).length : 0;
    return (
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
    );
  };

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
          <div className="sgov-views" role="group" aria-label="Way to show the levels">
            {(['board', 'steps', 'rings'] as MapView[]).map((v) => (
              <button key={v} className={`sgov-view ${mapView === v ? 'on' : ''}`} aria-pressed={mapView === v} onClick={() => setMapView(v)}>{MAP_VIEW_LABEL[v]}</button>
            ))}
          </div>
          {mapView === 'rings' ? (
            <div className="sgov-rings" aria-label="Skills by organisation level">
              {(() => {
                const ring = (i: LevelIndex): ReactNode => (
                  <section className={`sgov-ring sgov-ring-${i}`} key={i}>
                    {levelHead(i)}
                    {i > 0 && <div className="sgov-ring-gate">↑ approval by {APPROVER[i as 1 | 2].role.split(' (')[0]}{pending.filter((r) => r.to === i).length > 0 && <em> · {pending.filter((r) => r.to === i).length} waiting</em>}</div>}
                    {chips(i)}
                    {i > 0 && ring((i - 1) as LevelIndex)}
                  </section>
                );
                return ring(2);
              })()}
            </div>
          ) : (
            <div className={`sgov-board sgov-board-${mapView}`} aria-label="Skills by organisation level">
              {levels.map((i) => (
                <div className={`sgov-col-wrap sgov-col-wrap-${i}`} key={i}>
                  <section className={`sgov-col sgov-col-${i}`}>
                    {levelHead(i)}
                    {chips(i)}
                  </section>
                  {i < 2 && (
                    <div className="sgov-arrow" aria-hidden="true">
                      <span>→</span>
                      <small>approval by {APPROVER[(i + 1) as 1 | 2].role.split(' (')[0]}</small>
                      {pending.filter((r) => r.to === i + 1).length > 0 && <em>{pending.filter((r) => r.to === i + 1).length} waiting</em>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

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
                  <p className="sgov-help">{db === 'on' ? 'Requests are stored in the shared database under your e-mail address. Another person decides them.' : 'Simulation: without the shared database one person plays every role and the approval is stored on this computer.'}</p>
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
                {lvl > 0 && !req && db !== 'on' && <button className="dialog-btn" onClick={() => change((g) => demote(g, s.name))}>Move down</button>}
                {lvl > 0 && !req && db === 'on' && <span className="sgov-help" title="The shared database holds the level. A skill leaves a level by being phased out or retired in Skill management.">Level set by the database</span>}
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
                    {db === 'on' && lvl === 0 && (
                      <label className="sgov-check"><span>Department</span>
                        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                          {groups.length === 0 && <option value="">You are in no department</option>}
                          {groups.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.role})</option>)}
                        </select>
                      </label>
                    )}
                    {db === 'off' && <small>Not connected to the shared database: this request is a local simulation{dbMsg ? ` (${dbMsg})` : ''}.</small>}
                    {dbMsg && db === 'on' && <small role="alert">{dbMsg}</small>}
                    <textarea placeholder="Why should this skill be published? Who will use it?" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
                    <div className="sgov-actions">
                      <button className="dialog-btn dialog-btn-primary" disabled={dbBusy || !checked.every(Boolean) || !review || reviewOutcome(review) === 'blocked' || (db === 'on' && lvl === 0 && !groupId)} onClick={async () => {
                        const checksOut = review?.map(({ id, status, detail }) => ({ id, status, detail }));
                        if (db !== 'on') { change((g) => requestPromotion(g, s.name, note, Date.now(), checksOut)); setAsking(null); return; }
                        setDbBusy(true); setDbMsg('');
                        const out = await submitDb(s.dir, lvl);
                        setDbBusy(false);
                        if (out.error) { setDbMsg(out.error); return; }
                        change((g) => requestPromotion(g, s.name, note, Date.now(), checksOut, out.id));
                        setAsking(null);
                      }}>{dbBusy ? 'Sending…' : 'Submit for approval'}</button>
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
          <p className="sgov-help">
            {db === 'on' ? 'Stored in the shared database. The database decides who may approve: not the requester, only a department admin or a Governance board admin.' : db === 'off' ? `Local simulation: not connected to the shared database${dbMsg ? ` (${dbMsg})` : ''}.` : 'Checking the shared database…'}
            {db === 'on' && <> <button className="dialog-btn" onClick={() => void syncDb()}>Refresh</button></>}
          </p>
          {dbMsg && db === 'on' && <p className="sgov-help" role="alert">{dbMsg}</p>}
          {gov.requests.length === 0 && (
            <div className="sgov-empty">
              <h3>No requests yet</h3>
              <p className="sgov-help">A request starts on the map: pick a skill and choose “Publish”. This is what then happens, step by step, and who is asked.</p>
              <Steps steps={approvalSteps(1)} />
              <ul className="sgov-roles">
                <li><b>{gov.levels[0]} → {gov.levels[1]}</b><span>{APPROVER[1].role}, {APPROVER[1].sla}</span></li>
                <li><b>{gov.levels[1]} → {gov.levels[2]}</b><span>{APPROVER[2].role}, {APPROVER[2].sla}</span></li>
              </ul>
              {(() => {
                const ready = skills.filter((s) => levelOf(gov, s.name) < 2 && !pendingFor(gov, s.name)).slice(0, 6);
                return ready.length > 0 && (
                  <>
                    <p className="sgov-help"><b>Ready to publish</b></p>
                    <div className="sgov-chips">
                      {ready.map((s) => <button key={s.dir} className="sgov-chip" onClick={() => { setPicked(s.name); setTab('map'); }}>{s.name} <small>→ {gov.levels[(levelOf(gov, s.name) + 1) as LevelIndex]}</small></button>)}
                    </div>
                  </>
                );
              })()}
              <p className="sgov-help"><b>Example of a request in review</b> (illustration only, nothing is stored)</p>
              <div className="sgov-req sgov-req-example">
                <div className="sgov-req-head"><strong>lead-qualifier</strong><span>{gov.levels[1]} → {gov.levels[2]}</span><span className="sgov-badge sgov-badge-wait">Pending</span><span className="sched-example">Example</span></div>
                <Steps steps={approvalSteps(2, { status: 'pending' })} />
                <p className="row-detail">“Used by 14 sales people in three countries; no customer data inside.”</p>
              </div>
            </div>
          )}
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
                  {(['Approve', 'Reject'] as const).map((label) => {
                    const approve = label === 'Approve';
                    const blocked = !!r.dbId && canDecide[r.dbId] === false;
                    return (
                      <button key={label} className={`dialog-btn ${approve ? '' : 'dialog-btn-danger'}`} disabled={dbBusy || blocked}
                        title={blocked ? 'The database only lets another person decide: not the requester, and only a department admin (or a Governance board admin for the organization level).' : undefined}
                        onClick={async () => {
                          if (r.dbId && host?.skillDbPromotion) {
                            setDbBusy(true); setDbMsg('');
                            const out = await host.skillDbPromotion('decide_skill_request', { id: r.dbId, approve, reason: reasons[r.id] ?? '' });
                            setDbBusy(false);
                            if (!out.ok) { setDbMsg(out.detail ?? 'The database refused the decision.'); return; }
                          }
                          change((g) => decide(g, r.id, approve, reasons[r.id] ?? '', Date.now()));
                        }}>{label}</button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
