import WerkbankMark from './WerkbankMark';

export type View = 'chat' | 'spaces' | 'manage' | 'n8n';

export default function Rail({
  view,
  onView,
  onOpenSettings,
  onOpenCover,
}: {
  view: View;
  onView: (v: View) => void;
  onOpenSettings: () => void;
  onOpenCover: () => void;
}) {
  return (
    <nav className="rail">
      <button className="rail-logo" onClick={onOpenCover} title="About this prototype" aria-label="About this prototype">
        <WerkbankMark size={24} />
      </button>

      <div className="rail-nav">
        <button
          className={`rail-btn ${view === 'chat' ? 'rail-btn-on' : ''}`}
          onClick={() => onView('chat')}
          title="Conversations"
          aria-label="Conversations"
          aria-pressed={view === 'chat'}
        >
          <ChatIcon />
        </button>
        <button
          className={`rail-btn ${view === 'spaces' ? 'rail-btn-on' : ''}`}
          onClick={() => onView('spaces')}
          title="Spaces"
          aria-label="Spaces"
          aria-pressed={view === 'spaces'}
        >
          <LayersIcon />
        </button>
        <button
          className={`rail-btn ${view === 'manage' ? 'rail-btn-on' : ''}`}
          onClick={() => onView('manage')}
          title="Connectors & Skills"
          aria-label="Connectors and Skills"
          aria-pressed={view === 'manage'}
        >
          <ConnectorIcon />
        </button>
        <button
          className={`rail-btn ${view === 'n8n' ? 'rail-btn-on' : ''}`}
          onClick={() => onView('n8n')}
          title="n8n Automation"
          aria-label="n8n Automation"
          aria-pressed={view === 'n8n'}
        >
          <WorkflowIcon />
        </button>
      </div>

      <div className="rail-foot">
        <button
          className="rail-btn"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <GearIcon />
        </button>
        <div className="rail-avatar">MZ</div>
        <button className="rail-btn" title="Toggle sidebar" aria-label="Toggle sidebar">
          <PanelIcon />
        </button>
      </div>
    </nav>
  );
}

function WorkflowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="4.5" cy="10" r="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="15.5" cy="5" r="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="15.5" cy="15" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.3 9.2 13.7 5.8M6.3 10.8l7.4 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ConnectorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="9" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.5 11.5 11 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3.2 5.2c0-.9.7-1.6 1.6-1.6h10.4c.9 0 1.6.7 1.6 1.6v6c0 .9-.7 1.6-1.6 1.6H8.1l-3.8 3v-3.2c-.7-.2-1.1-.8-1.1-1.5z"
        fill="currentColor"
      />
      <path d="M6 6.8h8M6 9.5h5.4" stroke="white" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2.5 18 7l-8 4.5L2 7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M2.5 11.5 10 15.7l7.5-4.2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4v12" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.6 2.2" />
    </svg>
  );
}
