import { useEffect, useState } from 'react';
import { emptyIntent, loadProjects, newProject, saveProjects, upsertProject, type Project, STAGE_LABEL } from '../develop';
import DevelopWizard from './DevelopWizard';

type Props = {
  onAgentIntent: (intent: string) => void;
  onAgent: () => void;
  onOpenN8n: () => void;
  onOpenConnectors: () => void;
  generate: (prompt: string, title: string) => Promise<string>;
  onStop: () => void;
  ready: boolean;
  onRestartAgent: () => Promise<void> | void;
};

/**
 * Start page of "Develop": three tiles. Agent and Workflow start from a goal ("intent"): the person says what should be
 * achieved. An agent goes into the Agent Studio (confirmed steps up to the build). A workflow goes through requirements,
 * specification and solution architecture in the guided process and ends as an importable n8n workflow.
 * The third tile explains skills and connectors and opens them.
 */
export default function DevelopHub(props: Props) {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects(window.localStorage));
  const [openId, setOpenId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState({ ok: true, at: 0 });
  useEffect(() => { const ok = saveProjects(window.localStorage, projects); setSaveState((s) => ({ ok, at: ok ? Date.now() : s.at })); }, [projects]);
  const open = projects.find((p) => p.id === openId) ?? null;

  const startWorkflow = (goal: string) => {
    const p = newProject('workflow');
    p.intent = { ...emptyIntent(), goal };
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
        <p className="develop-sub">Say what you want to achieve. Joule turns the goal into a draft, you refine and approve it.</p>
        <div className="develop-cards">
          <IntentCard
            kind="agent" logo={<AgentMark />} title="Create an Agent" brand="with the Agent Studio"
            text="From goal to agent in confirmed steps: requirements, design, architecture, test plan, build."
            placeholder="e.g. Watch our renewals and tell me every Monday which ones are at risk"
            action="Start from this goal" other="or open the Agent Studio"
            onIntent={props.onAgentIntent} onOther={props.onAgent}
          />
          <IntentCard
            kind="n8n" logo={<N8nSymbol />} title="Create a Workflow" brand="with n8n"
            text="From intent through requirements and specification to an importable n8n workflow."
            placeholder="e.g. When a contract is uploaded, check the notice period and mail the owner"
            action="Start the guided process" other="or open n8n directly"
            onIntent={startWorkflow} onOther={props.onOpenN8n}
          />
          <section className="develop-card develop-card-skills" aria-label="Skills and Connectors">
            <span className="develop-logo develop-logo-skills" aria-hidden="true"><ConnectorMark /></span>
            <span className="develop-card-title">Skills &amp; Connectors</span>
            <span className="develop-card-brand">the building blocks</span>
            <ul className="develop-blocks">
              <li><b>Skill</b><span>know-how: instructions that tell Joule how to do a task</span></li>
              <li><b>Connector</b><span>tools: a safe link to an app or a data source</span></li>
              <li><b>Agent</b><span>combines both to do a job on its own</span></li>
            </ul>
            <button className="dialog-btn dialog-btn-primary develop-go" onClick={props.onOpenConnectors}>Open Skills &amp; Connectors</button>
          </section>
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
      </div>
    </main>
  );
}

function IntentCard(p: {
  kind: 'agent' | 'n8n'; logo: React.ReactNode; title: string; brand: string; text: string; placeholder: string;
  action: string; other: string; onIntent: (intent: string) => void; onOther: () => void;
}) {
  const [goal, setGoal] = useState('');
  const ok = goal.trim().length >= 8;
  return (
    <section className="develop-card" aria-label={p.title}>
      <span className={`develop-logo develop-logo-${p.kind}`} aria-hidden="true">{p.logo}</span>
      <span className="develop-card-title">{p.title}</span>
      <span className="develop-card-brand">{p.brand}</span>
      <span className="develop-card-text">{p.text}</span>
      <label className="develop-goal">
        <span>What should be achieved?</span>
        <textarea value={goal} rows={3} maxLength={400} placeholder={p.placeholder} onChange={(e) => setGoal(e.target.value)} />
      </label>
      <button className="dialog-btn dialog-btn-primary develop-go" disabled={!ok} onClick={() => { p.onIntent(goal.trim()); setGoal(''); }}>{p.action}</button>
      <button className="develop-other" onClick={p.onOther}>{p.other}</button>
    </section>
  );
}

/** The n8n symbol (the node mark of the brand), drawn here at icon size. */
function N8nSymbol() {
  return (
    <svg viewBox="0 0 304 160" width="88" height="46" role="img" aria-label="n8n">
      <path fillRule="evenodd" clipRule="evenodd" d="M272 64C257.089 64 244.561 53.8018 241.008 40H204.331C196.51 40 189.835 45.6546 188.549 53.3696L187.234 61.2608C185.985 68.7531 182.195 75.2738 176.835 80C182.195 84.7262 185.985 91.2469 187.234 98.7392L188.549 106.63C189.835 114.345 196.51 120 204.331 120H209.008C212.561 106.198 225.089 96 240 96C257.673 96 272 110.327 272 128C272 145.673 257.673 160 240 160C225.089 160 212.56 149.802 209.008 136H204.331C188.688 136 175.338 124.691 172.766 109.261L171.451 101.37C170.165 93.6546 163.49 88 155.669 88H142.992C139.44 101.802 126.911 112 112 112C97.0893 112 84.5605 101.802 81.0081 88H62.9919C59.4395 101.802 46.9107 112 32 112C14.3269 112 0 97.6731 0 80C0 62.3269 14.3269 48 32 48C46.9107 48 59.4395 58.1982 62.9919 72H81.0081C84.5605 58.1982 97.0893 48 112 48C126.911 48 139.44 58.1982 142.992 72H155.669C163.49 72 170.165 66.3454 171.451 58.6304L172.766 50.7392C175.338 35.3092 188.688 24 204.331 24L241.008 24C244.56 10.1982 257.089 0 272 0C289.673 0 304 14.3269 304 32C304 49.6731 289.673 64 272 64ZM272 48C280.837 48 288 40.8366 288 32C288 23.1634 280.837 16 272 16C263.163 16 256 23.1634 256 32C256 40.8366 263.163 48 272 48ZM32 96C40.8366 96 48 88.8366 48 80C48 71.1634 40.8366 64 32 64C23.1634 64 16 71.1634 16 80C16 88.8366 23.1634 96 32 96ZM128 80C128 88.8366 120.837 96 112 96C103.163 96 96 88.8366 96 80C96 71.1634 103.163 64 112 64C120.837 64 128 71.1634 128 80ZM256 128C256 136.837 248.837 144 240 144C231.163 144 224 136.837 224 128C224 119.163 231.163 112 240 112C248.837 112 256 119.163 256 128Z" fill="#EA4B71" />
    </svg>
  );
}

/** Two plugs meeting: a generic connector mark. */
function ConnectorMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <rect x="8" y="22" width="22" height="20" rx="8" fill="currentColor" />
      <rect x="34" y="22" width="22" height="20" rx="8" fill="currentColor" opacity=".55" />
      <path d="M30 28h4M30 36h4" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
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
