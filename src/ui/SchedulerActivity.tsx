import { useCallback, useEffect, useMemo, useState } from 'react';
import { NO_FILTER, filterLog, fromDatabase, mergeSources, summarize, toCsv, type LogEntry, type LogFilter } from '../job-log';
import { TARGET_LABEL } from '../jobs';

const fmt = (iso: string) => new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const duration = (ms: number) => (ms < 1000 ? '<1 s' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const RESULT = { ok: 'Succeeded', error: 'Failed', skipped: 'Skipped' } as const;
const PAGE = 100;

/** The Activity tab: who ran which job, when, and how it ended. Local entries plus, in the desktop app, the shared database. */
export default function SchedulerActivity({ log }: { log: LogEntry[] }) {
  const [filter, setFilter] = useState<LogFilter>(NO_FILTER);
  const [remote, setRemote] = useState<LogEntry[]>([]);
  const [me, setMe] = useState('');
  const [source, setSource] = useState<{ kind: 'local' | 'shared'; detail: string }>({ kind: 'local', detail: 'This computer only.' });
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    const host = window.host;
    if (!host?.jobRunsList) { setSource({ kind: 'local', detail: 'This computer only (browser).' }); return; }
    try {
      const st = await host.workStatus?.();
      setMe(st?.email ?? '');
      const res = await host.jobRunsList({ limit: 500 });
      if (!res.ok) { setSource({ kind: 'local', detail: `This computer only. ${res.error}` }); return; }
      setRemote(fromDatabase(res.data.runs));
      setSource({ kind: 'shared', detail: `Shared log: ${res.data.count} entries read.` });
    } catch (e) { setSource({ kind: 'local', detail: `This computer only. ${e instanceof Error ? e.message : String(e)}` }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const all = useMemo(() => mergeSources(log, remote, me), [log, remote, me]);
  const people = useMemo(() => [...new Set(all.map((e) => e.who).filter((w): w is string => Boolean(w)))].sort(), [all]);
  const rows = useMemo(() => filterLog(all, filter), [all, filter]);
  const sum = useMemo(() => summarize(rows), [rows]);
  const set = (p: Partial<LogFilter>) => { setFilter({ ...filter, ...p }); setShown(PAGE); };

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `scheduler-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <section className="sact" aria-label="Scheduler activity">
      <div className="sact-stats">
        <div><strong>{sum.runs}</strong><span>runs</span></div>
        <div><strong>{sum.successRate === null ? '–' : `${Math.round(sum.successRate * 100)} %`}</strong><span>succeeded</span></div>
        <div><strong>{sum.error}</strong><span>failed</span></div>
        <div><strong>{sum.avgMs ? duration(sum.avgMs) : '–'}</strong><span>average time</span></div>
        <div><strong>{sum.jobs}</strong><span>jobs</span></div>
      </div>
      <div className="sact-filters" role="search">
        <input value={filter.text} onChange={(e) => set({ text: e.target.value })} placeholder="Search job, target or note" aria-label="Search the activity" />
        <select value={filter.days} onChange={(e) => set({ days: Number(e.target.value) })} aria-label="Period">
          <option value={0}>All time</option><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
        </select>
        <select value={filter.status} onChange={(e) => set({ status: e.target.value as LogFilter['status'] })} aria-label="Result">
          <option value="">Any result</option><option value="ok">Succeeded</option><option value="error">Failed</option><option value="skipped">Skipped</option>
        </select>
        <select value={filter.type} onChange={(e) => set({ type: e.target.value as LogFilter['type'] })} aria-label="Type">
          <option value="">Any type</option><option value="agent">Agent</option><option value="workflow">Workflow</option><option value="skill">Skill</option>
        </select>
        <select value={filter.trigger} onChange={(e) => set({ trigger: e.target.value as LogFilter['trigger'] })} aria-label="Started by">
          <option value="">Schedule or manual</option><option value="schedule">Schedule</option><option value="manual">Manual</option>
        </select>
        {people.length > 1 && (
          <select value={filter.who} onChange={(e) => set({ who: e.target.value })} aria-label="Person">
            <option value="">Everybody</option>{people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <button onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
        <button onClick={() => void load()}>Reload</button>
      </div>
      <p className={`sched-muted sact-source sact-source-${source.kind}`}>{source.detail} Sample jobs are not logged. In the chat you can ask, for example: “Which jobs failed this week?”</p>
      {rows.length === 0 ? (
        <div className="sched-empty"><strong>{all.length ? 'No run matches the filter' : 'No runs logged yet'}</strong><span>{all.length ? 'Change or clear the filters.' : 'Every run of a job (not of a sample job) is written here, also after the job is deleted.'}</span></div>
      ) : (
        <div className="sact-table" role="table" aria-label="Runs" tabIndex={0}>
          <div className="sact-row sact-th" role="row"><span>Started</span><span>Job</span><span>Target</span><span>Result</span><span>Started by</span><span>Time</span><span>Person</span><span>Note</span></div>
          {rows.slice(0, shown).map((e) => (
            <div className="sact-row" role="row" key={`${e.who ?? ''}|${e.id}`}>
              <span>{fmt(e.at)}</span>
              <span title={e.jobName}>{e.jobName}</span>
              <span title={e.targetLabel}><span className={`sched-type sched-type-${e.targetType}`}>{TARGET_LABEL[e.targetType]}</span> {e.targetLabel}</span>
              <span><i className={`sched-dot sched-dot-${e.status}`} />{RESULT[e.status]}</span>
              <span>{e.trigger === 'manual' ? 'Manual' : 'Schedule'}</span>
              <span>{duration(e.ms)}</span>
              <span title={e.who}>{e.who ?? '–'}</span>
              <span title={e.note}>{e.note}</span>
            </div>
          ))}
        </div>
      )}
      {rows.length > shown && <button className="sact-more" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}</button>}
    </section>
  );
}
