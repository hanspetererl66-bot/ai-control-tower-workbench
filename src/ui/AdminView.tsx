/**
 * Start page of "Admin": the places for those who look after what is shared. Three tiles today: Ontologies, Registry and Skill management;
 * more can follow. Admin is not part of Develop.
 */
export default function AdminView({ onOpenOntology, onOpenRegistry, onOpenSkills }: { onOpenOntology: () => void; onOpenRegistry: () => void; onOpenSkills: () => void }) {
  return (
    <main className="develop develop-main adm">
      <h1 className="develop-title">Admin</h1>
      <p className="develop-sub">Look after what everyone shares. More tiles will follow.</p>
      <div className="adm-grid">
        <section className="develop-card develop-card-block" aria-label="Ontologies">
          <span className="develop-logo develop-logo-ontologies" aria-hidden="true"><OntologyMark /></span>
          <span className="develop-card-title">Ontologies</span>
          <span className="develop-card-brand">the vocabulary</span>
          <span className="develop-card-text">The shared meaning of your terms, so that every agent reads a metric or a class the same way.</span>
          <ul className="develop-blocks">
            <li><span>Owned terms with a definition and a source</span></li>
            <li><span>See what depends on a term before you change it</span></li>
          </ul>
          <button className="dialog-btn dialog-btn-primary develop-go" onClick={onOpenOntology}>Open Ontologies</button>
        </section>
        <section className="develop-card develop-card-block" aria-label="Registry">
          <span className="develop-logo develop-logo-ontologies" aria-hidden="true"><RegistryMark /></span>
          <span className="develop-card-title">Registry</span>
          <span className="develop-card-brand">the history</span>
          <span className="develop-card-text">Every agent, workflow and feature that was built, with its revisions, owner and the tickets it came from.</span>
          <ul className="develop-blocks">
            <li><span>Compare a revision with the one before</span></li>
            <li><span>Restore an old revision as the newest</span></li>
          </ul>
          <button className="dialog-btn dialog-btn-primary develop-go" onClick={onOpenRegistry}>Open Registry</button>
        </section>
        <section className="develop-card develop-card-block" aria-label="Skill management">
          <span className="develop-logo develop-logo-ontologies" aria-hidden="true"><SkillMark /></span>
          <span className="develop-card-title">Skill management</span>
          <span className="develop-card-brand">the health</span>
          <span className="develop-card-text">Which skills are used, duplicated, unowned or outdated, and what to do about it.</span>
          <ul className="develop-blocks">
            <li><span>Merge duplicates and phase out unused skills</span></li>
            <li><span>Assign owners and ask for the next level</span></li>
          </ul>
          <button className="dialog-btn dialog-btn-primary develop-go" onClick={onOpenSkills}>Open Skill management</button>
        </section>
      </div>
    </main>
  );
}

/** Three linked nodes: a generic ontology mark. */
function OntologyMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <path d="M32 18L16 46M32 18l16 28M16 46h32" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" opacity=".55" />
      <circle cx="32" cy="16" r="9" fill="currentColor" />
      <circle cx="15" cy="47" r="8" fill="currentColor" opacity=".75" />
      <circle cx="49" cy="47" r="8" fill="currentColor" opacity=".55" />
    </svg>
  );
}

/** A stack of three versions with a clock hand: everything built, with its history. */
function RegistryMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <rect x="9" y="10" width="34" height="11" rx="4" fill="currentColor" />
      <rect x="9" y="26" width="34" height="11" rx="4" fill="currentColor" opacity=".75" />
      <rect x="9" y="42" width="20" height="11" rx="4" fill="currentColor" opacity=".55" />
      <circle cx="46" cy="45" r="10" stroke="currentColor" strokeWidth="3.4" />
      <path d="M46 39v6.5l4 2.5" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A skill card with a health pulse: the catalog and its state. */
function SkillMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <rect x="10" y="9" width="30" height="40" rx="5" fill="currentColor" opacity=".55" />
      <rect x="17" y="15" width="30" height="40" rx="5" fill="currentColor" opacity=".75" />
      <path d="M22 38h6l3-8 5 14 3-6h4" stroke="var(--surface, #fff)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
