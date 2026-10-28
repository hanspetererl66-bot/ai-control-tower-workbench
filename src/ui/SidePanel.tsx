import { fileKind } from '../acp';
import { MEMORY_KINDS, type MemoryState } from '../memory';
import { LANGUAGES, LENGTHS, TONES, assistantNote, type Preferences } from '../preferences';
import type { Schedule } from '../schedules';
import HarnessPanel from './HarnessPanel';
import MemoryPanel from './MemoryPanel';
import type { PrefsUpdate } from './PreferencesPanels';
import { ScheduleEditor } from './SchedulePopover';

export type GeneratedFile = { path: string };
export type SidePanelTab = 'memory' | 'context' | 'instructions' | 'schedule';

export const SIDE_TABS: Array<{ id: SidePanelTab; title: string }> = [
  { id: 'memory', title: 'Memory' },
  { id: 'context', title: 'Context' },
  { id: 'instructions', title: 'Instructions' },
  { id: 'schedule', title: 'Schedule' },
];

/** One line of the Context tab: something that is (or is not) sent along with every message. */
export type ContextItem = { id: string; label: string; detail: string; on: boolean; tab?: SidePanelTab };

type Props = {
  tab: SidePanelTab;
  onTab: (tab: SidePanelTab) => void;
  onClose: () => void;
  files: GeneratedFile[];
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  memory: MemoryState;
  onMemoryChange: (next: MemoryState) => void;
  prefs: Preferences;
  onPrefs: PrefsUpdate;
  schedules: Schedule[];
  onSchedules: (next: Schedule[]) => void;
  context: ContextItem[];
};

/** Right-hand panel next to the chat: memory, what is in context, standing instructions and recurring briefings. */
export default function SidePanel(props: Props) {
  const { tab, onTab, onClose } = props;
  const move = (e: React.KeyboardEvent) => {
    const i = SIDE_TABS.findIndex((t) => t.id === tab);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onTab(SIDE_TABS[(next + SIDE_TABS.length) % SIDE_TABS.length].id);
  };
  return (
    <aside className="details side-panel" aria-label="Memory, context, instructions and schedule">
      <div className="details-head">
        <span className="details-title">Chat</span>
        <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close side panel">✕</button>
      </div>
      <div className="side-tabs" role="tablist" aria-label="Side panel sections" onKeyDown={move}>
        {SIDE_TABS.map((t) => (
          <button key={t.id} role="tab" id={`side-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="side-body" tabIndex={tab === t.id ? 0 : -1} className={`side-tab ${tab === t.id ? 'side-tab-on' : ''}`} onClick={() => onTab(t.id)}>
            {t.title}
          </button>
        ))}
      </div>
      <div className="side-body" id="side-body" role="tabpanel" aria-labelledby={`side-tab-${tab}`}>
        {tab === 'memory' && <MemoryPanel memory={props.memory} onChange={props.onMemoryChange} />}
        {tab === 'context' && <ContextTab {...props} />}
        {tab === 'instructions' && <InstructionsTab prefs={props.prefs} onPrefs={props.onPrefs} />}
        {tab === 'schedule' && (
          <div className="side-section">
            <h4>Recurring briefings</h4>
            <p className="side-hint">Ask a question again and again, at a set time. Runs in the chat while Werkbank is open.</p>
            <ScheduleEditor schedules={props.schedules} onChange={props.onSchedules} draftPrompt="" />
          </div>
        )}
      </div>
    </aside>
  );
}

function ContextTab({ context, files, onTab, onOpen, onReveal }: Props) {
  return (
    <div className="side-section">
      <h4>Sent with every message</h4>
      <p className="side-hint">What the assistant knows besides your question. Change it in the other tabs.</p>
      <ul className="context-list">
        {context.map((c) => (
          <li key={c.id}>
            <span className={`context-dot ${c.on ? 'context-dot-on' : ''}`} aria-hidden="true" />
            <span className="context-text"><b>{c.label}</b><small>{c.detail}</small></span>
            <span className="context-state">{c.on ? 'On' : 'Off'}</span>
            {c.tab && <button className="ghost-btn" onClick={() => onTab(c.tab!)}>Edit</button>}
          </li>
        ))}
      </ul>
      <h4 style={{ marginTop: 18 }}>Generated files <span className="details-count">{files.length}</span></h4>
      {files.length === 0 ? (
        <p className="side-hint">Files the agent creates in this conversation appear here.</p>
      ) : (
        <ul className="details-list">
          {files.map((f) => (
            <li key={f.path}>
              <div className="file" title={f.path}>
                <button className="file-open" onClick={() => onOpen(f.path)} title={`Open ${f.path.split('/').pop()}`}>
                  <span className="file-body">
                    <span className="file-name">{f.path.split('/').pop()}</span>
                    <span className="file-kind">{fileKind(f.path)}</span>
                  </span>
                </button>
                <button className="file-reveal" onClick={() => onReveal(f.path)} title="Show in Finder" aria-label={`Show ${f.path.split('/').pop()} in Finder`}>↗</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const LABELS = {
  language: { auto: 'Automatic', de: 'German', en: 'English' },
  length: { concise: 'Short', balanced: 'Balanced', detailed: 'Detailed' },
  tone: { neutral: 'Neutral', friendly: 'Friendly', formal: 'Formal' },
} as const;

function InstructionsTab({ prefs, onPrefs }: { prefs: Preferences; onPrefs: PrefsUpdate }) {
  const set = (patch: Partial<Preferences['assistant']>) => onPrefs((p) => ({ ...p, assistant: { ...p.assistant, ...patch } }));
  const a = prefs.assistant;
  const note = assistantNote(prefs);
  return (
    <div className="side-section">
      <h4>Instructions</h4>
      <p className="side-hint">Sent with every message, in every conversation. For example: always name the source, write numbers in euro, prefer tables.</p>
      <label className="side-field"><span>Language</span>
        <select value={a.language} onChange={(e) => set({ language: e.target.value as typeof a.language })}>{LANGUAGES.map((v) => <option key={v} value={v}>{LABELS.language[v]}</option>)}</select>
      </label>
      <label className="side-field"><span>Length</span>
        <select value={a.length} onChange={(e) => set({ length: e.target.value as typeof a.length })}>{LENGTHS.map((v) => <option key={v} value={v}>{LABELS.length[v]}</option>)}</select>
      </label>
      <label className="side-field"><span>Tone</span>
        <select value={a.tone} onChange={(e) => set({ tone: e.target.value as typeof a.tone })}>{TONES.map((v) => <option key={v} value={v}>{LABELS.tone[v]}</option>)}</select>
      </label>
      <label className="side-field"><span>Standing instructions</span>
        <textarea className="prefs-area" rows={6} value={a.instructions} maxLength={1000} onChange={(e) => set({ instructions: e.target.value })} />
      </label>
      <p className="side-hint">{a.instructions.length} / 1000</p>
      <h4 style={{ marginTop: 14 }}>What the assistant receives</h4>
      <pre className="side-pre">{note || 'Nothing: all settings are at their defaults.'}</pre>
      <HarnessPanel prefs={prefs} onPrefs={onPrefs} />
    </div>
  );
}

/** Short summary of the memory for the Context tab. */
export function memorySummary(memory: MemoryState): string {
  if (!memory.entries.length) return 'No notes yet';
  const parts = MEMORY_KINDS.map((k) => ({ k, n: memory.entries.filter((e) => e.kind === k.id).length })).filter((x) => x.n);
  return `${memory.entries.length} ${memory.entries.length === 1 ? 'note' : 'notes'}: ${parts.map((x) => `${x.n} ${x.k.title.toLowerCase()}`).join(', ')}`;
}
