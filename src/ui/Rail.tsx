import { useEffect, useRef, useState } from 'react';
import type { AppearancePreference } from '../appearance';
import { MODEL_PROVIDERS } from '../web-search';
import WerkbankMark from './WerkbankMark';

export type View = 'chat' | 'spaces' | 'develop' | 'manage' | 'n8n';

/** Screens that belong to Develop: the start page and the two places it leads to. */
const DEVELOP_VIEWS: View[] = ['develop', 'manage', 'n8n'];

export default function Rail({
  view,
  onView,
  onOpenSettings,
  onOpenCover,
  appearance,
  onAppearance,
}: {
  view: View;
  onView: (v: View) => void;
  onOpenSettings: () => void;
  onOpenCover: () => void;
  appearance: AppearancePreference;
  onAppearance: (value: AppearancePreference) => void;
}) {
  const [popover, setPopover] = useState<'profile' | 'help' | null>(null);
  const footRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popover) return;
    const onDown = (event: MouseEvent) => {
      if (!footRef.current?.contains(event.target as Node)) setPopover(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopover(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  const model = MODEL_PROVIDERS.find((provider) => provider.available) ?? MODEL_PROVIDERS[0];

  return (
    <nav className="rail">
      <button className="rail-logo" onClick={onOpenCover} title="About this design study" aria-label="About this design study">
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
          className={`rail-btn ${DEVELOP_VIEWS.includes(view) ? 'rail-btn-on' : ''}`}
          onClick={() => onView('develop')}
          title="Develop: workflows and agents"
          aria-label="Develop"
          aria-pressed={DEVELOP_VIEWS.includes(view)}
        >
          <DevelopIcon />
        </button>
      </div>

      <div className="rail-foot" ref={footRef}>
        {popover === 'profile' && (
          <div className="rail-popover" role="menu" aria-label="Profile">
            <div className="rail-pop-title">Appearance</div>
            <div className="rail-seg" role="group" aria-label="Appearance">
              {(['system', 'light', 'dark'] as const).map((value) => (
                <button
                  key={value}
                  className={appearance === value ? 'rail-seg-on' : ''}
                  aria-pressed={appearance === value}
                  onClick={() => onAppearance(value)}
                >
                  {value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
            <div className="rail-pop-row">
              <span>Model</span>
              <span className="rail-pop-value">{model.label}</span>
            </div>
            <button
              className="rail-pop-item"
              role="menuitem"
              onClick={() => {
                setPopover(null);
                onOpenCover();
              }}
            >
              About this design study
            </button>
            <button
              className="rail-pop-item"
              role="menuitem"
              onClick={() => {
                setPopover(null);
                onOpenSettings();
              }}
            >
              Settings…
            </button>
          </div>
        )}
        {popover === 'help' && (
          <div className="rail-popover" role="dialog" aria-label="Help and shortcuts">
            <div className="rail-pop-title">Shortcuts</div>
            <dl className="rail-keys">
              <dt>Enter</dt>
              <dd>Send message</dd>
              <dt>Shift + Enter</dt>
              <dd>New line in the message</dd>
              <dt>Esc</dt>
              <dd>Close dialog, menu or cover sheet</dd>
              <dt>↑ / ↓</dt>
              <dd>Reorder a focused Space in the Spaces list</dd>
            </dl>
            <div className="rail-pop-title">Tips</div>
            <ul className="rail-tips">
              <li>The sparkle icon in the composer holds Web Search and the Model.</li>
              <li>The magnifier and filter above the conversation list search by title and content.</li>
              <li>Click the logo at the top for the cover sheet.</li>
            </ul>
          </div>
        )}
        <button
          className={`rail-btn ${popover === 'help' ? 'rail-btn-on' : ''}`}
          onClick={() => setPopover(popover === 'help' ? null : 'help')}
          title="Help and shortcuts"
          aria-label="Help and shortcuts"
          aria-expanded={popover === 'help'}
        >
          <HelpIcon />
        </button>
        <button
          className="rail-btn"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <GearIcon />
        </button>
        <button
          className={`rail-btn ${popover === 'profile' ? 'rail-btn-on' : ''}`}
          onClick={() => setPopover(popover === 'profile' ? null : 'profile')}
          title="Profile"
          aria-label="Profile"
          aria-expanded={popover === 'profile'}
        >
          <ProfileIcon />
        </button>
      </div>
    </nav>
  );
}

function DevelopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7 6 3 10l4 4M13 6l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.2 4.5 8.8 15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7.3" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.8 16.4c.8-3 3.2-4.6 6.2-4.6s5.4 1.6 6.2 4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.9 8c.1-1.2 1-2 2.2-2 1.3 0 2.1.8 2.1 1.8 0 1.5-2.1 1.6-2.1 3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10.1" cy="14" r=".9" fill="currentColor" />
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
