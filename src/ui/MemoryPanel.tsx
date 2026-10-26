import { useState } from 'react';
import { MAX_TEXT, MEMORY_KINDS, addMemory, deleteMemory, memoryNote, updateMemory, type MemoryKind, type MemoryState } from '../memory';
import { Section } from './PreferencesPanels';

export type MemoryPanelProps = { memory: MemoryState; onChange: (next: MemoryState) => void };

export default function MemoryPanel({ memory, onChange }: MemoryPanelProps) {
  const [kind, setKind] = useState<MemoryKind>('context');
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const apply = (r: { state: MemoryState; error?: string }, ok: string, after?: () => void) => {
    if (r.error) { setMessage(r.error); return; }
    onChange(r.state); setMessage(ok); after?.();
  };

  const note = memoryNote(memory);
  return (
    <>
      <Section title="How memory works" hint="Memory is what the assistant should always know about you, so you do not have to repeat it in every conversation.">
        <ul className="prefs-list">
          <li><div><b>About me</b> <small>Who you are and what you do. Example: “I lead Sales EMEA at Accenture”. The assistant picks the right depth and examples.</small></div></li>
          <li><div><b>How I like results</b> <small>Form and tone. Example: “always answer in German, result first, then reasons”. Applies to every answer.</small></div></li>
          <li><div><b>Projects and context</b> <small>Names and facts. Example: “Sub4Me is the service portal of customer X”. Saves you the explanation.</small></div></li>
        </ul>
        <p className="prefs-note"><b>How an entry gets in:</b> you type it here, or you write “Remember that …” in a conversation and press “Remember” on the suggestion. The assistant never saves on its own, and passwords or keys are refused.</p>
        <p className="prefs-note"><b>Personal or team:</b> this memory is yours and stays on this computer. What a whole team should know (rules, decisions) belongs in the team memory of a group (tab Groups).</p>
      </Section>
      <Section title="What the assistant sees" hint="This is the exact text added to your conversations. If an entry should not be used, forget it below.">
        <pre className="prefs-area" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{note || (memory.enabled ? 'Nothing yet. Add your first entry below.' : 'Memory is switched off: the assistant sees nothing.')}</pre>
      </Section>
      <Section title="Memory" hint="Short notes the assistant keeps in mind in every conversation, for example who you are or how you like results. They stay on this computer. The assistant never saves anything by itself: it can only suggest an entry, and you press Remember.">
        <div className="prefs-row">
          <label>
            <input type="checkbox" checked={memory.enabled} onChange={(e) => onChange({ ...memory, enabled: e.target.checked })} /> Use memory in conversations
          </label>
        </div>
        <div className="prefs-row">
          <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>{MEMORY_KINDS.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}</select>
          <input type="text" aria-label="New memory entry" placeholder="For example: I lead Sales EMEA and prefer short answers" value={text} maxLength={MAX_TEXT} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button className="ghost-btn" disabled={!text.trim()} onClick={() => apply(addMemory(memory, kind, text), 'Remembered.', () => setText(''))}>Remember</button>
        </div>
        {message && <p className="prefs-note" role="status">{message}</p>}
      </Section>
      {MEMORY_KINDS.map((k) => {
        const list = memory.entries.filter((e) => e.kind === k.id);
        if (!list.length) return null;
        return (
          <Section key={k.id} title={k.title}>
            <ul className="prefs-list">
              {list.map((e) => (
                <li key={e.id}>
                  {editing === e.id ? (
                    <div className="prefs-row" style={{ flex: 1 }}>
                      <input type="text" aria-label="Edit entry" value={editText} maxLength={MAX_TEXT} onChange={(ev) => setEditText(ev.target.value)} style={{ flex: 1 }} />
                      <button className="ghost-btn" onClick={() => apply(updateMemory(memory, e.id, editText), 'Saved.', () => setEditing(null))}>Save</button>
                      <button className="ghost-btn" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div>{e.text}</div>
                      <div>
                        <button className="ghost-btn" onClick={() => { setEditing(e.id); setEditText(e.text); }}>Edit</button>
                        {confirm === e.id
                          ? <><button className="ghost-btn ghost-btn-on" onClick={() => { setConfirm(null); onChange(deleteMemory(memory, e.id)); }}>Yes, forget</button><button className="ghost-btn" onClick={() => setConfirm(null)}>Cancel</button></>
                          : <button className="ghost-btn" onClick={() => setConfirm(e.id)}>Forget</button>}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
      {!memory.entries.length && <p className="prefs-note">Nothing remembered yet. Try writing “Merk dir: …” or “Remember that …” in a conversation.</p>}
    </>
  );
}
