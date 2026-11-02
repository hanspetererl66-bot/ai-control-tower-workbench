import { useEffect, useRef, useState } from 'react';
import { GUARDRAILS, SYSTEMS, TRIGGERS, applyInterview, setInterview, skillSlug, type Project } from '../develop';
import {
  DONE_THRESHOLD, INTRO, SLOTS, coverage, intentPrompt, interviewMarkdown, logTurns, nextAction, parseIntentProposal, parseModelOut, skip, startInterview, turnPrompt, ingest,
  type Lang,
} from '../interview';
import { ReplySpeaker, speechSupported, startRecording, type Recording } from '../voice';
import { saveFile } from '../doc-export';

type Props = {
  project: Project;
  onChange: (project: Project) => void;
  /** Runs a prompt through the chat agent; the third argument keeps all turns of one interview in one conversation. */
  generate: (prompt: string, title: string, session?: string) => Promise<string>;
  onStop: () => void;
  ready: boolean;
  /** Tells the wizard that an answer is being processed, so that the person cannot leave in the middle of it. */
  onBusy: (busy: boolean) => void;
  /** The form has been filled in from the interview: show it. */
  onFinished: () => void;
};

type Line = { who: 'interviewer' | 'person'; text: string; via?: 'voice' | 'text' };
const LISTS = { triggers: TRIGGERS, systems: SYSTEMS, guardrails: GUARDRAILS };

/**
 * Process interview in the Intent step. The person is asked about the process one question at a time, out loud if the
 * interviewer wants, and answers by voice or text. The agent turns every answer into notes (see interview.ts) and the
 * next question goes where the notes have the biggest gap. The whole conversation is logged word by word in the project
 * and written to a Markdown result.
 * Voice: questions are read with the system voice, answers are recorded with the microphone and transcribed by the
 * Deepgram key from the settings (same as the chat). There is no automatic turn-taking: the person starts and stops
 * the recording with one button.
 */
export default function InterviewPanel({ project, onChange, generate, onStop, ready, onBusy, onFinished }: Props) {
  const iv = project.interview ?? null;
  const [role, setRole] = useState('');
  const [lang, setLang] = useState<Lang>('en');
  const [consent, setConsent] = useState(false);
  const lines: Line[] = iv?.transcript.length ? iv.transcript : iv?.pending ? [{ who: 'interviewer', text: iv.pending.text }] : [];
  const canSpeak = speechSupported();
  const [speakOn, setSpeakOn] = useState(canSpeak);
  const [autoSend, setAutoSend] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  const [mic, setMic] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recording = useRef<Recording | null>(null);
  const speaker = useRef<ReplySpeaker | null>(null);
  const viaRef = useRef<'voice' | 'text'>('text');
  const [answer, setAnswer] = useState('');
  const [working, setWorking] = useState<'' | 'answer' | 'finish'>('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const alive = useRef(true);
  const logRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => () => { alive.current = false; recording.current?.cancel(); if (speechSupported()) window.speechSynthesis.cancel(); }, []);
  useEffect(() => { void window.host?.voice?.getSettings().then((v) => { if (alive.current) setHasKey(Boolean(v?.hasKey)); }).catch(() => undefined); }, []);
  useEffect(() => { if (!speakOn && speechSupported()) window.speechSynthesis.cancel(); }, [speakOn]);
  useEffect(() => { logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight }); }, [lines, working]);
  // The box is locked while an answer is processed and loses the focus; give it back, so that the interview can go on by keyboard.
  useEffect(() => { if (working === '') answerRef.current?.focus(); }, [working, lines.length]);

  const session = `interview-${project.id}`;
  const busy = working !== '';
  function setBusy(v: '' | 'answer' | 'finish') { setWorking(v); onBusy(v !== ''); }

  /** Reads a line of the interviewer aloud (when the voice is on). */
  function say(text: string, language: Lang) {
    if (!speakOn || !canSpeak) return;
    speaker.current?.stop();
    speaker.current = new ReplySpeaker(language);
    speaker.current.feed(`${text} `);
    speaker.current.finish();
  }

  function begin() {
    if (!role.trim() || !consent) return;
    const first = nextAction(startInterview(role, lang));
    const started = logTurns(first.iv, [{ who: 'interviewer', text: INTRO[lang] }, { who: 'interviewer', text: first.action.text }]);
    setError(''); setNote('');
    onChange(setInterview(projectRef.current, started));
    say(`${INTRO[lang]} ${first.action.text}`, lang);
  }

  /** Reads what the agent returned; sets the message and returns '' when there is nothing usable. */
  function usable(text: string, what: string): string {
    const t = text.trim();
    if (!t) { setNote(`Stopped. ${what}`); return ''; }
    if (t.startsWith('⚠️')) { setError(t.replace(/^⚠️\s*/, '')); return ''; }
    return t;
  }

  async function send(spoken?: string) {
    const base = projectRef.current.interview;
    const text = (spoken ?? answer).trim();
    const via = spoken !== undefined ? 'voice' : viaRef.current;
    if (!base || !text || busy || !ready || base.pending === null || base.pending.kind === 'done') return;
    setBusy('answer'); setError(''); setNote('');
    try {
      const reply = usable(await generate(turnPrompt(base, text), `Interview: ${base.role}`, session), 'Your answer was not used and is still in the box.');
      if (!alive.current || !reply) return;
      const notes = parseModelOut(reply);
      if (!notes) { setError('I could not read the notes for this answer. Your answer is still in the box: send it again.'); return; }
      const next = nextAction(ingest(base, notes, text));
      setAnswer(''); viaRef.current = 'text';
      onChange(setInterview(projectRef.current, logTurns(next.iv, [{ who: 'person', text, via }, { who: 'interviewer', text: next.action.text }])));
      say(next.action.text, base.lang);
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? 'The agent could not answer.');
    } finally {
      if (alive.current) setBusy('');
    }
  }

  function skipQuestion() {
    const base = projectRef.current.interview;
    if (!base || busy || base.pending === null || base.pending.kind === 'done') return;
    const next = nextAction(skip(base));
    setAnswer(''); viaRef.current = 'text';
    onChange(setInterview(projectRef.current, logTurns(next.iv, [{ who: 'person', text: base.lang === 'de' ? '(übersprungen)' : '(skipped)' }, { who: 'interviewer', text: next.action.text }])));
    say(next.action.text, base.lang);
  }

  async function finish() {
    const base = projectRef.current.interview;
    if (!base || busy || !ready || base.entries.length === 0) return;
    setBusy('finish'); setError(''); setNote('');
    try {
      const reply = usable(await generate(intentPrompt(base, project.kind, projectRef.current.intent.goal, LISTS), `Interview: ${base.role} (intent)`, session), 'Nothing was changed.');
      if (!alive.current || !reply) return;
      const proposal = parseIntentProposal(reply, LISTS);
      if (!proposal) { setError('I could not read the intent that the agent wrote. Try again.'); return; }
      onChange(applyInterview(projectRef.current, { ...base, finished: true, pending: null }, proposal));
      onFinished();
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? 'The agent could not answer.');
    } finally {
      if (alive.current) setBusy('');
    }
  }

  async function toggleMic() {
    setError('');
    if (mic === 'transcribing') return;
    if (mic === 'recording') {
      const current = recording.current;
      recording.current = null;
      if (!current) return;
      setMic('transcribing');
      try {
        const { audio, mimeType } = await current.stop();
        const result = await window.host?.voice?.transcribe(audio, mimeType);
        if (!result?.ok) throw new Error(result?.detail ?? 'Speech recognition is not available.');
        const heard = (result.text ?? '').trim();
        if (!heard) throw new Error('Nothing was understood. Please speak again.');
        if (autoSend) void send(heard);
        else { setAnswer((a) => [a.trim(), heard].filter(Boolean).join(' ')); viaRef.current = 'voice'; }
      } catch (e: any) {
        if (alive.current) setError(e?.message ?? String(e));
      } finally {
        if (alive.current) setMic('idle');
      }
      return;
    }
    if (!hasKey) { setError('To answer by voice, enter the Deepgram key in the settings first. You can type the answer meanwhile.'); return; }
    if (speechSupported()) window.speechSynthesis.cancel();
    try {
      recording.current = await startRecording(() => void toggleMic());
      setMic('recording');
    } catch (e: any) {
      setError(/denied|permission|notallowed/i.test(String(e?.name ?? e?.message)) ? 'The microphone is blocked. Allow it for this app and try again.' : (e?.message ?? 'No microphone found.'));
    }
  }

  function saveResult() {
    const cur = projectRef.current.interview;
    if (!cur) return;
    saveFile(`process-interview-${skillSlug(cur.role) || 'role'}.md`, interviewMarkdown(cur), 'text/markdown;charset=utf-8');
  }

  function again() {
    if (busy || !window.confirm('Start a new interview? The log and the notes of this one are removed. Save the interview as a file first if you want to keep it. The form keeps what is in it.')) return;
    const { interview: _dropped, ...rest } = projectRef.current;
    recording.current?.cancel(); recording.current = null; setMic('idle'); if (speechSupported()) window.speechSynthesis.cancel();
    setAnswer(''); setError(''); setNote(''); setConsent(false);
    onChange({ ...rest, updatedAt: Date.now() });
  }

  if (!iv) {
    return (
      <section className="dev-iv" aria-label="Process interview">
        <p className="dev-lead">
          Joule interviews the person who does the work. It asks one short question at a time and reads it aloud if you like; the person answers by voice or text.
          Each answer decides the next question: Joule asks again in other words, digs deeper where an answer sounds like a hidden rule, and summarises from time to time.
          At the end you get the interview as a Markdown file with every question and answer, and the intent form filled in from it. You check the form before anything is written.
        </p>
        <div className="dev-mask">
          <label>Role of the person who answers <span className="dev-opt">role, not name</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} placeholder="Accounts payable clerk" />
          </label>
          <label>Language of the questions
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="en">English</option><option value="de">Deutsch</option></select>
          </label>
          <p className="dev-note">The whole conversation is saved word by word in this project, and the voice answers are sent to the speech service to be turned into text. Use the role instead of the name, and tell the person this before you start.</p>
          <label className="dev-iv-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I have told the person what this is used for and that the conversation is recorded as text, and they agree.</span>
          </label>
          <div className="dev-next"><button className="dev-primary" onClick={begin} disabled={!role.trim() || !consent || !ready}>Start the interview</button></div>
          {!ready && <p className="dev-warn" role="status">The agent is not connected yet.</p>}
        </div>
      </section>
    );
  }

  const cover = coverage(iv);
  const waiting = iv.pending !== null && iv.pending.kind !== 'done';
  const over = iv.finished || iv.pending?.kind === 'done';
  const hasForm = project.intent.process.trim() !== '';
  return (
    <section className="dev-iv" aria-label="Process interview">
      <div className="dev-iv-head">
        <span>Role: <strong>{iv.role}</strong></span>
        <button className="ghost-btn small" onClick={again} disabled={busy}>New interview</button>
      </div>
      <div className="dev-chips" aria-label="What is covered so far">
        {cover.map((c) => (
          <span key={c.key} className={`dev-chip ${c.fill >= DONE_THRESHOLD ? 'dev-chip-on' : ''}`} title={c.required ? 'Needed' : 'Optional'}
            aria-label={`${c.label}: ${c.fill >= DONE_THRESHOLD ? 'covered' : 'open'}${c.required ? ', needed' : ''}`}>{c.label}{c.required ? ' *' : ''}</span>
        ))}
      </div>
      <div className="dev-iv-log" ref={logRef} role="log" aria-live="polite" aria-label="Interview">
        {lines.length === 0 && <p className="dev-note">{iv.entries.length} note(s) are kept. This interview was recorded before the log existed, so there is no conversation text.</p>}
        {lines.map((l, n) => <p key={n} className={`dev-iv-line dev-iv-${l.who}`}><span className="dev-iv-who">{l.who === 'interviewer' ? 'Joule' : l.via === 'voice' ? 'Answer (spoken)' : 'Answer'}</span>{l.text}</p>)}
        {busy && <p className="dev-busy" role="status"><span className="dev-spinner" aria-hidden="true" /><span>{working === 'finish' ? 'Filling in the form…' : 'Taking notes…'}</span><button className="ghost-btn ghost-danger" onClick={onStop}>Stop</button></p>}
      </div>
      {error && <p className="dev-error" role="alert">{error}</p>}
      {note && <p className="dev-note" role="status">{note}</p>}
      {waiting && (
        <div className="dev-iv-voice">
          {canSpeak && <label><input type="checkbox" checked={speakOn} onChange={(e) => setSpeakOn(e.target.checked)} />Read the questions aloud</label>}
          <label><input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />Send the answer right after speaking</label>
          {canSpeak && lines.length > 0 && lines[lines.length - 1].who === 'interviewer' && <button className="ghost-btn small" type="button" onClick={() => say(lines[lines.length - 1].text, iv.lang)}>Hear the question again</button>}
        </div>
      )}
      {waiting && (
        <form className="dev-iv-answer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea ref={answerRef} value={answer} rows={3} onChange={(e) => setAnswer(e.target.value)} disabled={busy} aria-label="Answer" placeholder="Answer in your own words. Enter sends, Shift+Enter starts a new line."
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          <div className="dev-next">
            <button className={mic === 'recording' ? 'dev-primary' : 'ghost-btn'} type="button" onClick={() => void toggleMic()} disabled={busy || mic === 'transcribing' || !ready} aria-pressed={mic === 'recording'}>
              <span className="dev-iv-mic">{mic === 'recording' && <span className="dev-iv-rec" aria-hidden="true" />}{mic === 'recording' ? 'Stop and send' : mic === 'transcribing' ? 'Transcribing…' : 'Answer by voice'}</span>
            </button>
            <button className="dev-primary" type="submit" disabled={busy || !answer.trim() || !ready || mic !== 'idle'}>Send</button>
            <button className="ghost-btn" type="button" onClick={skipQuestion} disabled={busy}>Skip this question</button>
          </div>
        </form>
      )}
      <div className="dev-next">
        {over && <p className="dev-note">The interview is complete.</p>}
        <button className={over ? 'dev-primary' : 'ghost-btn'} onClick={() => void finish()} disabled={busy || !ready || iv.entries.length === 0}>
          {over ? 'Fill in the form from the interview' : 'Finish now and fill in the form'}
        </button>
        {iv.transcript.length > 0 && <button className="ghost-btn" onClick={saveResult}>Save the interview (.md)</button>}
        {hasForm && !busy && <span className="dev-note">The form already holds a process description from an earlier interview.</span>}
      </div>
      <Notes iv={iv} />
    </section>
  );
}

function Notes({ iv }: { iv: NonNullable<Project['interview']> }) {
  return (
    <details className="dev-iv-notes">
      <summary>What I have noted so far ({iv.entries.length})</summary>
      {SLOTS.map((s) => {
        const items = iv.entries.filter((e) => e.slot === s.key);
        return items.length ? <div key={s.key}><h4>{s.label}</h4><ul>{items.map((e) => <li key={e.id}>{e.text}{e.confidence < 0.5 ? ' (unsure)' : ''}</li>)}</ul></div> : null;
      })}
      {iv.handoffs.length > 0 && <p className="dev-note">Hands over to (candidates for the next interview): {iv.handoffs.join(', ')}</p>}
      {iv.entries.length === 0 && <p className="dev-note">Nothing yet.</p>}
    </details>
  );
}
