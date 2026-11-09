/**
 * Start page of the Joule Administration Console (rail label "Admin console"): the places for those who look after what is shared. Four tiles today: Ontologies, Solution register,
 * Skill Health Monitor and Agent observability; more can follow. Agent observability opens the Space of that name (it is a Space, so it keeps its own page and bridge); when the
 * Space is not installed the button says how to install it. Hiring approvals is a Space of its own, not part of Admin. Admin is not part of Develop.
 */
export default function AdminView({ onOpenOntology, onOpenRegistry, onOpenSkills, onOpenObservability, observabilityInstalled }: {
  onOpenOntology: () => void;
  onOpenRegistry: () => void;
  onOpenSkills: () => void;
  onOpenObservability: () => void;
  observabilityInstalled: boolean;
}) {
  return (
    <main className="develop develop-main adm">
      <h1 className="develop-title">Joule Administration Console</h1>
      <p className="develop-sub">Look after what everyone shares. More tiles will follow.</p>
      <div className="adm-grid">
        <section className="develop-card develop-card-block" aria-label="Ontologies">
          <span className="develop-logo adm-logo adm-logo-ontology" aria-hidden="true"><OntologyMark /></span>
          <span className="develop-card-title">Ontologies</span>
          <span className="develop-card-brand">the vocabulary</span>
          <span className="develop-card-text">The shared meaning of your terms, so that every agent reads a metric or a class the same way.</span>
          <ul className="develop-blocks">
            <li><span>Owned terms with a definition and a source</span></li>
            <li><span>See what depends on a term before you change it</span></li>
          </ul>
          <button className="dialog-btn dialog-btn-primary develop-go" onClick={onOpenOntology}>Open Ontologies</button>
        </section>
        <section className="develop-card develop-card-block" aria-label="Solution register">
          <span className="develop-logo adm-logo adm-logo-register" aria-hidden="true"><RegistryMark /></span>
          <span className="develop-card-title">Solution register</span>
          <span className="develop-card-brand">what was built</span>
          <span className="develop-card-text">The register of every agent, workflow and feature that was built in the Werkbank, with its revisions, its owner and the Jira, Slack or Notion items it came from.</span>
          <ul className="develop-blocks">
            <li><span>Compare a revision with the one before</span></li>
            <li><span>Restore an old revision as the newest</span></li>
          </ul>
          <button className="dialog-btn dialog-btn-primary develop-go" onClick={onOpenRegistry}>Open Solution register</button>
        </section>
        <section className="develop-card develop-card-block" aria-label="Skill Health Monitor">
          <span className="develop-logo adm-logo adm-logo-skills" aria-hidden="true"><SkillMark /></span>
          <span className="develop-card-title">Skill Health Monitor</span>
          <span className="develop-card-brand">skill management</span>
          <span className="develop-card-text">Which skills are used, duplicated, unowned or outdated, and what to do about it.</span>
          <ul className="develop-blocks">
            <li><span>Merge duplicates and phase out unused skills</span></li>
            <li><span>Assign owners and ask for the next level</span></li>
          </ul>
          <button className="dialog-btn dialog-btn-primary develop-go" onClick={onOpenSkills}>Open Skill Health Monitor</button>
        </section>
        <section className="develop-card develop-card-block" aria-label="Agent observability">
          <span className="develop-logo adm-logo adm-logo-observe" aria-hidden="true"><ObserveMark /></span>
          <span className="develop-card-title">Agent observability</span>
          <span className="develop-card-brand">what really ran</span>
          <span className="develop-card-text">What the agents, workflows and skills actually did: every run as a trace, whether the outcome was right, cost, speed and blocked actions.</span>
          <ul className="develop-blocks">
            <li><span>Follow one run step by step</span></li>
            <li><span>Spot cost spikes, quality drops and alerts</span></li>
          </ul>
          <button className="dialog-btn dialog-btn-primary develop-go" onClick={onOpenObservability} disabled={!observabilityInstalled}
            title={observabilityInstalled ? undefined : 'Install the Space first: npm run install:agent-observability'}>
            Open Agent observability
          </button>
          {!observabilityInstalled && <span className="develop-card-text adm-hint">Not installed yet: run <code>npm run install:agent-observability</code>.</span>}
        </section>
      </div>
    </main>
  );
}

/** Three bars of a trace waterfall under a pulse line: each step of a run, laid out in time. */
function ObserveMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <path d="M8 16h10l4-7 6 14 4-7h24" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" opacity=".6" />
      <rect x="8" y="30" width="40" height="7" rx="3.5" fill="currentColor" />
      <rect x="18" y="41" width="22" height="7" rx="3.5" fill="currentColor" opacity=".75" />
      <rect x="28" y="52" width="28" height="7" rx="3.5" fill="currentColor" opacity=".5" />
    </svg>
  );
}

/** A term with its definition at the centre, three related terms around it: the shared vocabulary. */
function OntologyMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <path d="M32 32L12 15M32 32l22-14M32 32l-14 21M32 32l21 20" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity=".5" />
      <circle cx="12" cy="15" r="5.5" fill="currentColor" opacity=".6" />
      <circle cx="54" cy="18" r="4.5" fill="currentColor" opacity=".8" />
      <circle cx="18" cy="53" r="4.5" fill="currentColor" opacity=".8" />
      <circle cx="53" cy="52" r="5.5" fill="currentColor" opacity=".6" />
      <circle cx="32" cy="32" r="14" fill="currentColor" />
      <path d="M25 29h14M25 35h9" stroke="var(--panel)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Three layers in perspective with a return arrow: what was built, and every version of it. */
function RegistryMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <path d="M32 8l22 10-22 10L10 18z" fill="currentColor" />
      <path d="M10 28l22 10 22-10" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" opacity=".75" />
      <path d="M10 38l22 10 22-10" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" opacity=".5" />
      <path d="M10 48l22 10 22-10" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" opacity=".3" />
    </svg>
  );
}

/** A hexagonal badge with a pulse line and a status dot: a skill, and how healthy it is. */
function SkillMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <path d="M32 6l22 12.5v27L32 58 10 45.5v-27z" fill="currentColor" />
      <path d="M17 33h9l4-10 6 19 4-9h7" stroke="var(--panel)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="51" cy="14" r="6.5" fill="var(--panel)" />
      <circle cx="51" cy="14" r="3.6" fill="currentColor" opacity=".75" />
    </svg>
  );
}
