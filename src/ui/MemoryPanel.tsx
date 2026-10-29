import { useEffect, useState } from 'react';
import { MEMORY_GOV_KEY, decide, levelOf, loadGov, pendingFor, requestPromotion, saveGov, type LevelIndex, type SkillGov } from '../skill-governance';
import { MAX_TEXT, MEMORY_KINDS, addMemory, deleteMemory, memoryNote, updateMemory, type MemoryKind, type MemoryState } from '../memory';
import { Section, type SpaceRef } from './PreferencesPanels';

export type MemoryPanelProps = { memory: MemoryState; onChange: (next: MemoryState) => void };
export type MemoryPanelAllProps = MemoryPanelProps & { spaces?: SpaceRef[] };

export default function MemoryPanel({ memory, onChange, spaces = [] }: MemoryPanelAllProps) {
  const [gov, setGov] = useState<SkillGov>(() => ({ ...loadGov(undefined, MEMORY_GOV_KEY), levels: loadGov().levels }));
  useEffect(() => saveGov(gov, undefined, MEMORY_GOV_KEY), [gov]);
  const [space, setSpace] = useState('');
  const lvl = (id: string) => levelOf(gov, id);
  const spaceTitle = (slug: string) => spaces.find((x) => x.slug === slug)?.title ?? slug;
  const pendingReqs = gov.requests.filter((r) => r.status === 'pending');
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

  const note = memoryNote(memory, '', lvl, gov.levels);
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
          <select aria-label="Applies to" value={space} onChange={(e) => setSpace(e.target.value)} title="Where this entry applies"><option value="">everywhere</option>{spaces.map((x) => <option key={x.slug} value={x.slug}>only in {x.title}</option>)}</select>
          <button className="ghost-btn" disabled={!text.trim()} onClick={() => apply(addMemory(memory, kind, text, new Date(), space), 'Remembered.', () => setText(''))}>Remember</button>
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
                      <div>
                        {e.text}{' '}
                        {e.space && <small className="mem-badge">only in {spaceTitle(e.space)}</small>}
                        {lvl(e.id) > 0 && <small className="mem-badge mem-badge-on">{gov.levels[lvl(e.id)]}</small>}
                        {pendingFor(gov, e.id) && <small className="mem-badge">in review for {gov.levels[pendingFor(gov, e.id)!.to]}</small>}
                      </div>
                      <div>
                        {lvl(e.id) < 2 && !pendingFor(gov, e.id) && <button className="ghost-btn" title="Ask to make this a rule for more people" onClick={() => setGov((g) => requestPromotion(g, e.id, e.text, Date.now()))}>Move up to {gov.levels[(lvl(e.id) + 1) as LevelIndex]}</button>}
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
      <Section title="Levels and approvals" hint={`An entry starts on “${gov.levels[0]}”. “Move up” asks to make it valid for more people: ${gov.levels[1]}, then ${gov.levels[2]}. It moves only after approval. Agreed entries are marked for the assistant. The names of the levels are set under Skills.`}>
        {pendingReqs.length === 0 && <p className="prefs-note">Nothing waits for approval.</p>}
        <ul className="prefs-list">
          {pendingReqs.map((r) => (
            <li key={r.id}>
              <div><b>{memory.entries.find((x) => x.id === r.skill)?.text ?? 'Entry removed'}</b> <small>{gov.levels[r.from]} → {gov.levels[r.to]}</small></div>
              <div>
                <button className="ghost-btn" onClick={() => setGov((g) => decide(g, r.id, true, '', Date.now()))}>Approve</button>
                <button className="ghost-btn" onClick={() => setGov((g) => decide(g, r.id, false, '', Date.now()))}>Reject</button>
              </div>
            </li>
          ))}
        </ul>
      </Section>
      {!memory.entries.length && <p className="prefs-note">Nothing remembered yet. Try writing “Merk dir: …” or “Remember that …” in a conversation.</p>}
    </>
  );
}
