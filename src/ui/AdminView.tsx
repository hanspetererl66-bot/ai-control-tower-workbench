/**
 * Start page of "Admin": the places for those who look after what is shared. Two tiles today: Ontologies and Registry;
 * more can follow. Admin is not part of Develop.
 */
export default function AdminView({ onOpenOntology, onOpenRegistry }: { onOpenOntology: () => void; onOpenRegistry: () => void }) {
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
