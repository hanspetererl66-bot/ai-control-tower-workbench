import { createSpeechSplitter, type SpeechSplitter } from './voice-text';

export type VoiceSettings = { language: 'de' | 'en'; speak: boolean; autoSend: boolean; hasKey: boolean };

export const DEFAULT_VOICE: VoiceSettings = { language: 'de', speak: false, autoSend: false, hasKey: false };

/** Hard stop so a forgotten recording cannot grow past the 10 MB upload limit. */
export const MAX_RECORDING_MS = 120_000;

export type Recording = { stop: () => Promise<{ audio: ArrayBuffer; mimeType: string }>; cancel: () => void };

function pickMimeType(): string {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/** Start recording from the microphone. Rejects when permission is denied or there is no device. */
export async function startRecording(onAutoStop?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const timer = setTimeout(() => onAutoStop?.(), MAX_RECORDING_MS);
  recorder.start();
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        clearTimeout(timer);
        recorder.onerror = () => {
          release();
          reject(new Error('Aufnahme fehlgeschlagen.'));
        };
        recorder.onstop = async () => {
          release();
          const type = recorder.mimeType || mimeType || 'audio/webm';
          resolve({ audio: await new Blob(chunks, { type }).arrayBuffer(), mimeType: type });
        };
        if (recorder.state === 'inactive') recorder.onstop?.(new Event('stop'));
        else recorder.stop();
      }),
    cancel: () => {
      clearTimeout(timer);
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function pickVoice(language: 'de' | 'en'): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith(language));
  return voices.find((voice) => voice.localService && /premium|enhanced|natural/i.test(voice.name))
    ?? voices.find((voice) => voice.localService)
    ?? voices[0];
}

/** Reads a streaming reply aloud sentence by sentence, using the system voices (no cloud, no key). */
export class ReplySpeaker {
  private splitter: SpeechSplitter = createSpeechSplitter();
  constructor(private language: 'de' | 'en') {}

  private say(sentences: string[]) {
    if (!speechSupported()) return;
    const voice = pickVoice(this.language);
    for (const sentence of sentences) {
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = this.language === 'de' ? 'de-DE' : 'en-US';
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    }
  }

  feed(chunk: string) {
    this.say(this.splitter.push(chunk));
  }

  finish() {
    this.say(this.splitter.flush());
  }

  stop() {
    this.splitter = createSpeechSplitter();
    if (speechSupported()) window.speechSynthesis.cancel();
  }
}
