import { useState } from 'react';
import { addCommand, addPersona, allCommands, allPersonas, BUILTIN_COMMANDS, removePersona, type Command, type PersonaState } from '../chat-context';
import type { Schedule } from '../schedules';
import { MAX_SCHEDULES } from '../schedules';
import { Section } from './PreferencesPanels';

export type ChatPanelProps = {
  personas: PersonaState;
  onPersonas: (next: PersonaState) => void;
  commands: Command[];
  onCommands: (next: Command[]) => void;
  schedules: Schedule[];
  onSchedules: (next: Schedule[]) => void;
};

/** Settings tab "Chat": personas, own slash commands and the morning briefing. */
export default function ChatPanel({ personas, onPersonas, commands, onCommands, schedules, onSchedules }: ChatPanelProps) {
  const [pName, setPName] = useState('');
  const [pText, setPText] = useState('');
  const [cName, setCName] = useState('');
  const [cText, setCText] = useState('');
  const [time, setTime] = useState('08:00');
  const [message, setMessage] = useState('');
  const scheduled = schedules.find((s) => s.prompt.trim() === '/briefing');

  return (
    <>
      <Section title="Personas" hint="A persona sets tone and depth of the answers, for example short and numbers-first for a controller. Choose it in the row above the message box; it applies to the whole conversation.">
        <ul className="prefs-list">
          {allPersonas(personas).map((p) => (
            <li key={p.id}>
              <div><b>{p.name}</b> <small>{p.instruction}</small></div>
              <div>
                {personas.custom.some((c) => c.id === p.id)
                  ? <button className="ghost-btn" onClick={() => onPersonas(removePersona(personas, p.id))}>Delete</button>
                  : <small>built in</small>}
              </div>
            </li>
          ))}
        </ul>
        <div className="prefs-row">
          <input type="text" aria-label="Persona name" placeholder="Name, for example Presales" value={pName} maxLength={40} onChange={(e) => setPName(e.target.value)} />
          <input type="text" aria-label="Persona instruction" placeholder="How should the assistant answer?" value={pText} maxLength={600} onChange={(e) => setPText(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="ghost-btn" disabled={!pName.trim() || !pText.trim()} onClick={() => { const r = addPersona(personas, pName, pText); if (r.error) setMessage(r.error); else { onPersonas(r.state); setPName(''); setPText(''); setMessage('Persona added.'); } }}>Add persona</button>
        </div>
      </Section>

      <Section title="Own commands" hint="Type / in the message box to see them. A command stands for a prepared question: /board runs the board summary. Use {args} for what you type after the command, {memory} for your memory and {approvals} for open approvals.">
        <ul className="prefs-list">
          {allCommands(commands).map((c) => {
            const own = commands.some((o) => o.name === c.name);
            const overrides = own && BUILTIN_COMMANDS.some((b) => b.name === c.name);
            return (
              <li key={c.name}>
                <div><b>/{c.name}</b> <small>{c.prompt.slice(0, 140)}{c.prompt.length > 140 ? '…' : ''}{overrides ? ' (replaces the built-in)' : ''}</small></div>
                <div>{own ? <button className="ghost-btn" onClick={() => onCommands(commands.filter((o) => o.name !== c.name))}>Delete</button> : <small>built in</small>}</div>
              </li>
            );
          })}
        </ul>
        <div className="prefs-row">
          <input type="text" aria-label="Command name" placeholder="/name" value={cName} maxLength={31} onChange={(e) => setCName(e.target.value)} style={{ width: 120 }} />
          <input type="text" aria-label="Command prompt" placeholder="What should it ask? For example: Summarise {args} for the steering committee" value={cText} maxLength={1500} onChange={(e) => setCText(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="ghost-btn" disabled={!cName.trim() || !cText.trim()} onClick={() => { const r = addCommand(commands, cName, cText); if (r.error) setMessage(r.error); else { onCommands(r.commands); setCName(''); setCText(''); setMessage('Command saved.'); } }}>Save command</button>
        </div>
      </Section>

      <Section title="Morning briefing" hint="/briefing builds your day from what the assistant knows about you (memory) and what waits for your decision (open approvals). Run it any time, or let it run every morning while the app is open.">
        {scheduled ? (
          <div className="prefs-row">
            <span>Runs {scheduled.repeat === 'daily' ? 'every day' : 'on chosen days'} at {scheduled.time}.</span>
            <button className="ghost-btn" onClick={() => { onSchedules(schedules.filter((s) => s.id !== scheduled.id)); setMessage('Briefing schedule removed.'); }}>Stop</button>
          </div>
        ) : (
          <div className="prefs-row">
            <label>Every day at <input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <button className="ghost-btn" disabled={schedules.length >= MAX_SCHEDULES} onClick={() => { onSchedules([...schedules, { id: `briefing-${Date.now().toString(36)}`, prompt: '/briefing', time: time || '08:00', repeat: 'daily', days: [], enabled: true }]); setMessage('The briefing runs every day at ' + (time || '08:00') + '.'); }}>Schedule it</button>
          </div>
        )}
      </Section>
      {message && <p className="prefs-note" role="status">{message}</p>}
    </>
  );
}
