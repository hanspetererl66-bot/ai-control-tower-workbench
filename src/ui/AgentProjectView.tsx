import { useEffect, useState } from 'react';
import { OUTPUTS, type Source, type StudioAgent } from '../agent-studio';
import {
  DOC_ORDER, DOC_TITLE, SENSITIVITY, STAGE_ORDER, VOLUME, agentFromProject, allConfirmed, confirmDoc, confirmQuestions, currentStage, editDoc, questionProblems,
  regenerate, setAnswers, stageLabel, type AgentProject, type Answers, type DocKey, type Stage,
} from '../agent-project';
import { ChatMarkdown } from './ChatMarkdown';

export type AgentProjectViewProps = {
  project: AgentProject;
  catalog: Source[];
  onChange: (next: AgentProject) => void;
  /** The agent that results from the confirmed documents; the Studio stores it and opens it. */
  onBuild: (agent: StudioAgent) => void;
  onOpenAgent: (id: string) => void;
  agentExists: boolean;
  onDelete: () => void;
  onRunInChat: (prompt: string) => void;
  /** Which document is open now (null on the questions and build steps), so the docked chat can work on it. */
  onFocus?: (key: DocKey | null) => void;
};

const KIND_TITLE = { space: 'Spaces', connector: 'Connectors', file: 'Files', web: 'Web' } as const;
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const NEXT_NAME: Record<DocKey, string> = { prd: 'the Technical Functional Document', tfd: 'the Solution Architecture', arch: 'the Risk and Test Plan', risk: 'the agent' };

/** The path from a goal to an agent: questions, then four documents, each confirmed before the next, then the build. */
export default function AgentProjectView(p: AgentProjectViewProps) {
  const { project } = p;
  const current = currentStage(project);
  const [view, setView] = useState<Stage>(current);
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setView(current); setPreview(false); setConfirmDelete(false); }, [current, project.id]);
  const reachable = (s: Stage) => s === 'questions' || (s === 'build' ? !!project.docs.risk : !!project.docs[s as DocKey]);
  const shown: Stage = view === 'done' ? 'build' : view;
  const { onFocus } = p;
  useEffect(() => { onFocus?.(DOC_ORDER.includes(shown as DocKey) ? (shown as DocKey) : null); return () => onFocus?.(null); }, [shown, project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = () => Date.now();

  return (
    <div className="proj">
      <div className="studio-head">
        <input className="studio-name" value={project.answers.name} maxLength={60} aria-label="Agent name" onChange={(e) => p.onChange(setAnswers(project, { name: e.target.value }, now()))} />
        <span className="mem-badge">project</span>
      </div>
      <ol className="proj-steps" aria-label="Steps">
        {STAGE_ORDER.map((s, i) => {
          const done = s === 'questions' ? !!project.confirmed.questions : s === 'build' ? !!project.agentId : !!project.confirmed[s as DocKey] && !project.stale.includes(s as DocKey);
          const outdated = s !== 'questions' && s !== 'build' && project.stale.includes(s as DocKey);
          const here = s === shown;
          return (
            <li key={s}>
              <button className={`proj-step ${done ? 'proj-done' : ''} ${here ? 'proj-here' : ''} ${outdated ? 'proj-stale' : ''}`} disabled={!reachable(s)} aria-current={here ? 'step' : undefined} onClick={() => { setView(s); setPreview(false); }}>
                <span>{done ? '✓' : outdated ? '!' : i + 1}</span>{stageLabel(s)}
              </button>
            </li>
          );
        })}
      </ol>

      {shown === 'questions' && <Questions {...p} locked={!!project.confirmed.questions} />}
      {DOC_ORDER.includes(shown as DocKey) && (
        <Doc {...p} docKey={shown as DocKey} preview={preview} onPreview={setPreview} />
      )}
      {shown === 'build' && <Build {...p} ready={allConfirmed(project)} />}

      <div className="proj-foot">
        {confirmDelete
          ? <><button className="ghost-btn ghost-btn-on" onClick={p.onDelete}>Yes, delete the project</button><button className="ghost-btn" onClick={() => setConfirmDelete(false)}>Cancel</button></>
          : <button className="ghost-btn" onClick={() => setConfirmDelete(true)}>Delete project</button>}
        <small>The documents stay on this computer. The agent is only built after you confirmed all of them.</small>
      </div>
    </div>
  );
}

function Questions({ project, catalog, onChange, locked }: AgentProjectViewProps & { locked: boolean }) {
  const a = project.answers;
  const set = (change: Partial<Answers>) => onChange(setAnswers(project, change, Date.now()));
  const issues = questionProblems(a);
  return (
    <div className="proj-body">
      <p className="proj-lead">Start with the goal. The questions below are what the documents are written from: the more precise the answers, the better the first draft.</p>
      {locked && <p className="proj-banner">These answers are confirmed. If you change one, the documents written from them are marked outdated and have to be confirmed again.</p>}

      <h3 className="studio-step"><span>1</span> Goal <small>What should the agent achieve, and for whom?</small></h3>
      <Field label="Objective" hint="What should be achieved? One or two sentences.">
        <textarea className="studio-field" rows={3} maxLength={400} value={a.objective} onChange={(e) => set({ objective: e.target.value })} />
      </Field>
      <Field label="Success measure" hint="How will you know it works? For example: every red renewal has a reason and a next step.">
        <textarea className="studio-field" rows={2} maxLength={400} value={a.success} onChange={(e) => set({ success: e.target.value })} />
      </Field>
      <Field label="Who uses the result?" hint="Role or team. It decides the tone and the depth of the answer.">
        <input className="studio-field" maxLength={200} value={a.users} onChange={(e) => set({ users: e.target.value })} />
      </Field>

      <h3 className="studio-step"><span>2</span> Data <small>Which data sources does the agent need?</small></h3>
      {(['space', 'connector', 'file', 'web'] as const).map((kind) => {
        const list = catalog.filter((s) => s.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="studio-sources">
            <b>{KIND_TITLE[kind]}</b>
            <div>
              {list.map((s) => (
                <label key={s.id} className={`studio-src ${a.sources.includes(s.id) ? 'on' : ''}`} title={s.hint}>
                  <input type="checkbox" checked={a.sources.includes(s.id)} onChange={() => set({ sources: a.sources.includes(s.id) ? a.sources.filter((x) => x !== s.id) : [...a.sources, s.id] })} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <Field label="Another system" hint="Something that is not connected yet, for example SAP S/4HANA. It becomes an open point in the documents.">
        <input className="studio-field" maxLength={200} value={a.otherSystems} onChange={(e) => set({ otherSystems: e.target.value })} />
      </Field>
      <Field label="How sensitive is the data?" hint="Decides which risks and checks the documents list.">
        <select className="studio-field" value={a.sensitivity} onChange={(e) => set({ sensitivity: e.target.value as Answers['sensitivity'] })}>
          {SENSITIVITY.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>

      <h3 className="studio-step"><span>3</span> Running <small>How often, how much, and in which form?</small></h3>
      <div className="studio-row">
        <label>Runs <select value={a.trigger} onChange={(e) => set({ trigger: e.target.value as Answers['trigger'] })}><option value="manual">on demand</option><option value="daily">every day</option><option value="weekly">every Monday</option></select></label>
        {a.trigger !== 'manual' && <label>at <input type="time" value={a.time} onChange={(e) => set({ time: e.target.value })} /></label>}
        <label>Volume <select value={a.volume} onChange={(e) => set({ volume: e.target.value as Answers['volume'] })}>{VOLUME.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        <label>Answer as <select value={a.output} onChange={(e) => set({ output: e.target.value as Answers['output'] })}>{OUTPUTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      </div>

      <h3 className="studio-step"><span>4</span> Rights and safety <small>What may the agent do, and what if data is missing?</small></h3>
      <div className="studio-row">
        <label><input type="radio" name="rights" checked={a.rights === 'read'} onChange={() => set({ rights: 'read' })} /> Read only (safest)</label>
        <label><input type="radio" name="rights" checked={a.rights === 'propose'} onChange={() => set({ rights: 'propose' })} /> May propose changes (asks before every write)</label>
      </div>
      <div className="studio-row">
        <label><input type="radio" name="missing" checked={a.onMissing === 'stop'} onChange={() => set({ onMissing: 'stop' })} /> If data is missing: stop and tell me</label>
        <label><input type="radio" name="missing" checked={a.onMissing === 'continue'} onChange={() => set({ onMissing: 'continue' })} /> Continue and say what is missing</label>
      </div>

      <h3 className="studio-step"><span>5</span> Dependencies and owner <small>Who and what does the agent depend on?</small></h3>
      <Field label="Dependencies" hint="Other agents, systems, files or people it needs. Leave empty if none.">
        <textarea className="studio-field" rows={2} maxLength={300} value={a.dependencies} onChange={(e) => set({ dependencies: e.target.value })} />
      </Field>
      <Field label="Owner" hint="Who is responsible for the agent? Shown in the registry.">
        <input className="studio-field" maxLength={80} value={a.owner} onChange={(e) => set({ owner: e.target.value })} />
      </Field>

      {issues.map((i) => <p key={i} className="studio-issue">{i}</p>)}
      <div className="proj-actions">
        <button className="dialog-btn dialog-btn-primary" disabled={issues.length > 0 || locked} onClick={() => onChange(confirmQuestions(project, catalog, Date.now()))}>
          {locked ? 'Answers confirmed' : 'Answers are complete: write the PRD'}
        </button>
        {locked && !project.confirmed.prd && <small>Continue with the PRD in the step above.</small>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return <label className="proj-field"><span><b>{label}</b> <small>{hint}</small></span>{children}</label>;
}

function Doc(p: AgentProjectViewProps & { docKey: DocKey; preview: boolean; onPreview: (v: boolean) => void }) {
  const { project, catalog, docKey: k } = p;
  const text = project.docs[k] ?? '';
  const confirmed = project.confirmed[k];
  const stale = project.stale.includes(k);
  const edit = (t: string) => p.onChange(editDoc(project, k, t, Date.now()));
  return (
    <div className="proj-body">
      <div className="proj-dochead">
        <h3>{DOC_TITLE[k]}</h3>
        <span className={`mem-badge ${confirmed && !stale ? 'mem-badge-on' : ''}`}>{stale ? 'outdated' : confirmed ? `confirmed ${when(confirmed)}` : 'draft: not confirmed'}</span>
        <div className="proj-toggle" role="group" aria-label="View">
          <button className={!p.preview ? 'on' : ''} aria-pressed={!p.preview} onClick={() => p.onPreview(false)}>Edit</button>
          <button className={p.preview ? 'on' : ''} aria-pressed={p.preview} onClick={() => p.onPreview(true)}>Preview</button>
        </div>
      </div>
      {stale && <p className="proj-banner proj-banner-warn">An earlier step changed after this document was written. Write it again from the answers, or review and edit it, then confirm.</p>}
      {confirmed && !stale && <p className="proj-banner">Confirmed. If you edit it, this step and the steps after it have to be confirmed again.</p>}
      {p.preview
        ? <div className="proj-preview"><ChatMarkdown text={text} /></div>
        : <textarea className="proj-editor" value={text} spellCheck={false} aria-label={DOC_TITLE[k]} onChange={(e) => edit(e.target.value)} />}
      <div className="proj-confirm" role="group" aria-label="Confirmation">
        <b>Is this document OK?</b>
        <span>Confirm it to write {NEXT_NAME[k]}. You can still change it later; then this step opens again.</span>
        <div className="proj-actions">
          <button className="dialog-btn dialog-btn-primary" disabled={!!confirmed && !stale || !text.trim() || stale} onClick={() => p.onChange(confirmDoc(project, k, catalog, Date.now()))}>
            {confirmed && !stale ? 'Confirmed' : `Yes, confirm and write ${NEXT_NAME[k]}`}
          </button>
          <button className="ghost-btn" onClick={() => p.onChange(regenerate(project, k, catalog, Date.now()))}>Write again from the answers</button>
          <button className="ghost-btn" onClick={() => p.onRunInChat(`Review this ${DOC_TITLE[k]} for an agent that is being planned. List gaps, contradictions and unclear points, and suggest concrete changes. Do not rewrite the whole document and do not change anything.\n\n${text}`)}>Ask Joule to review</button>
        </div>
      </div>
    </div>
  );
}

function Build(p: AgentProjectViewProps & { ready: boolean }) {
  const { project, catalog } = p;
  const a = project.answers;
  const agent = agentFromProject(project, catalog);
  return (
    <div className="proj-body">
      <div className="proj-dochead"><h3>Build the agent</h3></div>
      {!p.ready && <p className="proj-banner proj-banner-warn">The agent is built when the answers and all four documents are confirmed.</p>}
      <ul className="proj-sum">
        <li><b>Name</b><span>{a.name}</span></li>
        <li><b>Objective</b><span>{a.objective}</span></li>
        <li><b>Sources</b><span>{agent ? agent.sources.map((id) => catalog.find((s) => s.id === id)?.label ?? id).join(', ') || 'none from the catalog' : '—'}</span></li>
        <li><b>Rights</b><span>{a.rights === 'read' ? 'read only' : 'proposes changes, asks before every write'}</span></li>
        <li><b>Runs</b><span>{a.trigger === 'manual' ? 'on demand' : a.trigger === 'daily' ? `every day at ${a.time}` : `every Monday at ${a.time}`}</span></li>
        <li><b>Next</b><span>The agent starts as a draft. Then you run the sandbox test and ask for approval. Only an approved agent runs on its schedule.</span></li>
      </ul>
      <div className="proj-actions">
        {project.agentId && p.agentExists
          ? <button className="dialog-btn dialog-btn-primary" onClick={() => p.onOpenAgent(project.agentId!)}>Open the agent</button>
          : <button className="dialog-btn dialog-btn-primary" disabled={!agent} onClick={() => agent && p.onBuild(agent)}>Build the agent draft</button>}
      </div>
    </div>
  );
}
