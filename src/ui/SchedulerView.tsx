import { useEffect, useMemo, useState } from 'react';
import {
  MAX_JOBS, TARGET_LABEL, WEEKDAYS, cadenceProblems, describeCadence, jobState, newJob, nextRun, toLocalInput, upcoming,
  type Cadence, type Job, type Target, type TargetType,
} from '../jobs';

const KINDS: Array<{ kind: Cadence['kind']; label: string }> = [
  { kind: 'once', label: 'Once' }, { kind: 'interval', label: 'Every … minutes / hours / days' }, { kind: 'daily', label: 'Daily' },
  { kind: 'weekly', label: 'Weekly' }, { kind: 'monthly', label: 'Monthly' }, { kind: 'cron', label: 'Cron expression' },
];

const fmt = (d: Date | string | null | undefined): string => {
  if (!d) return '–';
  const x = typeof d === 'string' ? new Date(d) : d;
  return x.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const duration = (ms: number) => (ms < 1000 ? '<1 s' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

function defaultCadence(kind: Cadence['kind'], now: Date): Cadence {
  const soon = new Date(now.getTime() + 3600_000); soon.setMinutes(0, 0, 0);
  switch (kind) {
    case 'once': return { kind, at: toLocalInput(soon) };
    case 'interval': return { kind, every: 1, unit: 'hours' };
    case 'daily': return { kind, time: '07:30' };
    case 'weekly': return { kind, time: '07:30', days: [1] };
    case 'monthly': return { kind, time: '07:30', day: 1 };
    case 'cron': return { kind, expr: '30 7 * * 1-5' };
  }
}

export default function SchedulerView({ jobs, targets, runningId, canRun, onJobs, onRunNow }: {
  jobs: Job[];
  targets: Target[];
  runningId: string;
  canRun: boolean;
  onJobs: (next: Job[]) => void;
  onRunNow: (job: Job) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState('');
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(id); }, []);
  const patch = (id: string, p: Partial<Job>) => onJobs(jobs.map((j) => (j.id === id ? { ...j, ...p } : j)));
  const active = jobs.filter((j) => j.enabled && jobState(j, now) === 'scheduled').length;

  return (
    <main className="sched">
      <header className="sched-head">
        <div>
          <h1>Scheduler</h1>
          <p>Run any agent, workflow or skill at a set time. {jobs.length ? `${active} of ${jobs.length} jobs active.` : 'No jobs yet.'}</p>
        </div>
        <button className="sched-primary" onClick={() => setCreating(true)} disabled={jobs.length >= MAX_JOBS || creating}>+ Create job</button>
      </header>
      <p className="sched-note">Jobs run in the chat while Werkbank is open. A run that was missed while the app was closed is made up for up to six hours.</p>

      {creating && <JobForm targets={targets} now={now} onCancel={() => setCreating(false)} onSave={(job) => { onJobs([job, ...jobs]); setCreating(false); setOpen(job.id); }} />}

      {jobs.length === 0 ? (
        creating ? null : (
        <div className="sched-empty">
          <strong>Nothing scheduled</strong>
          <span>Create a job, pick an agent, a workflow or a skill, and choose when it should run.</span>
        </div>)
      ) : (
        <div className="sched-table" role="table" aria-label="Scheduled jobs">
          <div className="sched-row sched-th" role="row">
            <span>Job</span><span>Runs</span><span>Schedule</span><span>Next run</span><span>Last run</span><span>Status</span><span />
          </div>
          {jobs.map((job) => {
            const state = jobState(job, now);
            const next = state === 'scheduled' ? nextRun(job, now) : null;
            const last = job.runs[0];
            return (
              <div key={job.id} className="sched-item">
                <div className="sched-row" role="row">
                  <button className="sched-name" onClick={() => setOpen(open === job.id ? '' : job.id)} aria-expanded={open === job.id}>
                    <span className={`sched-chev ${open === job.id ? 'sched-chev-on' : ''}`} aria-hidden="true">›</span>{job.name}
                  </button>
                  <span><span className={`sched-type sched-type-${job.target.type}`}>{TARGET_LABEL[job.target.type]}</span> {job.target.label}</span>
                  <span>{describeCadence(job.cadence)}</span>
                  <span>{next ? fmt(next) : '–'}</span>
                  <span>{last ? <><i className={`sched-dot sched-dot-${last.status}`} />{fmt(last.at)}</> : '–'}</span>
                  <span className={`sched-state sched-state-${runningId === job.id ? 'running' : state}`}>{runningId === job.id ? 'Running' : { scheduled: 'Active', paused: 'Paused', done: 'Done', missed: 'Missed' }[state]}</span>
                  <span className="sched-actions">
                    <button onClick={() => onRunNow(job)} disabled={!canRun || Boolean(runningId)} title={canRun ? 'Run now' : 'The agent is busy or not connected'}>Run now</button>
                    {job.cadence.kind !== 'once' || !job.lastRun ? (
                      <button onClick={() => patch(job.id, { enabled: !job.enabled })}>{job.enabled ? 'Pause' : 'Resume'}</button>
                    ) : null}
                    <button className="sched-del" onClick={() => { if (window.confirm(`Delete job "${job.name}"?`)) onJobs(jobs.filter((j) => j.id !== job.id)); }} aria-label={`Delete ${job.name}`}>Delete</button>
                  </span>
                </div>
                {open === job.id && (
                  <div className="sched-detail">
                    {job.note && <p><strong>Instruction:</strong> {job.note}</p>}
                    <h3>Run history</h3>
                    {job.runs.length === 0 ? <p className="sched-muted">No runs yet.</p> : (
                      <table>
                        <thead><tr><th>Started</th><th>Trigger</th><th>Duration</th><th>Result</th><th>Note</th></tr></thead>
                        <tbody>
                          {job.runs.map((r) => (
                            <tr key={r.id}><td>{fmt(r.at)}</td><td>{r.trigger === 'manual' ? 'Manual' : 'Schedule'}</td><td>{duration(r.ms)}</td>
                              <td><i className={`sched-dot sched-dot-${r.status}`} />{{ ok: 'Succeeded', error: 'Failed', skipped: 'Skipped' }[r.status]}</td><td>{r.note}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function JobForm({ targets, now, onCancel, onSave }: { targets: Target[]; now: Date; onCancel: () => void; onSave: (job: Job) => void }) {
  const firstType = (['agent', 'workflow', 'skill'] as TargetType[]).find((t) => targets.some((x) => x.type === t)) ?? 'agent';
  const [type, setType] = useState<TargetType>(firstType);
  const options = useMemo(() => targets.filter((t) => t.type === type), [targets, type]);
  const [targetId, setTargetId] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [cadence, setCadence] = useState<Cadence>(() => defaultCadence('daily', now));
  const target = options.find((t) => t.id === targetId) ?? options[0];
  const problems = cadenceProblems(cadence, now);
  const preview = problems.length ? [] : upcoming(cadence, now, 3);
  const canSave = Boolean(target) && problems.length === 0;

  return (
    <form className="sched-form" onSubmit={(e) => { e.preventDefault(); if (canSave && target) onSave(newJob({ name, target, note: type === 'agent' ? '' : note, cadence }, new Date())); }}>
      <h2>New job</h2>
      <label>Name<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={target ? `${TARGET_LABEL[type]}: ${target.label}` : 'Job name'} /></label>
      <div className="sched-form-grid">
        <label>What to run
          <select value={type} onChange={(e) => { setType(e.target.value as TargetType); setTargetId(''); }}>
            {(['agent', 'workflow', 'skill'] as const).map((t) => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}
          </select>
        </label>
        <label>{TARGET_LABEL[type]}
          <select value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value)} disabled={options.length === 0}>
            {options.length === 0 ? <option value="">{type === 'agent' ? 'No agents yet (create one in Develop)' : type === 'workflow' ? 'No workflows yet (create one in Develop)' : 'No skills installed'}</option> : options.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>
      {type === 'agent' ? <p className="sched-muted">An agent only runs on a schedule once it is published in the Studio.</p> : (
        <label>Additional instruction (optional)<textarea value={note} maxLength={400} rows={2} onChange={(e) => setNote(e.target.value)} placeholder={type === 'workflow' ? 'For example: use the test data set' : 'For example: only for the EMEA entities'} /></label>
      )}
      <fieldset>
        <legend>Schedule</legend>
        <div className="sched-form-grid">
          <label>Repeat
            <select value={cadence.kind} onChange={(e) => setCadence(defaultCadence(e.target.value as Cadence['kind'], now))}>
              {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>
          {cadence.kind === 'once' && <label>Date and time<input type="datetime-local" value={cadence.at} onChange={(e) => setCadence({ kind: 'once', at: e.target.value })} /></label>}
          {cadence.kind === 'interval' && (
            <label>Every
              <span className="sched-inline">
                <input type="number" min={1} value={cadence.every} onChange={(e) => setCadence({ ...cadence, every: Math.floor(Number(e.target.value)) })} />
                <select value={cadence.unit} onChange={(e) => setCadence({ ...cadence, unit: e.target.value as 'minutes' | 'hours' | 'days' })}>
                  <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
                </select>
              </span>
            </label>
          )}
          {(cadence.kind === 'daily' || cadence.kind === 'weekly' || cadence.kind === 'monthly') && (
            <label>Time<input type="time" value={cadence.time} onChange={(e) => setCadence({ ...cadence, time: e.target.value })} /></label>
          )}
          {cadence.kind === 'monthly' && <label>Day of the month<input type="number" min={1} max={31} value={cadence.day} onChange={(e) => setCadence({ ...cadence, day: Math.floor(Number(e.target.value)) })} /></label>}
          {cadence.kind === 'cron' && <label>Cron (minute hour day month weekday)<input value={cadence.expr} onChange={(e) => setCadence({ kind: 'cron', expr: e.target.value })} spellCheck={false} /></label>}
        </div>
        {cadence.kind === 'weekly' && (
          <div className="sched-days" role="group" aria-label="Weekdays">
            {WEEKDAYS.map((w) => (
              <button type="button" key={w.day} aria-pressed={cadence.days.includes(w.day)} className={cadence.days.includes(w.day) ? 'sched-day-on' : ''}
                onClick={() => setCadence({ ...cadence, days: cadence.days.includes(w.day) ? cadence.days.filter((d) => d !== w.day) : [...cadence.days, w.day] })}>{w.short}</button>
            ))}
          </div>
        )}
        {problems.length > 0 ? <p className="sched-problem" role="alert">{problems[0]}</p> : <p className="sched-muted">Next runs: {preview.map((d) => fmt(d)).join(' · ')}</p>}
      </fieldset>
      <div className="sched-form-foot">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="sched-primary" disabled={!canSave}>Create job</button>
      </div>
    </form>
  );
}
