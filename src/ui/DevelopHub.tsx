/** Start page of "Develop": two ways to build something, each opens the screen that existed before. */
export default function DevelopHub({ onWorkflow, onAgent }: { onWorkflow: () => void; onAgent: () => void }) {
  return (
    <main className="main develop-main">
      <div className="develop">
        <h1 className="develop-title">Develop</h1>
        <p className="develop-sub">What do you want to build?</p>
        <div className="develop-cards">
          <button className="develop-card" onClick={onWorkflow} aria-label="Create a Workflow with n8n">
            <span className="develop-logo develop-logo-n8n" aria-hidden="true"><WorkflowMark /></span>
            <span className="develop-card-title">Create a Workflow</span>
            <span className="develop-card-brand">with n8n</span>
            <span className="develop-card-text">Open n8n, build an automation and connect it to the chat.</span>
          </button>
          <button className="develop-card" onClick={onAgent} aria-label="Create an Agent">
            <span className="develop-logo develop-logo-agent" aria-hidden="true"><AgentMark /></span>
            <span className="develop-card-title">Create an Agent</span>
            <span className="develop-card-brand">with connectors &amp; skills</span>
            <span className="develop-card-text">Give your agent tools (connectors) and know-how (skills).</span>
          </button>
        </div>
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
