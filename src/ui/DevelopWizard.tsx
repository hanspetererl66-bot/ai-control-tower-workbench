import { useEffect, useRef, useState } from 'react';
import {
  GUARDRAILS, STAGES, STAGE_LABEL, SYSTEMS, TRIGGERS, approve, artifactOf, buildPrompt, canEnter, changeIntent, checkSkillMd, checkWorkflowJson,
  artifactFileName, extraQuestion, intentProblems, prdPrompt, projectFiles, setDocument, skillSlug, specPrompt, type Project, type Stage,
} from '../develop';
import { docToMarkdown, htmlToMarkdown, markdownToHtml, toHtml } from '../doc-html';
import { exportDocument, saveFile, wrapHtml, type ExportFormat } from '../doc-export';
import { makeZip } from '../zip';
import { ChatMarkdown } from './ChatMarkdown';
import { RichDoc } from './RichDoc';

type Props = {
  project: Project;
  onChange: (project: Project) => void;
  onClose: () => void;
  /** Runs a prompt through the chat agent and returns its answer ('' when stopped). Rejects when the agent is unavailable. */
  generate: (prompt: string, title: string) => Promise<string>;
  onStop: () => void;
  ready: boolean;
  onOpenN8n: () => void;
  onOpenConnectors: () => void;
  onRestartAgent: () => Promise<void> | void;
  /** Did the last store into the app's storage work, and when. */
  saveState: { ok: boolean; at: number };
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function DevelopWizard({ project, onChange, onClose, generate, onStop, ready, onOpenN8n, onOpenConnectors, onRestartAgent, saveState }: Props) {
  const [folder, setFolder] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const projectRef = useRef(project);
  projectRef.current = project;
  const stage = project.stage;
  const kindWord = project.kind === 'workflow' ? 'workflow' : 'agent';

  function go(next: Stage) {
    if (!canEnter(project, next) || working) return;
    setError(''); setNote(''); setFeedback(''); setEditing(false);
    onChange({ ...project, stage: next, updatedAt: Date.now() });
  }

  async function run(which: 'requirements' | 'specification' | 'build', useFeedback: boolean) {
    const p = projectRef.current;
    const previous = which === 'requirements' ? docToMarkdown(p.docs.prd) : which === 'specification' ? docToMarkdown(p.docs.spec) : p.docs.build;
    const fb = useFeedback ? feedback : '';
    const prompt = which === 'requirements' ? prdPrompt(p.kind, p.intent, fb, previous)
      : which === 'specification' ? specPrompt(p.kind, p.intent, docToMarkdown(p.docs.prd), fb, previous)
      : buildPrompt(p.kind, p.intent, docToMarkdown(p.docs.prd), docToMarkdown(p.docs.spec), fb, previous);
    setWorking(true); setError(''); setNote('');
    try {
      const label = which === 'requirements' ? 'requirements' : which === 'specification' ? 'specification' : 'build';
      const text = (await generate(prompt, `Develop: ${p.intent.name.trim() || p.kind} (${label})`)).trim();
      if (!alive.current) return;
      if (!text) setNote('Stopped. Nothing was changed.');
      else if (text.startsWith('⚠️')) setError(text.replace(/^⚠️\s*/, ''));
      else { onChange(setDocument({ ...projectRef.current, stage: which }, which, which === 'build' ? text : markdownToHtml(text))); setFeedback(''); setEditing(false); }
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? 'The agent could not answer.');
    } finally {
      if (alive.current) setWorking(false);
    }
  }

  async function startFromIntent() {
    const p = approve(projectRef.current, 'intent');
    onChange({ ...p, stage: 'requirements' });
    projectRef.current = { ...p, stage: 'requirements' };
    await run('requirements', false);
  }

  const doc = stage === 'requirements' ? project.docs.prd : stage === 'specification' ? project.docs.spec : project.docs.build;
  const next: Stage | null = stage === 'requirements' ? 'specification' : stage === 'specification' ? 'build' : null;

  return (
    <div className="dev-wizard">
      <header className="dev-head">
        <button className="ghost-btn" onClick={onClose} disabled={working}>&larr; Develop</button>
        <h1 className="dev-title">{project.intent.name.trim() || `New ${kindWord}`}</h1>
        <span className="dev-kind">{project.kind === 'workflow' ? 'n8n workflow' : 'Agent'}</span>
        <button className="ghost-btn small dev-folder-btn" onClick={() => setFolder((v) => !v)} aria-expanded={folder}>Project folder</button>
      </header>
      {folder && <ProjectFolder project={project} />}
      <SaveLine state={saveState} />
      <ol className="dev-steps" aria-label="Steps">
        {STAGES.map((s, i) => (
          <li key={s}>
            <button className={`dev-step ${s === stage ? 'dev-step-on' : ''} ${project.approved.includes(s) ? 'dev-step-done' : ''}`} disabled={!canEnter(project, s) || working} onClick={() => go(s)} aria-current={s === stage ? 'step' : undefined}>
              <span className="dev-step-n">{project.approved.includes(s) ? '✓' : i + 1}</span>{STAGE_LABEL[s]}
            </button>
          </li>
        ))}
      </ol>
      {!ready && <p className="dev-warn" role="status">The agent is not connected yet. You can fill in the intent now and generate the documents once it is.</p>}
      {error && <p className="dev-error" role="alert">{error}</p>}
      {note && <p className="dev-note" role="status">{note}</p>}

      {stage === 'intent' && <IntentMask project={project} onChange={onChange} onDone={startFromIntent} disabled={working || !ready} />}

      {stage !== 'intent' && (
        <section className="dev-doc" aria-label={STAGE_LABEL[stage]}>
          {working ? (
            <div className="dev-busy" role="status"><span className="dev-spinner" aria-hidden="true" />
              <span>{stage === 'requirements' ? 'Writing the requirements…' : stage === 'specification' ? 'Writing the specification and the solution architecture…' : `Building the ${kindWord}…`}</span>
              <button className="ghost-btn ghost-danger" onClick={onStop}>Stop</button>
            </div>
          ) : !doc.trim() ? (
            <div className="dev-empty">
              <p>{stage === 'requirements' ? 'The requirements are written from your intent.' : stage === 'specification' ? 'The specification and the solution architecture are written from the approved requirements.' : `The ${kindWord} is built from the approved specification.`}</p>
              <button className="dev-primary" onClick={() => void run(stage, false)} disabled={!ready}>
                {stage === 'requirements' ? 'Write the requirements' : stage === 'specification' ? 'Write the specification' : `Build the ${kindWord}`}
              </button>
            </div>
          ) : (
            <>
              {stage === 'build' ? (
                <>
                  <div className="dev-doc-bar">
                    <button className="ghost-btn small" onClick={() => setEditing((v) => !v)}>{editing ? 'Show' : 'Edit text'}</button>
                    <button className="ghost-btn small" onClick={() => saveFile(`${skillSlug(project.intent.name) || 'project'}-build-answer.md`, doc, 'text/markdown;charset=utf-8')}>Save answer (.md)</button>
                  </div>
                  <BuildResult project={project} onOpenN8n={onOpenN8n} onOpenConnectors={onOpenConnectors} onRestartAgent={onRestartAgent} />
                  {editing
                    ? <textarea className="dev-edit" value={doc} onChange={(e) => onChange(setDocument(project, 'build', e.target.value))} aria-label="Edit the build answer" />
                    : <details className="dev-answer"><summary>The full answer of the agent</summary><div className="dev-rendered"><ChatMarkdown text={doc} /></div></details>}
                </>
              ) : (
                <>
                  <div className="dev-doc-bar">
                    <ExportMenu onExport={(f) => exportDocument(f, toHtml(doc), `${skillSlug(project.intent.name) || 'project'}-${stage === 'requirements' ? 'PRD' : 'specification'}`, `${stage === 'requirements' ? 'PRD' : 'Specification'}: ${project.intent.name.trim() || 'project'}`)} />
                    {project.approved.includes(stage) && <span className="dev-approved">✓ Approved</span>}
                  </div>
                  <RichDoc key={`${project.id}-${stage}`} value={toHtml(doc)} onChange={(html) => onChange(setDocument(projectRef.current, stage as 'requirements' | 'specification', html))} label={STAGE_LABEL[stage]} />
                </>
              )}
              <div className="dev-feedback">
                <label>Something to change?
                  <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} placeholder="For example: add a requirement for an audit log, or: the approval must come from the account owner." />
                </label>
                <button className="ghost-btn" onClick={() => void run(stage as 'requirements' | 'specification' | 'build', true)} disabled={!feedback.trim() || !ready}>Write it again with these changes</button>
              </div>
              {next && (
                <div className="dev-next">
                  {!project.approved.includes(stage) && <button className="dev-primary" onClick={() => { const p = approve(project, stage); onChange({ ...p, stage: next }); }}>Approve and continue to {STAGE_LABEL[next]}</button>}
                  {project.approved.includes(stage) && <button className="dev-primary" onClick={() => go(next)}>Continue to {STAGE_LABEL[next]}</button>}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function IntentMask({ project, onChange, onDone, disabled }: { project: Project; onChange: (p: Project) => void; onDone: () => void; disabled: boolean }) {
  const i = project.intent;
  const problems = intentProblems(i);
  const [shown, setShown] = useState(false);
  const set = (patch: Partial<typeof i>) => onChange(changeIntent(project, patch));
  const extra = extraQuestion(project.kind);
  const toggle = (s: string) => set({ systems: i.systems.includes(s) ? i.systems.filter((x) => x !== s) : [...i.systems, s] });
  return (
    <form className="dev-mask" onSubmit={(e) => { e.preventDefault(); if (problems.length) setShown(true); else onDone(); }}>
      <p className="dev-lead">Tell me what you want to achieve. Nothing is built yet: first the requirements are written, then the specification and the solution architecture. You approve each step.</p>
      <label>Short name<input value={i.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder={project.kind === 'workflow' ? 'Contract notice check' : 'Contract assistant'} /></label>
      <label>What should be achieved?<textarea rows={3} value={i.goal} onChange={(e) => set({ goal: e.target.value })} placeholder="In one or two sentences: the result you want, and for whom." /></label>
      <label>What starts it?
        <select value={i.trigger} onChange={(e) => set({ trigger: e.target.value })}>{TRIGGERS.map((t) => <option key={t}>{t}</option>)}</select>
      </label>
      <fieldset>
        <legend>Which systems are involved?</legend>
        <div className="dev-chips">{SYSTEMS.map((s) => <button type="button" key={s} className={`dev-chip ${i.systems.includes(s) ? 'dev-chip-on' : ''}`} aria-pressed={i.systems.includes(s)} onClick={() => toggle(s)}>{s}</button>)}</div>
        <input value={i.otherSystems} onChange={(e) => set({ otherSystems: e.target.value })} placeholder="Others, separated by commas" aria-label="Other systems" />
      </fieldset>
      <label>What data goes in, and what should come out?<textarea rows={3} value={i.data} onChange={(e) => set({ data: e.target.value })} placeholder="For example: contract list (ID, end date, notice period) in, a digest per owner out." /></label>
      <label>How much may it do on its own?
        <select value={i.guardrail} onChange={(e) => set({ guardrail: e.target.value })}>{GUARDRAILS.map((g) => <option key={g}>{g}</option>)}</select>
      </label>
      <label>How will you know that it works?<textarea rows={2} value={i.success} onChange={(e) => set({ success: e.target.value })} placeholder="Something you can check, for example: no deadline is missed." /></label>
      <label>Who is involved? <span className="dev-opt">optional</span><textarea rows={2} value={i.stakeholders} onChange={(e) => set({ stakeholders: e.target.value })} placeholder="Who uses it, who approves, who is affected. For example: legal team, contract owners, procurement lead." /></label>
      <label>What should it explicitly not do? <span className="dev-opt">optional</span><textarea rows={2} value={i.outOfScope} onChange={(e) => set({ outOfScope: e.target.value })} placeholder="For example: no terminations, no changes in S/4HANA, no personal data." /></label>
      <label>{extra.label}<textarea rows={2} value={i.extra} onChange={(e) => set({ extra: e.target.value })} placeholder={extra.hint} /></label>
      {shown && problems.length > 0 && <ul className="dev-error" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="dev-next"><button className="dev-primary" type="submit" disabled={disabled}>Write the requirements</button></div>
    </form>
  );
}

function BuildResult({ project, onOpenN8n, onOpenConnectors, onRestartAgent }: { project: Project; onOpenN8n: () => void; onOpenConnectors: () => void; onRestartAgent: () => Promise<void> | void }) {
  const artifact = artifactOf(project.kind, project.docs.build);
  const [msg, setMsg] = useState('');
  const [installed, setInstalled] = useState(false);
  if (!artifact) return <p className="dev-error" role="alert">I could not find the {project.kind === 'workflow' ? 'workflow JSON' : 'SKILL.md'} in the answer. Write it again with a change request such as "Give me the complete file in one code block".</p>;
  const check = project.kind === 'workflow' ? checkWorkflowJson(artifact) : checkSkillMd(artifact);
  const slug = artifactFileName(project);

  async function install(replace = false) {
    setMsg('');
    try {
      const res = await fetch(`/__skills/install${replace ? '?replace=1' : ''}`, { method: 'POST', body: artifact });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && !replace) {
        if (window.confirm(`A skill "${body.name ?? ''}" already exists.\nOK = replace it, Cancel = keep it.`)) return install(true);
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? 'The skill could not be installed.');
      setInstalled(true);
      setMsg(`Installed the skill "${body.name}". Restart the agent so that it can use it.`);
    } catch (e: any) {
      setMsg(e?.message ?? 'The skill could not be installed.');
    }
  }

  return (
    <div className="dev-result" aria-label="Result">
      <h3>{project.kind === 'workflow' ? 'The workflow file' : 'The skill'}</h3>
      <ul className="dev-checks">
        {check.ok && <li className="dev-ok">Looks fine.</li>}
        {check.problems.map((p) => <li key={p} className="dev-bad">{p}</li>)}
        {check.warnings.map((p) => <li key={p} className="dev-warnline">{p}</li>)}
      </ul>
      <div className="dev-actions">
        {project.kind === 'workflow' ? (
          <>
            <button className="dev-primary" onClick={() => { download(slug, artifact); setMsg('Downloaded. In n8n: Workflows → Import from file.'); }} disabled={!check.ok}>Download workflow file</button>
            <button className="ghost-btn" onClick={() => void navigator.clipboard?.writeText(artifact).then(() => setMsg('Copied. In n8n: paste with Ctrl/Cmd+V on the canvas.'))} disabled={!check.ok}>Copy</button>
            <button className="ghost-btn" onClick={onOpenN8n}>Open n8n</button>
          </>
        ) : (
          <>
            <button className="dev-primary" onClick={() => void install()} disabled={!check.ok || installed}>Install the skill</button>
            {installed && <button className="ghost-btn" onClick={() => void onRestartAgent()}>Restart the agent</button>}
            <button className="ghost-btn" onClick={onOpenConnectors}>Open Connectors &amp; Skills</button>
            <button className="ghost-btn" onClick={() => download(slug, artifact)}>Download</button>
          </>
        )}
      </div>
      {msg && <p className="dev-note" role="status">{msg}</p>}
    </div>
  );
}

function SaveLine({ state }: { state: { ok: boolean; at: number } }) {
  if (!state.ok) return <p className="dev-error" role="alert">Your changes could not be stored in the app (the storage is full or blocked). Download the project folder now so that nothing is lost, and delete old projects or large images.</p>;
  return <p className="dev-saved" role="status">Saved automatically{state.at ? ` at ${new Date(state.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}. Every change is stored while you type.</p>;
}

function ExportMenu({ onExport }: { onExport: (f: ExportFormat) => void }) {
  const items: [ExportFormat, string][] = [['pdf', 'PDF (print dialog)'], ['word', 'Word (.doc)'], ['html', 'Web page (.html)'], ['md', 'Markdown (.md)']];
  return (
    <details className="dev-export">
      <summary className="ghost-btn small">Save / export ▾</summary>
      <div className="dev-export-list" role="menu">
        {items.map(([f, label]) => <button key={f} role="menuitem" onClick={(e) => { onExport(f); (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; }}>{label}</button>)}
      </div>
    </details>
  );
}

function ProjectFolder({ project }: { project: Project }) {
  const files = projectFiles(project, wrapHtml, (t) => htmlToMarkdown(toHtml(t), { images: 'keep' }));
  const slug = skillSlug(project.intent.name) || 'project';
  return (
    <section className="dev-tree" aria-label="Project folder">
      <ul>
        {files.map((f) => (
          <li key={f.path}>
            <span className="dev-tree-path">{f.path}</span>
            <span className="dev-tree-size">{Math.max(1, Math.round(f.text.length / 1024))} KB</span>
            <button className="ghost-btn small" onClick={() => saveFile(f.path.split('/').pop() ?? 'file', f.text, 'text/plain;charset=utf-8')}>Save</button>
          </li>
        ))}
      </ul>
      <button className="dev-primary" onClick={() => saveFile(`${slug}.zip`, makeZip(files) as BlobPart, 'application/zip')}>Download the whole folder (.zip)</button>
    </section>
  );
}
