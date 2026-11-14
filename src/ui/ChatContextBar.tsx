import { useState } from 'react';
import type { Persona } from '../chat-context';
import type { MemoryKind } from '../memory';
import type { PreviewSection } from '../personalization';
import { safetyLine, safetyNotable } from '../chat-safety';

export type MemoryIdea = { kind: MemoryKind; text: string };
/** Working profile, approval mode and working folder: set in the panel, not in the bar. */
export type SafetyProps = {
  profiles: Array<{ id: string; name: string; description: string }>;
  profileId: string;
  onProfile: (id: string) => void;
  modes: Array<{ id: string; name: string }>;
  modeId: string;
  onMode: (id: string) => void;
  /** Mode cannot be changed (agent not connected). */
  modeDisabled: boolean;
  /** A working-profile switch is locked while an answer is running. */
  busy: boolean;
  workdir: string;
  /** Only given in the desktop app. */
  onOpenFolder?: () => void;
};
export type ChatContextBarProps = {
  safety: SafetyProps;
  memoryEnabled: boolean;
  /** Entries that apply in this conversation. */
  memoryCount: number;
  onMemoryEnabled: (on: boolean) => void;
  groupName: string | null;
  onGroupOff: () => void;
  personas: Persona[];
  persona: string;
  onPersona: (id: string) => void;
  spaces: Array<{ slug: string; title: string }>;
  contextSpace: string;
  onContextSpace: (slug: string) => void;
  ideas: MemoryIdea[];
  onRemember: (idea: MemoryIdea) => void;
  onDismissIdea: (idea: MemoryIdea) => void;
  onOpenSettings: () => void;
  /** What goes along with the next message, section by section. */
  preview: PreviewSection[];
  /** Offered once the conversation has some substance; turns it into a skill draft. */
  canMakeSkill: boolean;
  onMakeSkill: () => void;
};

/**
 * One small icon in the composer bar. It opens a tidy panel with everything that shapes the answers
 * (memory, group, persona, Space, what is sent along, make a skill); closed, only a count shows how much is active.
 * The memory-ideas hint stays visible next to the button because it asks for a decision.
 */
export default function ChatContextBar(p: ChatContextBarProps) {
  const [ideasOpen, setIdeasOpen] = useState(false);
  const open = ideasOpen && p.ideas.length > 0;
  const [panelOpen, setPanelOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const activeCount = p.preview.filter((x) => x.active).length;
  // How many of the four switches are doing something right now.
  const inUse = [p.memoryEnabled, !!p.groupName, !!p.persona, !!p.contextSpace].filter(Boolean).length;
  const sf = p.safety;
  const profile = sf.profiles.find((x) => x.id === sf.profileId);
  const mode = sf.modes.find((x) => x.id === sf.modeId);
  const notable = safetyNotable(sf.profileId, sf.modeId);
  return (
    <div className="chip-wrap ctxslot" role="group" aria-label="What shapes the answers">
      <button className={`chip chip-icon ctx-icon ${panelOpen ? 'chip-on' : ''}`} aria-expanded={panelOpen} aria-controls="ctx-panel" aria-label="Context: memory, group, persona, Space" data-tip={`Context: memory, group, persona, Space (${inUse} of 4 in use)`} onClick={() => setPanelOpen((o) => !o)}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" /><circle cx="10.5" cy="4.5" r="1.5" /><circle cx="5.5" cy="11.5" r="1.5" />
        </svg>
        {inUse > 0 && <span className="ctx-badge" aria-hidden="true">{inUse}</span>}
      </button>
      {notable && (
        <button className="chip chip-icon ctx-shield" aria-label="Safety settings are not the usual ones. Open the settings." data-tip={`${safetyLine({ profileId: sf.profileId, profileName: profile?.name ?? '', modeId: sf.modeId, modeName: mode?.name ?? '' })}. Click to change.`} onClick={() => setPanelOpen(true)}>
          <ShieldIcon />
        </button>
      )}
      {p.ideas.length > 0 && (
        <button className="ctx-chip ctx-hot" aria-expanded={open} onClick={() => setIdeasOpen((o) => !o)}>Memory ideas {p.ideas.length}</button>
      )}
      {panelOpen && (
        <div id="ctx-panel" className="ctx-panel">
          <div className="ctx-row">
            <span className="ctx-row-label">Memory<small>Added to every message</small></span>
            <button className={`ctx-chip ${p.memoryEnabled ? 'on' : ''}`} aria-pressed={p.memoryEnabled} title="Memory is added to every message. Click to switch it off or on." onClick={() => p.onMemoryEnabled(!p.memoryEnabled)}>
              Memory {p.memoryEnabled ? `on · ${p.memoryCount}` : 'off'}
            </button>
          </div>
          <div className="ctx-row">
            <span className="ctx-row-label">Group<small>Its instructions and team memory</small></span>
            {p.groupName
              ? <button className="ctx-chip on" title="This group's instructions and team memory are used. Click to stop." onClick={p.onGroupOff}>Group: {p.groupName} ×</button>
              : <button className="ctx-chip" title="No group in use. Open the settings to choose one." onClick={p.onOpenSettings}>Group off · choose…</button>}
          </div>
          <label className="ctx-row">
            <span className="ctx-row-label">Persona<small>Tone and depth of the answers</small></span>
            <span className={`ctx-chip ctx-select ${p.persona ? 'on' : ''}`}>
              <select aria-label="Persona" value={p.persona} onChange={(e) => p.onPersona(e.target.value)}>
                <option value="">none</option>
                {p.personas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </span>
          </label>
          <label className="ctx-row">
            <span className="ctx-row-label">Space<small>Memory entries tied to this Space apply as well</small></span>
            <span className={`ctx-chip ctx-select ${p.contextSpace ? 'on' : ''}`}>
              <select aria-label="Space in context" value={p.contextSpace} onChange={(e) => p.onContextSpace(e.target.value)}>
                <option value="">none</option>
                {p.spaces.map((x) => <option key={x.slug} value={x.slug}>{x.title}</option>)}
              </select>
            </span>
          </label>
          <div className="ctx-row">
            <span className="ctx-row-label">What Joule knows<small>Exactly what goes along with your next message</small></span>
            <button className={`ctx-chip ${previewOpen ? 'on' : ''}`} aria-expanded={previewOpen} onClick={() => setPreviewOpen((o) => !o)}>{previewOpen ? 'Hide' : 'Show'} · {activeCount}</button>
          </div>
          {previewOpen && (
            <div className="ctx-sent" role="region" aria-label="What Joule knows">
              {p.preview.map((x) => (
                <div key={x.id} className="ctx-preview-sec">
                  <b>{x.title}</b> <small>{x.active ? 'active' : 'empty'} · {x.hint}</small>
                  {x.active && <pre>{x.text}</pre>}
                </div>
              ))}
              <button className="ghost-btn" onClick={p.onOpenSettings}>Change in settings</button>
            </div>
          )}
          {sf.profiles.length > 1 && (
            <label className="ctx-row">
              <span className="ctx-row-label">Working profile<small>{profile?.description || 'Rules for this kind of work'}</small></span>
              <select aria-label="Working profile" value={sf.profileId} onChange={(e) => sf.onProfile(e.target.value)} disabled={sf.busy}>
                {sf.profiles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          )}
          <label className="ctx-row">
            <span className="ctx-row-label">Approval mode<small>When Joule has to ask before it acts</small></span>
            <select aria-label="Approval mode" value={sf.modeId} onChange={(e) => sf.onMode(e.target.value)} disabled={sf.modeDisabled}>
              {sf.modes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          {sf.onOpenFolder && (
            <div className="ctx-row">
              <span className="ctx-row-label">Working folder<small title={sf.workdir}>Where files Joule makes are kept</small></span>
              <button className="ctx-chip" onClick={sf.onOpenFolder}>Open</button>
            </div>
          )}
          <div className="ctx-row">
            <span className="ctx-row-label">Make skill<small>{p.canMakeSkill ? 'Draft a reusable skill from this conversation (nothing is saved)' : 'Available after two messages'}</small></span>
            <button className="ctx-chip" disabled={!p.canMakeSkill} onClick={() => { setPanelOpen(false); p.onMakeSkill(); }}>Make skill</button>
          </div>
        </div>
      )}
      {open && (
        <div className="ctx-ideas" role="region" aria-label="Memory ideas from this conversation">
          <strong>Worth remembering from this conversation</strong>
          {p.ideas.map((i) => (
            <div key={i.text} className="ctx-idea">
              <span>{i.text}</span>
              <button className="ghost-btn" onClick={() => p.onRemember(i)}>Remember</button>
              <button className="ghost-btn" onClick={() => p.onDismissIdea(i)}>Not this</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 3 3.6v4c0 3 2.2 5.2 5 6.6 2.8-1.4 5-3.6 5-6.6v-4z" /><path d="M5.8 8.2 7.4 9.8 10.4 6.6" />
    </svg>
  );
}
