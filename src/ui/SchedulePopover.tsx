import { useState } from 'react';
import { MAX_SCHEDULES, WEEKDAYS, describeSchedule, nextRun, type Schedule } from '../schedules';

/** Clock popover: set a time and daily or weekly (with weekdays) to ask a question again and again. */
export default function SchedulePopover({
  schedules,
  onChange,
  draftPrompt,
  onClose,
}: {
  schedules: Schedule[];
  onChange: (next: Schedule[]) => void;
  draftPrompt: string;
  onClose: () => void;
}) {
  return (
    <div className="schedule-pop" role="dialog" aria-label="Recurring briefing">
      <div className="schedule-head">
        <b>Recurring briefing</b>
        <button className="schedule-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <ScheduleEditor schedules={schedules} onChange={onChange} draftPrompt={draftPrompt} />
    </div>
  );
}

/** The form and the list of briefings, shared by the clock popover and the side panel. */
export function ScheduleEditor({
  schedules,
  onChange,
  draftPrompt,
}: {
  schedules: Schedule[];
  onChange: (next: Schedule[]) => void;
  draftPrompt: string;
}) {
  const [prompt, setPrompt] = useState(draftPrompt);
  const [time, setTime] = useState('08:00');
  const [repeat, setRepeat] = useState<'daily' | 'weekly'>('daily');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const valid = prompt.trim().length > 0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && (repeat === 'daily' || days.length > 0) && schedules.length < MAX_SCHEDULES;

  function add() {
    if (!valid) return;
    const id = `s${Date.now().toString(36)}`;
    onChange([...schedules, { id, prompt: prompt.trim().slice(0, 600), time, repeat, days: repeat === 'weekly' ? [...days].sort() : [], enabled: true }]);
    setPrompt('');
  }

  return (
    <div className="schedule-editor">
      <label className="schedule-field">
        <span>Question</span>
        <textarea value={prompt} maxLength={600} rows={2} placeholder="For example: Which renewals have an escalation or an open ticket?" onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="schedule-row">
        <label className="schedule-field schedule-time">
          <span>Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <div className="schedule-repeat" role="radiogroup" aria-label="Repeat">
          {(['daily', 'weekly'] as const).map((r) => (
            <button key={r} role="radio" aria-checked={repeat === r} className={`day-chip ${repeat === r ? 'day-chip-on' : ''}`} onClick={() => setRepeat(r)}>
              {r === 'daily' ? 'Daily' : 'Weekly'}
            </button>
          ))}
        </div>
      </div>
      {repeat === 'weekly' && (
        <div className="schedule-days" role="group" aria-label="Days of the week">
          {WEEKDAYS.map((w) => (
            <button
              key={w.day}
              className={`day-chip ${days.includes(w.day) ? 'day-chip-on' : ''}`}
              aria-pressed={days.includes(w.day)}
              title={w.long}
              onClick={() => setDays((cur) => (cur.includes(w.day) ? cur.filter((d) => d !== w.day) : [...cur, w.day]))}
            >
              {w.short}
            </button>
          ))}
        </div>
      )}
      <div className="schedule-actions">
        <button className="dialog-btn dialog-btn-primary" disabled={!valid} onClick={add}>Save briefing</button>
      </div>
      {schedules.length > 0 && (
        <ul className="schedule-list">
          {schedules.map((s) => {
            const next = nextRun(s, new Date());
            return (
              <li key={s.id}>
                <label className="schedule-toggle">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => onChange(schedules.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)))} aria-label={`Briefing ${s.prompt.slice(0, 30)} on or off`} />
                  <span>
                    {s.prompt.length > 70 ? `${s.prompt.slice(0, 69)}…` : s.prompt}
                    <small>{describeSchedule(s)}{s.enabled && next ? ` · next ${next.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ' · off'}</small>
                  </span>
                </label>
                <button className="schedule-x" onClick={() => onChange(schedules.filter((x) => x.id !== s.id))} aria-label="Delete briefing">×</button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="schedule-note">The briefing runs in the chat while Werkbank is open. A run missed while it was closed is made up when you start it again, up to six hours later.</p>
    </div>
  );
}
