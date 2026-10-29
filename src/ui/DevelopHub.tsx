import { useEffect, useState } from 'react';
import { loadProjects, newProject, saveProjects, upsertProject, type Kind, type Project, STAGE_LABEL } from '../develop';
import DevelopWizard from './DevelopWizard';

type Props = {
  onOpenN8n: () => void;
  onOpenConnectors: () => void;
  generate: (prompt: string, title: string) => Promise<string>;
  onStop: () => void;
  ready: boolean;
  onRestartAgent: () => Promise<void> | void;
};

/**
 * Start page of "Develop". Nothing is built straight away: a workflow or an agent goes through
 * intent, requirements, specification and solution architecture first, and is built from those documents.
 */
export default function DevelopHub(props: Props) {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects(window.localStorage));
  const [openId, setOpenId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState({ ok: true, at: 0 });
  useEffect(() => { const ok = saveProjects(window.localStorage, projects); setSaveState((s) => ({ ok, at: ok ? Date.now() : s.at })); }, [projects]);
  const open = projects.find((p) => p.id === openId) ?? null;

  const start = (kind: Kind) => {
    const p = newProject(kind);
    setProjects((list) => upsertProject(list, p));
    setOpenId(p.id);
  };

  if (open) {
    return (
      <main className="main develop-main develop-top">
        <DevelopWizard
          project={open}
          onChange={(p) => setProjects((list) => upsertProject(list, p))}
          saveState={saveState}
          onClose={() => setOpenId(null)}
          generate={props.generate}
          onStop={props.onStop}
          ready={props.ready}
          onOpenN8n={props.onOpenN8n}
          onOpenConnectors={props.onOpenConnectors}
          onRestartAgent={props.onRestartAgent}
        />
      </main>
    );
  }

  return (
    <main className="main develop-main">
      <div className="develop">
        <h1 className="develop-title">Develop</h1>
        <p className="develop-sub">What do you want to build? We start with your intent, then requirements, specification and solution architecture, and build from those.</p>
        <div className="develop-cards">
          <button className="develop-card" onClick={() => start('workflow')} aria-label="Create a Workflow with n8n">
            <span className="develop-logo develop-logo-n8n" aria-hidden="true"><WorkflowMark /></span>
            <span className="develop-card-title">Create a Workflow</span>
            <span className="develop-card-brand">with n8n</span>
            <span className="develop-card-text">From intent to an importable n8n workflow.</span>
          </button>
          <button className="develop-card" onClick={() => start('agent')} aria-label="Create an Agent">
            <span className="develop-logo develop-logo-agent" aria-hidden="true"><AgentMark /></span>
            <span className="develop-card-title">Create an Agent</span>
            <span className="develop-card-brand">with connectors &amp; skills</span>
            <span className="develop-card-text">From intent to an installed skill for your agent.</span>
          </button>
        </div>
        {projects.length > 0 && (
          <section className="develop-recent" aria-label="Your projects">
            <h2>Your projects</h2>
            <ul>
              {projects.map((p) => (
                <li key={p.id}>
                  <button className="develop-project" onClick={() => setOpenId(p.id)}>
                    <span className="develop-project-name">{p.intent.name.trim() || `New ${p.kind}`}</span>
                    <span className="develop-project-meta">{p.kind === 'workflow' ? 'n8n workflow' : 'Agent'} · {STAGE_LABEL[p.stage]}</span>
                  </button>
                  <button className="mini-icon mini-icon-danger mini-icon-always" aria-label={`Delete ${p.intent.name || 'project'}`} title="Delete this project" onClick={() => { if (window.confirm('Delete this project and its documents?')) setProjects((list) => list.filter((x) => x.id !== p.id)); }}>
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2.5 4h11M6 4V2.6h4V4M4 4l.6 9.4h6.8L12 4M6.8 6.5v4.3M9.2 6.5v4.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="develop-direct">Already know what to do? <button className="link-btn" onClick={props.onOpenN8n}>Open n8n directly</button> · <button className="link-btn" onClick={props.onOpenConnectors}>Open Connectors &amp; Skills</button></p>
      </div>
    </main>
  );
}

/** Connected nodes, drawn here: a generic workflow mark, not a brand logo. */
function WorkflowMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <circle cx="12" cy="32" r="8" fill="currentColor" />
      <circle cx="40" cy="14" r="8" fill="currentColor" />
      <circle cx="40" cy="50" r="8" fill="currentColor" />
      <circle cx="56" cy="32" r="5" fill="currentColor" opacity=".55" />
      <path d="M19 28l14-9M19 36l14 9M47 18l5 9M47 46l5-9" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

/** A friendly agent: head with antenna, eyes and a spark. */
function AgentMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <path d="M32 6v7" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="32" cy="5.5" r="3.2" fill="currentColor" />
      <rect x="10" y="14" width="44" height="34" rx="12" fill="currentColor" />
      <circle cx="23" cy="30" r="4.6" fill="#fff" />
      <circle cx="41" cy="30" r="4.6" fill="#fff" />
      <path d="M25 40c2 2 4.2 3 7 3s5-1 7-3" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M5 28v8M59 28v8" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M32 54l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="currentColor" opacity=".55" />
    </svg>
  );
}
