import { useState } from 'react';
import { MAX_SCHEDULES, WEEKDAYS, describeSchedule, isEmail, nextRun, scheduleTitle, type Schedule } from '../schedules';
import { deliveryLabel } from '../schedule-delivery';

/** What the list needs from the app to run a briefing now. */
export type ScheduleRuntime = { runningId: string; canRun: boolean; onRun: (s: Schedule) => void; gmail: boolean };

/** Clock popover: set a time and daily or weekly (with weekdays) to ask a question again and again. */
export default function SchedulePopover({
  schedules,
  onChange,
  draftPrompt,
  onClose,
  runtime,
}: {
  schedules: Schedule[];
  onChange: (next: Schedule[]) => void;
  draftPrompt: string;
  onClose: () => void;
  runtime?: ScheduleRuntime;
}) {
  return (
    <div className="schedule-pop" role="dialog" aria-label="Recurring briefing">
      <div className="schedule-head">
        <span className="schedule-badge" aria-hidden="true"><ClockIcon /></span>
        <div className="schedule-title">
          <b>Recurring briefing</b>
          <small>Joule asks the same question for you at a set time.</small>
        </div>
        <button className="schedule-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <ScheduleEditor schedules={schedules} onChange={onChange} draftPrompt={draftPrompt} runtime={runtime} />
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 5.8V10l2.8 1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PRESETS: Array<{ label: string; time: string; repeat: 'daily' | 'weekly'; days: number[] }> = [
  { label: 'Weekdays 08:00', time: '08:00', repeat: 'weekly', days: [1, 2, 3, 4, 5] },
  { label: 'Mondays 07:30', time: '07:30', repeat: 'weekly', days: [1] },
  { label: 'Every day 18:00', time: '18:00', repeat: 'daily', days: [] },
];

/** The form and the list of briefings, shared by the clock popover and the side panel. A briefing in the list can be edited, run now, switched off or deleted. */
export function ScheduleEditor({
  schedules,
  onChange,
  draftPrompt,
  runtime,
}: {
  schedules: Schedule[];
  onChange: (next: Schedule[]) => void;
  draftPrompt: string;
  runtime?: ScheduleRuntime;
}) {
  const [editId, setEditId] = useState('');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState(draftPrompt);
  const [time, setTime] = useState('08:00');
  const [repeat, setRepeat] = useState<'daily' | 'weekly'>('daily');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [pdf, setPdf] = useState(false);
  const [email, setEmail] = useState(false);
  const [to, setTo] = useState('');
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const emailOk = !email || isEmail(to);
  const full = !editId && schedules.length >= MAX_SCHEDULES;
  const valid = prompt.trim().length > 0 && timeOk && (repeat === 'daily' || days.length > 0) && emailOk && !full;

  const reset = () => { setEditId(''); setName(''); setPrompt(''); setPdf(false); setEmail(false); setTo(''); };
  function save() {
    if (!valid) return;
    const base = {
      prompt: prompt.trim().slice(0, 600), time, repeat, days: repeat === 'weekly' ? [...days].sort() : [],
      ...(name.trim() ? { name: name.trim().slice(0, 60) } : {}),
      ...(pdf || email ? { delivery: { pdf: true, email, to: email ? to.trim() : '' } } : {}),
    };
    if (editId) onChange(schedules.map((x) => (x.id === editId ? { id: x.id, enabled: x.enabled, lastRun: x.lastRun, lastStatus: x.lastStatus, lastNote: x.lastNote, ...base } : x)));
    else onChange([...schedules, { id: `s${Date.now().toString(36)}`, enabled: true, ...base }]);
    reset();
  }
  function edit(s: Schedule) {
    setEditId(s.id); setName(s.name ?? ''); setPrompt(s.prompt); setTime(s.time); setRepeat(s.repeat);
    if (s.days.length) setDays(s.days);
    setPdf(Boolean(s.delivery?.pdf)); setEmail(Boolean(s.delivery?.email)); setTo(s.delivery?.to ?? '');
  }

  const draft: Schedule = { id: 'draft', prompt: 'x', time, repeat, days: repeat === 'weekly' ? [...days].sort() : [], enabled: true };
  const preview = timeOk && (repeat === 'daily' || days.length > 0) ? nextRun(draft, new Date()) : null;
  const applyPreset = (pr: (typeof PRESETS)[number]) => { setTime(pr.time); setRepeat(pr.repeat); if (pr.days.length) setDays(pr.days); };

  return (
    <div className="schedule-editor">
      <div className="schedule-presets" role="group" aria-label="Quick choices">
        {PRESETS.map((pr) => (
          <button key={pr.label} className="schedule-preset" onClick={() => applyPreset(pr)}>{pr.label}</button>
        ))}
      </div>
      <label className="schedule-field">
        <span>Name (optional)</span>
        <input type="text" value={name} maxLength={60} placeholder="For example: Renewals check" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="schedule-field">
        <span>Question</span>
        <textarea value={prompt} maxLength={600} rows={3} placeholder="For example: Which renewals have an escalation or an open ticket?" onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="schedule-row">
        <label className="schedule-field schedule-time">
          <span>Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <div className="schedule-field schedule-grow">
          <span>Repeat</span>
          <div className="schedule-seg" role="radiogroup" aria-label="Repeat">
            {(['daily', 'weekly'] as const).map((r) => (
              <button key={r} role="radio" aria-checked={repeat === r} className={`schedule-seg-btn ${repeat === r ? 'schedule-seg-on' : ''}`} onClick={() => setRepeat(r)}>
                {r === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>
        </div>
      </div>
      {repeat === 'weekly' && (
        <div className="schedule-days" role="group" aria-label="Days of the week">
          {WEEKDAYS.map((w) => (
            <button
              key={w.day}
              className={`day-chip day-circle ${days.includes(w.day) ? 'day-chip-on' : ''}`}
              aria-pressed={days.includes(w.day)}
              title={w.long}
              onClick={() => setDays((cur) => (cur.includes(w.day) ? cur.filter((d) => d !== w.day) : [...cur, w.day]))}
            >
              {w.short}
            </button>
          ))}
        </div>
      )}
      <fieldset className="schedule-delivery">
        <legend>Result</legend>
        <label><input type="checkbox" checked={pdf || email} disabled={email} onChange={(e) => setPdf(e.target.checked)} /> Save the answer as a PDF</label>
        <label><input type="checkbox" checked={email} onChange={(e) => { setEmail(e.target.checked); if (e.target.checked) setPdf(true); }} /> Create an email draft with the PDF attached</label>
        {email && (
          <label className="schedule-field">
            <span>Send to</span>
            <input type="email" value={to} maxLength={120} aria-label="Email address for the draft" aria-invalid={!emailOk} placeholder="name@company.com" onChange={(e) => setTo(e.target.value)} />
          </label>
        )}
        {email && runtime && !runtime.gmail && <small className="schedule-warn" role="status">The Gmail connector is not connected. The PDF is still made; the draft is skipped.</small>}
        {(pdf || email) && <small>The draft is not sent: you check it in Gmail and send it yourself. PDFs are saved in the workspace folder “briefings”.</small>}
      </fieldset>
      <div className="schedule-summary" role="status">
        {preview
          ? <><b>{describeSchedule(draft)}</b><span>Next run: {preview.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></>
          : <span>Choose a time{repeat === 'weekly' ? ' and at least one day' : ''} to see when it runs.</span>}
      </div>
      {email && !emailOk && <small className="schedule-warn" role="alert">Enter one valid email address.</small>}
      <div className="schedule-buttons">
        <button className="dialog-btn dialog-btn-primary schedule-save" disabled={!valid} onClick={save}>{editId ? 'Update briefing' : 'Save briefing'}</button>
        {editId && <button className="dialog-btn" onClick={reset}>Cancel</button>}
      </div>
      {schedules.length > 0 && (
        <div className="schedule-listwrap">
          <h4 className="schedule-h">Your briefings <small>{schedules.length}</small></h4>
          <ul className="schedule-list">
            {schedules.map((s) => {
              const next = nextRun(s, new Date());
              const running = runtime?.runningId === s.id;
              const delivery = deliveryLabel(s);
              return (
                <li key={s.id} className={`${s.enabled ? '' : 'schedule-off'} ${editId === s.id ? 'schedule-editing' : ''}`}>
                  <label className="schedule-switch" title={s.enabled ? 'On' : 'Off'}>
                    <input type="checkbox" role="switch" checked={s.enabled} onChange={(e) => onChange(schedules.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)))} aria-label={`Briefing ${scheduleTitle(s).slice(0, 30)} on or off`} />
                    <span className="schedule-knob" aria-hidden="true" />
                  </label>
                  <div className="schedule-item">
                    <span className="schedule-q">{scheduleTitle(s).length > 80 ? `${scheduleTitle(s).slice(0, 79)}…` : scheduleTitle(s)}</span>
                    <small>{describeSchedule(s)}{s.enabled && next ? ` · next ${next.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ' · off'}{delivery ? ` · ${delivery}` : ''}</small>
                    {running && <small role="status">Running now…</small>}
                    {!running && s.lastRun && (
                      <small className={s.lastStatus === 'error' ? 'schedule-warn' : ''}>
                        Last run {new Date(s.lastRun).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{s.lastNote ? ` · ${s.lastNote}` : ''}
                      </small>
                    )}
                  </div>
                  <div className="schedule-item-actions">
                    {runtime && <button className="schedule-mini" disabled={!runtime.canRun || Boolean(runtime.runningId)} onClick={() => runtime.onRun(s)} aria-label={`Run briefing ${scheduleTitle(s).slice(0, 30)} now`} title="Run now">▶</button>}
                    <button className="schedule-mini" onClick={() => edit(s)} aria-label={`Edit briefing ${scheduleTitle(s).slice(0, 30)}`} title="Edit">✎</button>
                    <button className="schedule-x" onClick={() => { if (editId === s.id) reset(); onChange(schedules.filter((x) => x.id !== s.id)); }} aria-label="Delete briefing">×</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="schedule-note">The briefing runs in the chat while Werkbank is open. A run missed while it was closed is made up when you start it again, up to six hours later.</p>
    </div>
  );
}
