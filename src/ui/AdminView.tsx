/**
 * Start page of "Admin": the places for those who look after what is shared. Today there is one tile, Ontologies;
 * more tiles can follow. Admin is not part of Develop.
 */
export default function AdminView({ onOpenOntology }: { onOpenOntology: () => void }) {
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
