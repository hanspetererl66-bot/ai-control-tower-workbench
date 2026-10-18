/**
 * Voice input for the chat. Goose stays the brain; this module only turns recorded audio into text.
 * Audio goes to Deepgram's EU endpoint. The endpoint is fixed on purpose: a user-editable base URL would let
 * a manipulated setting send the API key somewhere else.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEEPGRAM_EU = 'https://api.eu.deepgram.com';
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const LANGUAGES = ['de', 'en'];
const MODELS = ['nova-3', 'nova-2'];

export const DEFAULT_SETTINGS = { language: 'de', speak: false, autoSend: false };

export class VoiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const baseMime = (mimeType) => String(mimeType ?? '').split(';')[0].trim().toLowerCase();

/** Settings (+ optional key) in their own encrypted file. NOT the connector store: that one is flattened into goosed's environment. */
export function createVoiceStore({ file, safeStorage }) {
  function read() {
    try {
      if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return {};
      return JSON.parse(safeStorage.decryptString(readFileSync(file)));
    } catch {
      return {};
    }
  }
  function write(data) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new VoiceError('keychain', 'OS keychain unavailable — refusing to store the voice key in plaintext');
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, safeStorage.encryptString(JSON.stringify(data)));
  }
  const normalize = (data) => ({
    language: LANGUAGES.includes(data.language) ? data.language : DEFAULT_SETTINGS.language,
    speak: data.speak === true,
    autoSend: data.autoSend === true,
  });
  return {
    /** What the renderer may see — never the key itself. */
    getPublic() {
      const data = read();
      return { ...normalize(data), hasKey: typeof data.key === 'string' && data.key.length > 0 };
    },
    getKey() {
      const key = read().key;
      return typeof key === 'string' && key ? key : null;
    },
    /** `key`: string sets, '' removes, undefined keeps. */
    save(patch = {}) {
      const data = read();
      const next = { ...data, ...normalize({ ...data, ...patch }) };
      if (typeof patch.key === 'string') {
        const key = patch.key.trim();
        if (key) next.key = key;
        else delete next.key;
      }
      write(next);
      return this.getPublic();
    },
  };
}

async function request({ audio, mimeType, key, language, model, fetchImpl }) {
  const url = `${DEEPGRAM_EU}/v1/listen?model=${model}&language=${language}&smart_format=true&punctuate=true`;
  return fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': baseMime(mimeType) },
    body: audio,
  });
}

export async function transcribeWithDeepgram({ audio, mimeType, key, language = 'de', fetchImpl = fetch }) {
  if (!key) throw new VoiceError('no-key', 'Kein Deepgram-Key hinterlegt (Einstellungen → Sprache).');
  if (!baseMime(mimeType).startsWith('audio/') && baseMime(mimeType) !== 'video/webm') {
    throw new VoiceError('bad-audio', 'Unbekanntes Audioformat.');
  }
  const bytes = audio?.byteLength ?? audio?.length ?? 0;
  if (!bytes) throw new VoiceError('empty', 'Die Aufnahme ist leer.');
  if (bytes > MAX_AUDIO_BYTES) throw new VoiceError('too-large', 'Die Aufnahme ist zu lang (max. 10 MB).');
  const lang = LANGUAGES.includes(language) ? language : 'de';

  let response;
  for (const model of MODELS) {
    try {
      response = await request({ audio, mimeType, key, language: lang, model, fetchImpl });
    } catch {
      throw new VoiceError('network', 'Deepgram ist nicht erreichbar.');
    }
    // A model that is unavailable for this language / account answers 400 or 422 — try the older one.
    if (response.status !== 400 && response.status !== 422) break;
  }
  if (response.status === 401 || response.status === 403) throw new VoiceError('auth', 'Der Deepgram-Key wurde abgelehnt.');
  if (response.status === 402) throw new VoiceError('quota', 'Das Deepgram-Guthaben ist aufgebraucht.');
  if (response.status === 429) throw new VoiceError('rate', 'Zu viele Anfragen — kurz warten und erneut versuchen.');
  if (!response.ok) throw new VoiceError('http', `Deepgram-Fehler (HTTP ${response.status}).`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new VoiceError('http', 'Unerwartete Antwort von Deepgram.');
  }
  return String(body?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
}

/** Only the app's own page may use the microphone — Spaces are untrusted iframes. Audio only, no camera. */
export function isAppAudioRequest({ permission, details = {}, appOrigin, requestingUrl }) {
  if (permission !== 'media') return false;
  if (details.mediaTypes?.includes('video')) return false;
  if (details.isMainFrame === false) return false;
  const url = requestingUrl ?? details.requestingUrl ?? '';
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}
