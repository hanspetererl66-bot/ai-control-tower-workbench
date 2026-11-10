import { useRef, useState } from 'react';
import type { Source, StudioAgent } from '../agent-studio';
import { runBench, liveRunner, simulationRunner, releaseCheck, starterCases, type BenchReport } from '../agent-testbench';
import { CLASSES, RELEASES, contractOf, type Contract, type NetMessage, type Release } from '../agent-network';
import { isStopped, statsOf, traceRuns, type AgentRun, type Stops } from '../agent-runs';
import type { Sensitivity } from '../agent-project';

/** What the Studio needs from the app to test, run and connect agents. */
export type AgentOps = {
  runs: AgentRun[];
  stops: Stops;
  onStop: (id: string, reason: string) => void;
  onResume: (id: string) => void;
  reports: BenchReport[];
  onReport: (r: BenchReport) => void;
  /** Runs a prompt through the assistant in a conversation of its own (live bench); undefined when the assistant is not connected. */
  live?: (prompt: string, title: string) => Promise<string>;
  network: { on: boolean; onToggle: (on: boolean) => void; installed: boolean; messages: NetMessage[] };
  published: (id: string) => boolean;
};

const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const dots = (a: boolean[], n: number) => Array.from({ length: n }, (_, i) => (a[i] === undefined ? '·' : a[i] ? '●' : '○')).join(' ');

/** Test bench: starter cases, every case several times, a case counts only when all attempts pass. */
export function BenchPanel({ agent, catalog, ops, disabled }: { agent: StudioAgent; catalog: Source[]; ops: AgentOps; disabled: boolean }) {
  const [busy, setBusy] = useState<null | 'simulation' | 'live'>(null);
  const [progress, setProgress] = useState('');
  const stop = useRef(false);
  const mine = ops.reports.filter((r) => r.agentId === agent.id).sort((a, b) => b.at - a.at);
  const check = releaseCheck(agent, ops.reports);
  const last = mine[0];
  const cases = starterCases(agent, catalog);
  async function run(mode: 'simulation' | 'live') {
    if (busy) return;
    stop.current = false; setBusy(mode); setProgress('Starting …');
    try {
      const runner = mode === 'live' && ops.live ? liveRunner(agent, catalog, ops.live) : simulationRunner(agent, catalog);
      const report = await runBench(agent, catalog, runner, mode, { cases, onProgress: (d, t) => setProgress(`${d} of ${t} cases`), stop: () => stop.current });
      if (report.cases.length) ops.onReport(report);
    } finally { setBusy(null); setProgress(''); }
  }
  return (
    <div className="ops-card" aria-label="Test bench">
      <div className="studio-row">
        <button className="ghost-btn ghost-btn-on" disabled={disabled || !!busy} onClick={() => void run('simulation')}>Run bench (simulation)</button>
        <button className="ghost-btn" disabled={disabled || !!busy || !ops.live} title={ops.live ? 'Runs every case three times through the assistant: slow, and it uses the model' : 'The assistant is not connected'} onClick={() => void run('live')}>Run bench (live)</button>
        {busy && <button className="ghost-btn" onClick={() => { stop.current = true; }}>Stop</button>}
        {busy && <small aria-live="polite">{busy === 'live' ? 'Live: ' : ''}{progress}</small>}
      </div>
      <p className={`ops-check ops-check-${check.state}`}>{check.text}</p>
      <table className="ops-table">
        <thead><tr><th>Case</th><th>Attempts</th><th>Result</th></tr></thead>
        <tbody>
          {cases.map((c) => {
            const r = last?.cases.find((x) => x.caseId === c.id);
            return (
              <tr key={c.id}>
                <td>{c.title}{c.liveOnly && <small className="mem-badge" title="Needs the assistant">live only</small>}</td>
                <td className="ops-dots">{r && !r.skipped ? dots(r.attempts, last!.attempts) : ''}</td>
                <td>{!r ? '' : r.skipped ? <small>skipped</small> : r.pass ? <b className="ops-ok">pass</b> : <span className="ops-bad" title={r.notes.join(' ')}>fail</span>}{r && !r.skipped && !r.pass && r.notes[0] && <small className="ops-note"> {r.notes[0]}</small>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <small className="studio-tip">The checks are rules, not a judge: they say whether the brief and the limits held on this version. A change of the brief, the sources, the rights or the contract makes the last report stale.{last ? ` Last run: ${last.mode}, ${ago(last.at)}.` : ''}</small>
    </div>
  );
}

const CLASS_LABEL: Record<Sensitivity, string> = { public: 'Public', internal: 'Internal', confidential: 'Confidential', personal: 'Personal data' };

/** What this agent offers to other agents, and whom it may ask. */
export function ContractPanel({ agent, agents, ops, onChange }: { agent: StudioAgent; agents: StudioAgent[]; ops: AgentOps; onChange: (c: Contract) => void }) {
  const c = contractOf(agent), set = (patch: Partial<Contract>) => onChange({ ...c, ...patch });
  const others = agents.filter((a) => a.id !== agent.id);
  return (
    <div className="ops-card" aria-label="Network contract">
      <div className="studio-row">
        <label><input type="checkbox" checked={c.callable} onChange={(e) => set({ callable: e.target.checked })} /> Other agents may ask this agent</label>
      </div>
      {c.callable && (
        <>
          <input className="studio-field" aria-label="What this agent can tell others" placeholder="What can this agent tell other agents? One sentence." value={c.capability} maxLength={200} onChange={(e) => set({ capability: e.target.value })} />
          <div className="studio-row">
            <input className="studio-field" aria-label="What a good question contains" placeholder="A good question contains …" value={c.accepts} maxLength={200} onChange={(e) => set({ accepts: e.target.value })} />
            <input className="studio-field" aria-label="What the answer looks like" placeholder="The answer is …" value={c.returns} maxLength={200} onChange={(e) => set({ returns: e.target.value })} />
          </div>
          <table className="ops-table">
            <thead><tr><th>Data class</th><th>When another agent asks for it</th></tr></thead>
            <tbody>
              {CLASSES.map((k) => (
                <tr key={k}><td>{CLASS_LABEL[k]}</td><td>
                  <select aria-label={`Release of ${CLASS_LABEL[k]} data`} value={c.releases[k]} onChange={(e) => set({ releases: { ...c.releases, [k]: e.target.value as Release } })}>
                    {RELEASES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                  {c.releases[k] === 'approve' && <small className="ops-note"> No approval inbox yet: nothing is released.</small>}
                </td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="studio-sources">
        <b>May ask</b>
        <div>
          {others.length === 0 && <small>There are no other agents yet.</small>}
          {others.map((o) => (
            <label key={o.id} className={`studio-src ${c.mayCall.includes(o.id) ? 'on' : ''}`} title={contractOf(o).callable ? contractOf(o).capability : 'This agent does not accept questions yet.'}>
              <input type="checkbox" checked={c.mayCall.includes(o.id)} onChange={() => set({ mayCall: c.mayCall.includes(o.id) ? c.mayCall.filter((x) => x !== o.id) : [...c.mayCall, o.id].slice(0, 8) })} />
              {o.name}{!contractOf(o).callable && <small className="mem-badge">closed</small>}{!ops.published(o.id) && <small className="mem-badge">not published</small>}
            </label>
          ))}
        </div>
      </div>
      <small className="studio-tip">Another agent only gets an answer when both agents are published and not stopped, the asking agent lists this one under “May ask”, and this agent accepts the class of data. A chain of questions stops after three hops and six questions per run.</small>
    </div>
  );
}

/** Numbers and last runs of one agent, and the stop switch. */
export function RunsPanel({ agent, ops }: { agent: StudioAgent; ops: AgentOps }) {
  const [reason, setReason] = useState('');
  const stats = statsOf(ops.runs, agent.id), stopped = isStopped(ops.stops, agent.id), mine = ops.runs.filter((r) => r.agentId === agent.id).slice(0, 8);
  const msgs = ops.network.messages.filter((m) => m.from === agent.id || m.to === agent.id).slice(-6);
  return (
    <div className="ops-card" aria-label="Runs and stop switch">
      <div className="studio-row">
        <span><b>{stats.runs}</b> runs in 7 days</span><span><b>{stats.ok}</b> ok</span><span><b>{stats.failed}</b> failed</span><span><b>{stats.refused}</b> refused or stopped</span>{stats.avgMs > 0 && <span>avg {Math.round(stats.avgMs / 1000)} s</span>}
      </div>
      {stopped ? (
        <div className="studio-row"><span className="ops-bad">Stopped: {ops.stops[agent.id].reason}</span><button className="ghost-btn" onClick={() => ops.onResume(agent.id)}>Resume this agent</button></div>
      ) : (
        <div className="studio-row">
          <input className="studio-field" aria-label="Why stop this agent" placeholder="Why stop it? (optional)" value={reason} maxLength={160} onChange={(e) => setReason(e.target.value)} />
          <button className="ghost-btn" title="Its schedule stops, “/agent” refuses it, other agents cannot ask it and it cannot ask others" onClick={() => { ops.onStop(agent.id, reason); setReason(''); }}>Stop this agent</button>
        </div>
      )}
      {mine.length > 0 && (
        <table className="ops-table">
          <thead><tr><th>When</th><th>Started by</th><th>Result</th><th>Run id</th></tr></thead>
          <tbody>{mine.map((r) => <tr key={r.id}><td>{ago(r.at)}</td><td>{r.trigger}{r.hops > 0 ? ` (hop ${r.hops})` : ''}</td><td className={r.status === 'ok' ? 'ops-ok' : r.status === 'running' ? '' : 'ops-bad'} title={r.note}>{r.status}{r.ms > 0 && ` · ${(r.ms / 1000).toFixed(1)} s`}</td><td><small>{r.trace.slice(0, 18)}</small></td></tr>)}</tbody>
        </table>
      )}
      {msgs.length > 0 && (
        <>
          <h4 className="ops-h">Questions between agents</h4>
          <table className="ops-table">
            <thead><tr><th>From</th><th>To</th><th>Why</th><th>Outcome</th></tr></thead>
            <tbody>{msgs.map((m) => <tr key={m.id}><td><small>{m.from}</small></td><td><small>{m.to}</small></td><td>{m.purpose}</td><td className={m.outcome === 'answer' || m.outcome === 'redacted' ? 'ops-ok' : 'ops-bad'} title={m.reason}>{m.outcome}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {mine.length === 0 && msgs.length === 0 && <small className="studio-tip">No run yet. Runs started from the chat with “/agent”, by the schedule, or by another agent are listed here.</small>}
      {traceRuns(ops.runs, mine[0]?.trace ?? '').length > 1 && <small className="studio-tip">The newest run belongs to a chain of {traceRuns(ops.runs, mine[0].trace).length} runs.</small>}
    </div>
  );
}

/** The switch of the whole network. Off by default: agents ask each other only when the person has switched it on. */
export function NetworkSwitch({ ops }: { ops: AgentOps }) {
  const n = ops.network;
  return (
    <div className="ops-switch" role="group" aria-label="Agent network">
      <label><input type="checkbox" checked={n.on} onChange={(e) => n.onToggle(e.target.checked)} /> <b>Agent network</b> (agents may ask each other)</label>
      <small>{n.on ? (n.installed ? 'On. Agents that are published and allowed can ask each other; you see every question below.' : 'On, but the connector “agent-network” is not connected: run npm run connect:connectors and restart the app.') : 'Off. No agent can ask another one.'}</small>
    </div>
  );
}
