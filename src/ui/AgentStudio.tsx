import { useEffect, useRef, useState } from 'react';
import { AGENT_GOV_KEY, OUTPUTS, TEMPLATES, agentPrompt, buildCatalog, newAgent, problems, simulateRun, type RunResult, type StudioAgent } from '../agent-studio';
import { decide, levelOf, loadGov, pendingFor, requestPromotion, saveGov, type LevelIndex, type SkillGov } from '../skill-governance';
import WerkbankMark from './WerkbankMark';

export type AgentStudioProps = {
  agents: StudioAgent[];
  onAgents: (next: StudioAgent[]) => void;
  connectors: string[];
  spaces: Array<{ slug: string; title: string }>;
  /** Run the brief for real in the chat (restricted to the ticked sources). */
  onRunInChat: (prompt: string) => void;
};

const KIND_TITLE = { space: 'Spaces', connector: 'Connectors', file: 'Files', web: 'Web' } as const;

/** Agent Studio: define a simple agent by form, tick its sources, test it in a sandbox, then ask for approval to publish it. */
export default function AgentStudio({ agents, onAgents, connectors, spaces, onRunInChat }: AgentStudioProps) {
  const [selected, setSelected] = useState<string | null>(agents[0]?.id ?? null);
  const [gov, setGov] = useState<SkillGov>(() => ({ ...loadGov(undefined, AGENT_GOV_KEY), levels: loadGov().levels }));
  const [run, setRun] = useState<RunResult | null>(null);
  const [shown, setShown] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => saveGov(gov, undefined, AGENT_GOV_KEY), [gov]);
  useEffect(() => () => window.clearInterval(timer.current), []);

  const catalog = buildCatalog(connectors, spaces);
  const agent = agents.find((a) => a.id === selected) ?? null;
  const patch = (change: Partial<StudioAgent>) => {
    if (!agent) return;
    const touchesSetup = 'sources' in change || 'instruction' in change || 'canWrite' in change || 'askBeforeWrite' in change;
    onAgents(agents.map((a) => (a.id === agent.id ? { ...a, ...change, ...(touchesSetup ? { tested: false } : {}) } : a)));
    if (touchesSetup) setRun(null);
  };
  const create = (templateId: string | null) => {
    const t = TEMPLATES.find((x) => x.id === templateId) ?? null;
    const a = newAgent(t, catalog);
    onAgents([a, ...agents]);
    setSelected(a.id); setRun(null); setShown(0);
  };
  const open = (id: string) => { setSelected(id); setRun(null); setShown(0); setConfirmDelete(false); };

  const test = () => {
    if (!agent || problems(agent).length) return;
    const result = simulateRun(agent, catalog);
    setRun(result); setShown(1);
    window.clearInterval(timer.current);
    let n = 1;
    timer.current = window.setInterval(() => {
      n += 1; setShown(n);
      if (n >= result.steps.length) { window.clearInterval(timer.current); onAgents(agents.map((a) => (a.id === agent.id ? { ...a, tested: true } : a))); }
    }, 550);
  };

  const status = (a: StudioAgent) => {
    const lvl = levelOf(gov, a.id), req = pendingFor(gov, a.id);
    if (lvl > 0) return { text: gov.levels[lvl], cls: 'on' };
    if (req) return { text: `in review for ${gov.levels[req.to]}`, cls: '' };
    return { text: a.tested ? 'tested' : 'draft', cls: '' };
  };
  const pending = gov.requests.filter((r) => r.status === 'pending');
  const issues = agent ? problems(agent) : [];

  return (
    <main className="main studio">
      <aside className="studio-list">
        <h2 className="studio-h">Agent Studio</h2>
        <p className="studio-sub">Simple agents by form: brief, sources, rights. Test first, then publish.</p>
        <div className="studio-new">
          {TEMPLATES.map((t) => <button key={t.id} className="studio-tpl" onClick={() => create(t.id)}><b>{t.name}</b><small>{t.story}</small></button>)}
          <button className="studio-tpl" onClick={() => create(null)}><b>Blank agent</b><small>start empty</small></button>
        </div>
        {agents.map((a) => (
          <button key={a.id} className={`studio-item ${a.id === selected ? 'on' : ''}`} onClick={() => open(a.id)}>
            <span>{a.name}</span><small className={`mem-badge ${status(a).cls ? 'mem-badge-on' : ''}`}>{status(a).text}</small>
          </button>
        ))}
        {pending.length > 0 && (
          <div className="studio-queue">
            <strong>Approvals</strong>
            {pending.map((r) => (
              <div key={r.id} className="studio-req">
                <span>{agents.find((a) => a.id === r.skill)?.name ?? 'Agent removed'}: {gov.levels[r.from]} → {gov.levels[r.to]}</span>
                <span><button className="ghost-btn" onClick={() => setGov((g) => decide(g, r.id, true, '', Date.now()))}>Approve</button><button className="ghost-btn" onClick={() => setGov((g) => decide(g, r.id, false, '', Date.now()))}>Reject</button></span>
              </div>
            ))}
          </div>
        )}
      </aside>

      <section className="studio-edit">
        {!agent && (
          <div className="studio-intro">
            <WerkbankMark size={40} className="diamond" />
            <h1>Build an agent in five steps</h1>
            <ol>
              <li><b>Brief.</b> What should it do, in your words.</li>
              <li><b>Sources.</b> Tick where it may read. Everything else is closed to it.</li>
              <li><b>Rights.</b> Read only, or propose changes with a question before each one.</li>
              <li><b>Test.</b> A sandbox run on sample data shows what it reads and answers, and what it is refused.</li>
              <li><b>Publish.</b> Move it up a level after approval, run it in chat or on a schedule.</li>
            </ol>
            <p>Start with a template: <b>Renewal watch</b> (use case 1) or <b>Cost watch</b> (use case 2).</p>
          </div>
        )}

        {agent && (
          <>
            <div className="studio-head">
              <input className="studio-name" aria-label="Agent name" value={agent.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} />
              <small className={`mem-badge ${status(agent).cls ? 'mem-badge-on' : ''}`}>{status(agent).text}</small>
            </div>

            <h3 className="studio-step"><span>1</span> Brief</h3>
            <input className="studio-field" aria-label="Purpose" placeholder="Purpose in one sentence" value={agent.purpose} maxLength={300} onChange={(e) => patch({ purpose: e.target.value })} />
            <textarea className="studio-field" aria-label="Instruction" rows={5} placeholder="What should the agent do, step by step? What does a good result look like?" value={agent.instruction} maxLength={2000} onChange={(e) => patch({ instruction: e.target.value })} />

            <h3 className="studio-step"><span>2</span> Sources <small>Only ticked sources are readable for this agent.</small></h3>
            {(['space', 'connector', 'file', 'web'] as const).map((kind) => {
              const list = catalog.filter((s) => s.kind === kind);
              if (!list.length) return null;
              return (
                <div key={kind} className="studio-sources">
                  <b>{KIND_TITLE[kind]}</b>
                  <div>
                    {list.map((s) => (
                      <label key={s.id} className={`studio-src ${agent.sources.includes(s.id) ? 'on' : ''}`} title={s.hint}>
                        <input type="checkbox" checked={agent.sources.includes(s.id)} onChange={() => patch({ sources: agent.sources.includes(s.id) ? agent.sources.filter((x) => x !== s.id) : [...agent.sources, s.id] })} />
                        {s.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <h3 className="studio-step"><span>3</span> Rights and answer</h3>
            <div className="studio-row">
              <label><input type="checkbox" checked={agent.canWrite} onChange={(e) => patch({ canWrite: e.target.checked })} /> May propose changes</label>
              <label><input type="checkbox" checked={agent.askBeforeWrite} disabled={!agent.canWrite} onChange={(e) => patch({ askBeforeWrite: e.target.checked })} /> Ask before every write</label>
              <label>Steps at most <input type="number" min={1} max={30} value={agent.maxSteps} onChange={(e) => patch({ maxSteps: Number(e.target.value) })} style={{ width: 56 }} /></label>
              <label>Answer as <select value={agent.output} onChange={(e) => patch({ output: e.target.value as StudioAgent['output'] })}>{OUTPUTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
              <label>Runs <select value={agent.trigger.type} onChange={(e) => patch({ trigger: { ...agent.trigger, type: e.target.value as StudioAgent['trigger']['type'] } })}><option value="manual">on demand</option><option value="daily">every day</option><option value="weekly">every Monday</option></select>
                {agent.trigger.type !== 'manual' && <> at <input type="time" value={agent.trigger.time} onChange={(e) => patch({ trigger: { ...agent.trigger, time: e.target.value } })} /></>}</label>
            </div>

            <h3 className="studio-step"><span>4</span> Test in the sandbox</h3>
            {issues.map((i) => <p key={i} className="studio-issue">{i}</p>)}
            <div className="studio-row">
              <button className="ghost-btn ghost-btn-on" disabled={issues.length > 0} onClick={test}>Run test</button>
              <button className="ghost-btn" disabled={issues.length > 0} onClick={() => onRunInChat(agentPrompt(agent, catalog))}>Run in chat (real)</button>
            </div>
            {run && (
              <div className="studio-run" aria-live="polite">
                <ol>
                  {run.steps.slice(0, shown).map((s, i) => (
                    <li key={i} className={s.blocked ? 'blocked' : ''}>{s.blocked ? '⛔ ' : ''}{s.text}{s.source && <small className="mem-badge">{s.source}</small>}</li>
                  ))}
                </ol>
                {shown >= run.steps.length && (
                  <div className="studio-result">
                    <h4>{run.title}</h4>
                    {run.table && (
                      <table>
                        <thead><tr>{run.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                        <tbody>{run.table.rows.map((r, i) => <tr key={i}>{r.cells.map((c, j) => <td key={j}>{j === 0 && <i className={`lv lv-${r.level}`} aria-label={r.level} />}{c}</td>)}</tr>)}</tbody>
                      </table>
                    )}
                    {run.lines.map((l) => <p key={l}>{l}</p>)}
                    {run.mail && <pre className="studio-mail">{run.mail}</pre>}
                    <p className="studio-used"><b>Read:</b> {run.sources.join(', ') || 'nothing'}{run.blocked.length > 0 && <> · <b>Refused:</b> {run.blocked.join(', ')}</>}</p>
                  </div>
                )}
              </div>
            )}

            <h3 className="studio-step"><span>5</span> Publish</h3>
            <div className="studio-row">
              {levelOf(gov, agent.id) < 2 && !pendingFor(gov, agent.id) && (
                <button className="ghost-btn" disabled={!agent.tested} title={agent.tested ? '' : 'Run the test first'} onClick={() => setGov((g) => requestPromotion(g, agent.id, agent.purpose, Date.now()))}>
                  Move up to {gov.levels[(levelOf(gov, agent.id) + 1) as LevelIndex]}
                </button>
              )}
              {pendingFor(gov, agent.id) && <span>Waiting for approval (see the list on the left).</span>}
              {levelOf(gov, agent.id) === 2 && <span>Top level reached.</span>}
              {!agent.tested && <small>The test must run through first. Changing sources or instruction resets it.</small>}
              {confirmDelete
                ? <><button className="ghost-btn ghost-btn-on" onClick={() => { onAgents(agents.filter((a) => a.id !== agent.id)); setSelected(null); setConfirmDelete(false); }}>Yes, delete</button><button className="ghost-btn" onClick={() => setConfirmDelete(false)}>Cancel</button></>
                : <button className="ghost-btn" onClick={() => setConfirmDelete(true)}>Delete agent</button>}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
