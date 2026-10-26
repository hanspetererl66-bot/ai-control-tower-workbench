import { PRODUCT_TITLE } from '../product';
import { useEffect } from 'react';
import { useState } from 'react';
import type { AppearancePreference, ResolvedTheme } from '../appearance';
import { SPACE_SCALES, type SpaceScale } from '../space-scale';
import { speechSupported, type VoiceSettings } from '../voice';
import type { Preferences } from '../preferences';
import MemoryPanel, { type MemoryPanelProps } from './MemoryPanel';
import GroupsPanel, { type GroupsPanelProps } from './GroupsPanel';
import { AssistantPanel, LookPanel, ProfilesPanel, StoragePanel, WorkPanel, type PrefsUpdate, type SkillRef, type SpaceRef, type SyncState } from './PreferencesPanels';

const TABS = [
  { id: 'profiles', title: 'Profiles' },
  { id: 'look', title: 'Look' },
  { id: 'work', title: 'Work' },
  { id: 'assistant', title: 'Assistant' },
  { id: 'memory', title: 'Memory' },
  { id: 'groups', title: 'Groups' },
  { id: 'storage', title: 'Storage' },
  { id: 'general', title: 'General' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export type PersonalizeProps = {
  prefs: Preferences;
  update: PrefsUpdate;
  spaces: SpaceRef[];
  skills: SkillRef[];
  connectors: string[];
  syncAvailable: boolean;
  sync: SyncState;
  onSyncSave: () => void;
  onSyncLoad: () => void;
  groups: GroupsPanelProps;
  memory: MemoryPanelProps;
};

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
  spaceScale,
  onSpaceScaleChange,
  voice,
  onVoiceChange,
  personalize,
  onClose,
}: {
  appearance: AppearancePreference;
  resolvedTheme: ResolvedTheme;
  onChange: (preference: AppearancePreference) => void;
  spaceScale?: SpaceScale;
  onSpaceScaleChange?: (scale: SpaceScale) => void;
  voice?: VoiceSettings;
  onVoiceChange?: (
    patch: Partial<Omit<VoiceSettings, 'hasKey'>> & { key?: string }
  ) => Promise<{ ok: boolean; detail?: string } | undefined>;
  personalize?: PersonalizeProps;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>(personalize ? 'profiles' : 'general');
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
            <p className="dialog-body">Personalise how {PRODUCT_TITLE} looks and works.</p>
          </div>
          <button className="icon-btn settings-close" onClick={onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </header>

        {personalize && (
          <div className="prefs-tabs" role="tablist" aria-label="Settings sections">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`prefs-tab ${tab === t.id ? 'prefs-tab-on' : ''}`} onClick={() => setTab(t.id)}>{t.title}</button>
            ))}
          </div>
        )}
        <div className="prefs-body">
        {personalize && tab === 'profiles' && <ProfilesPanel prefs={personalize.prefs} update={personalize.update} />}
        {personalize && tab === 'look' && <LookPanel prefs={personalize.prefs} update={personalize.update} />}
        {personalize && tab === 'work' && <WorkPanel prefs={personalize.prefs} update={personalize.update} spaces={personalize.spaces} skills={personalize.skills} connectors={personalize.connectors} />}
        {personalize && tab === 'assistant' && <AssistantPanel prefs={personalize.prefs} update={personalize.update} />}
        {personalize && tab === 'memory' && <MemoryPanel {...personalize.memory} />}
        {personalize && tab === 'groups' && <GroupsPanel {...personalize.groups} />}
        {personalize && tab === 'storage' && <StoragePanel prefs={personalize.prefs} update={personalize.update} syncAvailable={personalize.syncAvailable} sync={personalize.sync} onSave={personalize.onSyncSave} onLoad={personalize.onSyncLoad} />}
        {(!personalize || tab === 'general') && (
          <>
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
        {spaceScale !== undefined && onSpaceScaleChange && (
          <div className="settings-section settings-voice">
            <div className="settings-section-copy">
              <h4>Text size in Spaces</h4>
              <p>Scales text and layout of every Space, including ones the agent builds. Default is 115%.</p>
            </div>
            <div className="scale-options" role="radiogroup" aria-label="Text size in Spaces">
              {SPACE_SCALES.map((scale) => (
                <button
                  key={scale}
                  className={`ghost-btn ${spaceScale === scale ? 'ghost-btn-on' : ''}`}
                  role="radio"
                  aria-checked={spaceScale === scale}
                  onClick={() => onSpaceScaleChange(scale)}
                >
                  {Math.round(scale * 100)}%
                </button>
              ))}
            </div>
          </div>
        )}
        {voice && onVoiceChange && <VoiceSection voice={voice} onVoiceChange={onVoiceChange} />}
          </>
        )}
        </div>
      </section>
    </div>
  );
}

function VoiceSection({
  voice,
  onVoiceChange,
}: {
  voice: VoiceSettings;
  onVoiceChange: NonNullable<Parameters<typeof SettingsDialog>[0]['onVoiceChange']>;
}) {
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');

  async function run(patch: Parameters<typeof onVoiceChange>[0], done?: string) {
    const result = await onVoiceChange(patch);
    setMessage(result?.ok === false ? (result.detail ?? 'Speichern fehlgeschlagen.') : (done ?? ''));
  }

  return (
    <div className="settings-section settings-voice">
      <div className="settings-section-copy">
        <h4>Sprache</h4>
        <p>
          Spracheingabe sendet die Aufnahme an Deepgram (EU-Endpunkt) und fügt den erkannten Text in das
          Eingabefeld ein. Gespeichert wird nur Text, kein Audio. Der Key liegt verschlüsselt im Schlüsselbund
          dieses Rechners.
        </p>
      </div>
      <div className="voice-row">
        <input
          type="password"
          className="voice-key"
          value={key}
          placeholder={voice.hasKey ? 'Key gespeichert — zum Ersetzen neuen Key einfügen' : 'Deepgram API-Key'}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setKey(event.target.value)}
          aria-label="Deepgram API key"
        />
        <button
          className="ghost-btn"
          disabled={!key.trim()}
          onClick={async () => {
            await run({ key }, 'Key gespeichert.');
            setKey('');
          }}
        >
          Speichern
        </button>
        {voice.hasKey && (
          <button className="ghost-btn" onClick={() => run({ key: '' }, 'Key entfernt.')}>
            Entfernen
          </button>
        )}
      </div>
      <label className="voice-option">
        <span>Sprache der Eingabe</span>
        <select value={voice.language} onChange={(event) => run({ language: event.target.value as 'de' | 'en' })}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="voice-option">
        <input
          type="checkbox"
          checked={voice.autoSend}
          onChange={(event) => run({ autoSend: event.target.checked })}
        />
        <span>Erkannten Text sofort senden</span>
      </label>
      <label className="voice-option">
        <input
          type="checkbox"
          checked={voice.speak}
          disabled={!speechSupported()}
          onChange={(event) => run({ speak: event.target.checked })}
        />
        <span>Antworten vorlesen (Systemstimme, Code und Tabellen werden übersprungen)</span>
      </label>
      {message && <p className="voice-message" role="status">{message}</p>}
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
