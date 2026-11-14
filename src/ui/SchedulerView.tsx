import { useEffect, useMemo, useState } from 'react';
import {
  GROUP_BY_KEY, MAX_CUSTOM_DIMS, MAX_JOBS, STATE_LABEL, TARGET_LABEL, UNASSIGNED, WEEKDAYS, cadenceProblems, describeCadence, groupJobs, groupValue, groupValues, jobState,
  OUTPUT_KINDS, OUTPUT_LABEL, loadDims, newDim, outputLabel, outputProblems, newJob, nextRun, saveDims, toLocalInput, upcoming, withGroup, withoutDim,
  type Cadence, type GroupDim, type Job, type JobOutput, type JobState, type OutputKind, type Target, type TargetType,
} from '../jobs';
import type { LogEntry } from '../job-log';
import SchedulerActivity from './SchedulerActivity';

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

export default function SchedulerView({ jobs, log, targets, runningId, canRun, onJobs, onRunNow, onAddExamples }: {
  jobs: Job[];
  log: LogEntry[];
  targets: Target[];
  runningId: string;
  canRun: boolean;
  onJobs: (next: Job[]) => void;
  onRunNow: (job: Job) => void;
  onAddExamples: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState('');
  const [tab, setTab] = useState<'jobs' | 'activity'>('jobs');
  const [dims, setDims] = useState<GroupDim[]>(() => loadDims(window.localStorage));
  const [groupBy, setGroupByState] = useState<string>(() => { try { return window.localStorage.getItem(GROUP_BY_KEY) || 'type'; } catch { return 'type'; } });
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | JobState>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [managing, setManaging] = useState(false);
  const dim = dims.find((d) => d.id === groupBy) ?? null;
  const setGroupBy = (id: string) => { setGroupByState(id); setCollapsed(new Set()); try { window.localStorage.setItem(GROUP_BY_KEY, id); } catch { /* not kept */ } };
  const changeDims = (next: GroupDim[]) => { setDims(next); saveDims(next, window.localStorage); };
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(id); }, []);
  const patch = (id: string, p: Partial<Job>) => onJobs(jobs.map((j) => (j.id === id ? { ...j, ...p } : j)));
  const states = jobs.map((j) => jobState(j, now));
  const active = states.filter((x) => x === 'scheduled' || x === 'failing').length;
  const failing = states.filter((x) => x === 'failing').length;
  const q = query.trim().toLowerCase();
  const shown = jobs.filter((j) => {
    if (stateFilter !== 'all' && jobState(j, now) !== stateFilter) return false;
    if (!q) return true;
    return [j.name, j.target.label, j.note, ...Object.values(j.groups ?? {})].some((t) => t.toLowerCase().includes(q));
  });
  const groups = groupJobs(shown, dim, now);
  const toggle = (key: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <main className="sched">
      <header className="sched-head">
        <div>
          <h1>Scheduler</h1>
          <p>Run any agent, workflow or skill at a set time. {jobs.length ? `${active} of ${jobs.length} jobs active${failing ? `, ${failing} failing` : ''}.` : 'No jobs yet.'}</p>
        </div>
        <button className="sched-primary" onClick={() => setCreating(true)} disabled={jobs.length >= MAX_JOBS || creating}>+ Create job</button>
      </header>
      <div className="sched-tabs" role="tablist" aria-label="Scheduler">
        <button role="tab" aria-selected={tab === 'jobs'} className={tab === 'jobs' ? 'sched-tab-on' : ''} onClick={() => setTab('jobs')}>Jobs</button>
        <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'sched-tab-on' : ''} onClick={() => setTab('activity')}>Activity</button>
      </div>
      {tab === 'activity' ? <SchedulerActivity log={log} /> : <>
      <p className="sched-note">Jobs run in the chat while Werkbank is open. A run that was missed while the app was closed is made up for up to six hours.</p>

      {creating && <JobForm targets={targets} now={now} dims={dims} jobs={jobs} onCancel={() => setCreating(false)} onSave={(job) => { onJobs([job, ...jobs]); setCreating(false); setOpen(job.id); }} />}

      {jobs.length === 0 ? (
        creating ? null : (
        <div className="sched-empty">
          <strong>Nothing scheduled</strong>
          <span>Create a job, pick an agent, a workflow or a skill, and choose when it should run.</span>
          <button onClick={onAddExamples}>Add example jobs</button>
        </div>)
      ) : (
        <>
        <div className="sched-tools">
          <input type="search" className="sched-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search jobs, targets, groups…" aria-label="Search jobs" />
          <label>Group by
            <select value={dim ? dim.id : 'none'} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="none">No grouping</option>
              {dims.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          <label>Status
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as 'all' | JobState)}>
              <option value="all">All</option>
              {(Object.keys(STATE_LABEL) as JobState[]).map((k) => <option key={k} value={k}>{STATE_LABEL[k]}</option>)}
            </select>
          </label>
          {dim && groups.length > 1 && <button onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((x) => x.key)))}>{collapsed.size ? 'Expand all' : 'Collapse all'}</button>}
          <button onClick={() => setManaging(!managing)} aria-expanded={managing}>Groupings…</button>
          <span className="sched-muted sched-count">{shown.length === jobs.length ? `${jobs.length} jobs` : `${shown.length} of ${jobs.length} jobs`}</span>
        </div>
        {managing && <GroupManager dims={dims} onAdd={(label) => { const d = newDim(label, dims); if (d) { changeDims([...dims, d]); setGroupBy(d.id); } return Boolean(d); }}
          onRemove={(d) => { if (!window.confirm(`Remove the grouping "${d.label}"? The values on the jobs are deleted too.`)) return; changeDims(dims.filter((x) => x.id !== d.id)); onJobs(withoutDim(jobs, d.id)); if (groupBy === d.id) setGroupBy('type'); }} />}
        {shown.length === 0 && <div className="sched-empty"><strong>No job matches</strong><span>Change the search or the status filter.</span></div>}
        <div className="sched-table" role="table" aria-label="Scheduled jobs" tabIndex={0} hidden={shown.length === 0}>
          <div className="sched-row sched-th" role="row">
            <span>Job</span><span>Runs</span><span>Schedule</span><span>Next run</span><span>Last run</span><span>Success</span><span>Status</span><span />
          </div>
          {groups.map((grp) => (
            <div key={grp.key || 'all'} className="sched-group-block">
              {dim && (
                <button className="sched-group" onClick={() => toggle(grp.key)} aria-expanded={!collapsed.has(grp.key)}>
                  <span className={`sched-chev ${collapsed.has(grp.key) ? '' : 'sched-chev-on'}`} aria-hidden="true">›</span>
                  <strong>{grp.label}</strong>
                  <span className="sched-group-stats">
                    {grp.stats.total} {grp.stats.total === 1 ? 'job' : 'jobs'} · {grp.stats.active} active
                    {grp.stats.failing > 0 && <span className="sched-group-bad"> · {grp.stats.failing} failing</span>}
                    {grp.stats.paused > 0 && <> · {grp.stats.paused} paused</>}
                    {grp.stats.runs > 0 && <> · {Math.round((grp.stats.ok / grp.stats.runs) * 100)}% succeeded</>}
                  </span>
                </button>
              )}
              {!collapsed.has(grp.key) && grp.jobs.map((job) => {
            const state = jobState(job, now);
            const next = state === 'scheduled' || state === 'failing' ? nextRun(job, now) : null;
            const last = job.runs[0];
            return (
              <div key={job.id} className="sched-item">
                <div className="sched-row" role="row">
                  <button className="sched-name" onClick={() => setOpen(open === job.id ? '' : job.id)} aria-expanded={open === job.id}>
                    <span className={`sched-chev ${open === job.id ? 'sched-chev-on' : ''}`} aria-hidden="true">›</span>{job.name}
                    {(job.example || job.groups?.unit || job.groups?.area) && <span className="sched-sub" title={job.example ? 'Sample job: a run only writes a mock entry' : undefined}>{[job.example ? 'Example' : '', job.groups?.unit, job.groups?.area].filter(Boolean).join(' · ')}</span>}
                  </button>
                  <span><span className={`sched-type sched-type-${job.target.type}`}>{TARGET_LABEL[job.target.type]}</span> {job.target.label}</span>
                  <span>{describeCadence(job.cadence)}</span>
                  <span>{next ? fmt(next) : '–'}</span>
                  <span>{last ? <><i className={`sched-dot sched-dot-${last.status}`} />{fmt(last.at)}</> : '–'}</span>
                  <span title="Succeeded runs of the kept history">{job.runs.length ? `${job.runs.filter((r) => r.status === 'ok').length}/${job.runs.length}` : '–'}</span>
                  <span className={`sched-state sched-state-${runningId === job.id ? 'running' : state}`}>{runningId === job.id ? 'Running' : STATE_LABEL[state]}</span>
                  <span className="sched-actions">
                    <button className="sched-icon" onClick={() => onRunNow(job)} disabled={(!canRun && !job.example) || Boolean(runningId)} title={canRun || job.example ? 'Run now' : 'The agent is busy or not connected'} aria-label={`Run now ${job.name}`}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 2.8v10.4a.5.5 0 0 0 .77.42l8-5.2a.5.5 0 0 0 0-.84l-8-5.2a.5.5 0 0 0-.77.42z" /></svg>
                    </button>
                    {job.cadence.kind !== 'once' || !job.lastRun ? (
                      <button className="sched-icon" onClick={() => patch(job.id, { enabled: !job.enabled })} title={job.enabled ? 'Pause' : 'Resume'} aria-label={`${job.enabled ? 'Pause' : 'Resume'} ${job.name}`}>
                        {job.enabled ? (
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.7-4M13 2.5v3h-3" /></svg>
                        )}
                      </button>
                    ) : null}
                    <button className="sched-icon sched-del" onClick={() => { if (window.confirm(`Delete job "${job.name}"?`)) onJobs(jobs.filter((j) => j.id !== job.id)); }} title="Delete" aria-label={`Delete ${job.name}`}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.8 6.8v4.2M9.2 6.8v4.2" /></svg>
                    </button>
                  </span>
                </div>
                {open === job.id && (
                  <div className="sched-detail">
                    <p className="sched-muted">Created {fmt(job.createdAt)} · {TARGET_LABEL[job.target.type]} “{job.target.label}” · {describeCadence(job.cadence)}</p>
                    {job.note && <p><strong>Instruction:</strong> {job.note}</p>}
                    <p><strong>Result goes to:</strong> {outputLabel(job.output)}</p>
                    <h3>Groupings</h3>
                    <div className="sched-groupedit">
                      <span className="sched-muted">Functional type: {groupValue(job, dims[0])} (from what the job runs)</span>
                      {dims.filter((d) => d.kind === 'field').map((d) => (
                        <label key={`${job.id}-${d.id}`}>{d.label}
                          <input list={`sched-gv-${d.id}`} defaultValue={job.groups?.[d.id] ?? ''} maxLength={40} placeholder={UNASSIGNED} spellCheck={false}
                            onBlur={(e) => { if (e.target.value.trim() !== (job.groups?.[d.id] ?? '')) onJobs(jobs.map((j) => (j.id === job.id ? withGroup(j, d.id, e.target.value) : j))); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                          <datalist id={`sched-gv-${d.id}`}>{groupValues(jobs, d.id).map((v) => <option key={v} value={v} />)}</datalist>
                        </label>
                      ))}
                    </div>
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
          ))}
        </div>
        </>
      )}
      </>}
    </main>
  );
}

function defaultOutput(kind: OutputKind): JobOutput {
  switch (kind) {
    case 'email': return { kind, to: '' };
    case 'file': return { kind, path: '', format: 'md' };
    case 'slack': return { kind, channel: '' };
    case 'notion': return { kind, parent: '', parentType: 'page' };
    case 'databricks': return { kind, table: '' };
    default: return { kind: 'chat' };
  }
}

function JobForm({ targets, now, dims, jobs, onCancel, onSave }: { targets: Target[]; now: Date; dims: GroupDim[]; jobs: Job[]; onCancel: () => void; onSave: (job: Job) => void }) {
  const firstType = (['agent', 'workflow', 'skill'] as TargetType[]).find((t) => targets.some((x) => x.type === t)) ?? 'agent';
  const [type, setType] = useState<TargetType>(firstType);
  const options = useMemo(() => targets.filter((t) => t.type === type), [targets, type]);
  const [targetId, setTargetId] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [cadence, setCadence] = useState<Cadence>(() => defaultCadence('daily', now));
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<JobOutput>({ kind: 'chat' });
  const target = options.find((t) => t.id === targetId) ?? options[0];
  const problems = cadenceProblems(cadence, now);
  const preview = problems.length ? [] : upcoming(cadence, now, 3);
  const outProblems = outputProblems(output);
  const canSave = Boolean(target) && problems.length === 0 && outProblems.length === 0;

  return (
    <form className="sched-form" onSubmit={(e) => { e.preventDefault(); if (canSave && target) onSave(newJob({ name, target, note: type === 'agent' ? '' : note, cadence, groups, output }, new Date())); }}>
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
      <fieldset>
        <legend>Write the result to</legend>
        <div className="sched-form-grid">
          <label>Destination
            <select value={output.kind} onChange={(e) => setOutput(defaultOutput(e.target.value as OutputKind))}>
              {OUTPUT_KINDS.map((k) => <option key={k} value={k}>{OUTPUT_LABEL[k]}</option>)}
            </select>
          </label>
          {output.kind === 'email' && <label>To<input type="email" value={output.to} maxLength={120} onChange={(e) => setOutput({ kind: 'email', to: e.target.value })} placeholder="name@company.com" /></label>}
          {output.kind === 'file' && <label>Folder in job-results (optional)<input value={output.path} maxLength={120} onChange={(e) => setOutput({ ...output, path: e.target.value })} placeholder="finance/weekly" spellCheck={false} /></label>}
          {output.kind === 'file' && <label>Format<select value={output.format} onChange={(e) => setOutput({ ...output, format: e.target.value as 'md' | 'txt' })}><option value="md">Markdown (.md)</option><option value="txt">Plain text (.txt)</option></select></label>}
          {output.kind === 'slack' && <label>Channel<input value={output.channel} maxLength={80} onChange={(e) => setOutput({ kind: 'slack', channel: e.target.value })} placeholder="#finance-ops or C0123ABCDE" spellCheck={false} /></label>}
          {output.kind === 'notion' && <label>Parent page or database<input value={output.parent} maxLength={300} onChange={(e) => setOutput({ ...output, parent: e.target.value })} placeholder="notion.so link or id" spellCheck={false} /></label>}
          {output.kind === 'notion' && <label>Parent is a<select value={output.parentType} onChange={(e) => setOutput({ ...output, parentType: e.target.value as 'page' | 'database' })}><option value="page">Page</option><option value="database">Database</option></select></label>}
          {output.kind === 'databricks' && <label>Table<input value={output.table} maxLength={120} onChange={(e) => setOutput({ kind: 'databricks', table: e.target.value })} placeholder="catalog.schema.table" spellCheck={false} /></label>}
        </div>
        {outProblems.length > 0 && <p className="sched-problem" role="alert">{outProblems[0]}</p>}
        <p className="sched-muted">{{
          chat: 'The answer stays in the chat.',
          email: 'An email draft is created in Gmail with the answer; you check and send it. Needs the Gmail connector.',
          file: 'Saved as a new file in the job-results folder of the workspace; existing files are never overwritten.',
          slack: 'Posted to the channel after every run. Needs the Slack connector, and the bot must be in the channel.',
          notion: 'A new page with the answer is created after every run. Needs the Notion connector, and the page or database must be shared with it.',
          databricks: 'One row (job_id, job_name, run_at, result) is added to an existing table after every run. Needs the Databricks connector and a SQL warehouse.',
        }[output.kind]} If writing fails, the run is marked as failed and the note says why.</p>
      </fieldset>
      <fieldset>
        <legend>Groupings (optional)</legend>
        <div className="sched-form-grid">
          {dims.filter((d) => d.kind === 'field').map((d) => (
            <label key={d.id}>{d.label}
              <input list={`sched-form-gv-${d.id}`} value={groups[d.id] ?? ''} maxLength={40} placeholder={UNASSIGNED} onChange={(e) => setGroups({ ...groups, [d.id]: e.target.value })} />
              <datalist id={`sched-form-gv-${d.id}`}>{groupValues(jobs, d.id).map((v) => <option key={v} value={v} />)}</datalist>
            </label>
          ))}
        </div>
        <p className="sched-muted">The functional type (workflow, agent, skill) comes from what the job runs.</p>
      </fieldset>
      <div className="sched-form-foot">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="sched-primary" disabled={!canSave}>Create job</button>
      </div>
    </form>
  );
}

function GroupManager({ dims, onAdd, onRemove }: { dims: GroupDim[]; onAdd: (label: string) => boolean; onRemove: (dim: GroupDim) => void }) {
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState('');
  const custom = dims.filter((d) => !d.builtin);
  const add = () => {
    if (!label.trim()) return;
    if (onAdd(label)) { setLabel(''); setProblem(''); } else setProblem(custom.length >= MAX_CUSTOM_DIMS ? `At most ${MAX_CUSTOM_DIMS} own groupings.` : 'That name is already used.');
  };
  return (
    <div className="sched-gm">
      <p className="sched-muted">Functional type, business area and organization unit are built in. Add your own groupings, for example project, cost center or owner, then set the value on each job (open a job, section Groupings).</p>
      {custom.length > 0 && (
        <ul className="sched-gm-list">
          {custom.map((d) => <li key={d.id}><span>{d.label}</span><button onClick={() => onRemove(d)} aria-label={`Remove grouping ${d.label}`}>Remove</button></li>)}
        </ul>
      )}
      <div className="sched-gm-add">
        <input value={label} maxLength={30} onChange={(e) => { setLabel(e.target.value); setProblem(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="New grouping, for example Cost center" aria-label="Name of the new grouping" />
        <button onClick={add} disabled={!label.trim() || custom.length >= MAX_CUSTOM_DIMS}>Add grouping</button>
      </div>
      {problem && <p className="sched-problem" role="alert">{problem}</p>}
    </div>
  );
}
