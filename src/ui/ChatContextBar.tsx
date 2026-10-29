import { useState } from 'react';
import type { Persona } from '../chat-context';
import type { MemoryKind } from '../memory';
import type { PreviewSection } from '../personalization';

export type MemoryIdea = { kind: MemoryKind; text: string };
export type ChatContextBarProps = {
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
 * One row above the message box that shows what shapes the answers right now (memory, group, persona, Space)
 * and lets the person switch each of them off or change it without opening the settings.
 */
export default function ChatContextBar(p: ChatContextBarProps) {
  const [ideasOpen, setIdeasOpen] = useState(false);
  const open = ideasOpen && p.ideas.length > 0;
  const [previewOpen, setPreviewOpen] = useState(false);
  const activeCount = p.preview.filter((x) => x.active).length;
  return (
    <div className="ctxbar" role="group" aria-label="What shapes the answers">
      <button className={`ctx-chip ${p.memoryEnabled ? 'on' : ''}`} aria-pressed={p.memoryEnabled} title="Memory is added to every message. Click to switch it off or on." onClick={() => p.onMemoryEnabled(!p.memoryEnabled)}>
        Memory {p.memoryEnabled ? p.memoryCount : 'off'}
      </button>
      {p.groupName
        ? <button className="ctx-chip on" title="This group's instructions and team memory are used. Click to stop." onClick={p.onGroupOff}>Group: {p.groupName} ×</button>
        : <button className="ctx-chip" title="No group in use. Open the settings to choose one." onClick={p.onOpenSettings}>Group off</button>}
      <label className={`ctx-chip ctx-select ${p.persona ? 'on' : ''}`} title="Persona: tone and depth of the answers">
        <span>Persona</span>
        <select aria-label="Persona" value={p.persona} onChange={(e) => p.onPersona(e.target.value)}>
          <option value="">none</option>
          {p.personas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className={`ctx-chip ctx-select ${p.contextSpace ? 'on' : ''}`} title="Memory entries tied to this Space apply as well">
        <span>Space</span>
        <select aria-label="Space in context" value={p.contextSpace} onChange={(e) => p.onContextSpace(e.target.value)}>
          <option value="">none</option>
          {p.spaces.map((x) => <option key={x.slug} value={x.slug}>{x.title}</option>)}
        </select>
      </label>
      {p.ideas.length > 0 && (
        <button className="ctx-chip ctx-hot" aria-expanded={open} onClick={() => setIdeasOpen((o) => !o)}>Memory ideas {p.ideas.length}</button>
      )}
      <button className={`ctx-chip ${previewOpen ? 'on' : ''}`} aria-expanded={previewOpen} title="Show exactly what Joule gets along with your next message" onClick={() => setPreviewOpen((o) => !o)}>What Joule knows {activeCount}</button>
      {p.canMakeSkill && <button className="ctx-chip" title="Draft a reusable skill from this conversation (nothing is saved)" onClick={p.onMakeSkill}>Make skill</button>}
      {previewOpen && (
        <div className="ctx-ideas ctx-preview" role="region" aria-label="What Joule knows">
          <strong>Sent along with your next message</strong>
          {p.preview.map((x) => (
            <div key={x.id} className="ctx-preview-sec">
              <b>{x.title}</b> <small>{x.active ? 'active' : 'empty'} · {x.hint}</small>
              {x.active && <pre>{x.text}</pre>}
            </div>
          ))}
          <button className="ghost-btn" onClick={p.onOpenSettings}>Change in settings</button>
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
