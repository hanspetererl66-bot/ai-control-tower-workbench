import { useEffect } from 'react';
import type { AppearancePreference, ResolvedTheme } from '../appearance';

const OPTIONS: Array<{
  id: AppearancePreference;
  title: string;
  description: string;
}> = [
  { id: 'system', title: 'System', description: 'Follow macOS automatically' },
  { id: 'light', title: 'Light', description: 'Always use the light appearance' },
  { id: 'dark', title: 'Dark', description: 'Always use the dark appearance' },
];

export default function SettingsDialog({
  appearance,
  resolvedTheme,
  onChange,
  onClose,
}: {
  appearance: AppearancePreference;
  resolvedTheme: ResolvedTheme;
  onChange: (preference: AppearancePreference) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const activeAppearanceCopy = appearance === 'system'
    ? `System currently resolves to ${resolvedTheme}.`
    : `${appearance === 'dark' ? 'Dark' : 'Light'} appearance is active.`;

  return (
    <div className="scrim settings-scrim" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-head">
          <div>
            <h3 id="settings-title" className="dialog-title">Settings</h3>
            <p className="dialog-body">Personalise how Werkbank looks on this Mac.</p>
          </div>
          <button className="icon-btn settings-close" onClick={onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </header>

        <div className="settings-section">
          <div className="settings-section-copy">
            <h4>Appearance</h4>
            <p>{activeAppearanceCopy}</p>
          </div>
          <div className="appearance-options" role="radiogroup" aria-label="Appearance">
            {OPTIONS.map((option) => (
              <button
                key={option.id}
                className={`appearance-option ${appearance === option.id ? 'appearance-option-on' : ''}`}
                role="radio"
                aria-checked={appearance === option.id}
                onClick={() => onChange(option.id)}
              >
                <span className="appearance-preview" data-preview={option.id} aria-hidden="true">
                  {option.id === 'system' ? <SystemIcon /> : option.id === 'light' ? <SunIcon /> : <MoonIcon />}
                </span>
                <span className="appearance-label">{option.title}</span>
                <span className="appearance-description">{option.description}</span>
                {appearance === option.id && (
                  <span className="appearance-check" aria-hidden="true">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 20h6M12 16.5V20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 5.5h6.3a1.2 1.2 0 0 1 1.2 1.2v7.6a1.2 1.2 0 0 1-1.2 1.2H12z" fill="currentColor" opacity=".22" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19.3 15.4A8 8 0 0 1 8.6 4.7a8 8 0 1 0 10.7 10.7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
