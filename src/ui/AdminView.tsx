/**
 * Start page of the Joule Administration Console (rail label "Admin console"): the places for those who look after what is shared. Four tiles today: Ontology Manager, Solution register,
 * Skill Health Monitor and Skills analytics (the analytics tabs of the Skill Marketplace Space); more can follow. Agent observability is not a tile here: it is a subspace of the AI Governance entry page (AI Control Tower). Hiring approvals is a Space of its own,
 * not part of Admin. Admin is not part of Develop.
 */
export default function AdminView({ onOpenOntology, onOpenRegistry, onOpenSkills, onOpenSkillsAnalytics }: { onOpenOntology: () => void; onOpenRegistry: () => void; onOpenSkills: () => void; onOpenSkillsAnalytics?: () => void }) {
  return (
    <main className="develop develop-main adm">
      <h1 className="develop-title">Joule Administration Console</h1>
      <p className="develop-sub">Look after what everyone shares. More tiles will follow.</p>
      <div className="adm-grid">
        <section className="develop-card develop-card-block" aria-label="Ontology Manager">
          <span className="develop-logo adm-logo adm-logo-ontology" aria-hidden="true"><OntologyMark /></span>
          <span className="develop-card-title">Ontology Manager</span>
          <span className="develop-card-brand">the vocabulary</span>
          <span className="develop-card-text">The shared meaning of your terms, so that every agent reads a metric or a class the same way.</span>
          <ul className="develop-blocks">
            <li><span>Owned terms with a definition and a source</span></li>
            <li><span>See what depends on a term before you change it</span></li>
          </ul>
          <button className="dialog-btn dialog-btn-primary develop-go" onClick={onOpenOntology}>Open Ontology Manager</button>
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
        {onOpenSkillsAnalytics && (
          <section className="develop-card develop-card-block" aria-label="Skills analytics">
            <span className="develop-logo adm-logo adm-logo-analytics" aria-hidden="true"><AnalyticsMark /></span>
            <span className="develop-card-title">Skills analytics</span>
            <span className="develop-card-brand">what skills bring</span>
            <span className="develop-card-text">How the skills of the marketplace are used and what they bring: the overview, the ranking, the impact, governance, gaps and hints.</span>
            <ul className="develop-blocks">
              <li><span>See which skills are used and by whom</span></li>
              <li><span>Find gaps and approvals that wait for a decision</span></li>
            </ul>
            <button className="dialog-btn dialog-btn-primary develop-go" onClick={onOpenSkillsAnalytics}>Open Skills analytics</button>
          </section>
        )}
      </div>
    </main>
  );
}

/** Three bars of different height and a rising line over them: what the skills bring. */
function AnalyticsMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <rect x="10" y="38" width="10" height="16" rx="3" fill="currentColor" opacity=".55" />
      <rect x="27" y="28" width="10" height="26" rx="3" fill="currentColor" opacity=".75" />
      <rect x="44" y="16" width="10" height="38" rx="3" fill="currentColor" />
      <path d="M9 30l16-10 12 6 20-16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="57" cy="10" r="3.5" fill="currentColor" />
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
