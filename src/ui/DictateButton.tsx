import { useEffect, useRef, useState } from 'react';
import { startRecording, type Recording } from '../voice';

type Props = { onText: (heard: string) => void; label?: string };

/**
 * Small microphone button for text fields: first click starts the recording, second click stops it and the
 * transcript is handed to `onText`. Uses the same Deepgram key and IPC route as the chat; hidden when the
 * app has no voice bridge (browser preview).
 */
export default function DictateButton({ onText, label = 'Dictate' }: Props) {
  const [mic, setMic] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const recording = useRef<Recording | null>(null);
  const alive = useRef(true);
  const available = Boolean(window.host?.voice);

  useEffect(() => {
    alive.current = true;
    void window.host?.voice?.getSettings().then((v) => { if (alive.current) setHasKey(Boolean(v?.hasKey)); }).catch(() => undefined);
    return () => { alive.current = false; recording.current?.cancel(); };
  }, []);

  if (!available) return null;

  async function toggle() {
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
        if (alive.current) onText(heard);
      } catch (e: any) {
        if (alive.current) setError(e?.message ?? String(e));
      } finally {
        if (alive.current) setMic('idle');
      }
      return;
    }
    if (!hasKey) { setError('To dictate, enter the Deepgram key in the settings first.'); return; }
    try {
      recording.current = await startRecording(() => void toggle());
      setMic('recording');
    } catch (e: any) {
      setError(/denied|permission|notallowed/i.test(String(e?.name ?? e?.message)) ? 'The microphone is blocked. Allow it for this app and try again.' : (e?.message ?? 'No microphone found.'));
    }
  }

  const text = mic === 'recording' ? 'Stop dictation' : mic === 'transcribing' ? 'Transcribing…' : label;
  return (
    <>
      <button type="button" className={`dictate-btn${mic === 'recording' ? ' dictate-on' : ''}`} onClick={() => void toggle()}
        disabled={mic === 'transcribing'} aria-pressed={mic === 'recording'} aria-label={text} title={text}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
        {mic === 'recording' && <span className="dev-iv-rec" aria-hidden="true" />}
      </button>
      {error && <span className="dictate-err" role="alert">{error}</span>}
    </>
  );
}
