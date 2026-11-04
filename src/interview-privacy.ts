/**
 * Privacy helpers for the process interview: pattern-based redaction, the notice for the interviewee and the
 * retention choices. Redaction is a safety net, not a guarantee: it finds e-mail addresses, phone numbers, IBANs and
 * names that follow a title or "my name is". It does not recognise other names.
 */

export type NoticeBi = { en: string; de: string };

export const NOTICE: NoticeBi = {
  en: 'This interview is about how the work runs, not about you. Your answers are written down word by word and, if you answer by voice, sent to a speech service to be turned into text. We note your role, not your name, and remove e-mail addresses, phone numbers and bank numbers. The notes are used to describe the process and to prepare an automation. You can skip any question, stop at any time, and ask for the log to be deleted. It is deleted automatically after the retention period.',
  de: 'In diesem Interview geht es darum, wie die Arbeit läuft, nicht um dich. Deine Antworten werden Wort für Wort aufgeschrieben und, wenn du sprichst, an einen Spracherkennungsdienst geschickt und in Text umgewandelt. Wir notieren deine Rolle, nicht deinen Namen, und entfernen E-Mail-Adressen, Telefon- und Kontonummern. Die Notizen beschreiben den Prozess und bereiten eine Automatisierung vor. Du kannst jede Frage überspringen, jederzeit aufhören und das Protokoll löschen lassen. Nach der Aufbewahrungsfrist wird es automatisch gelöscht.',
};

export const RETENTION_CHOICES = [30, 90, 365, 0] as const;
export const DEFAULT_RETENTION_DAYS = 90;
export const retentionLabel = (days: number, lang: 'en' | 'de' = 'en') =>
  days === 0 ? (lang === 'de' ? 'bis zum manuellen Löschen' : 'until deleted by hand') : lang === 'de' ? `${days} Tage` : `${days} days`;

const DAY = 86_400_000;
/** True when the retention period (in days; 0 = never) has passed since `since`. */
export const isExpired = (since: number, days: number, now = Date.now()) => days > 0 && since > 0 && now - since > days * DAY;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g;
const PHONE = /(?<![\w])(?:\+|0)\d[\d ()\/.-]{7,}\d(?![\w])/g;
const TITLED = /\b(Herrn?|Frau|Mr\.?|Mrs\.?|Ms\.?|Dr\.|Prof\.)\s+(?:[A-ZÄÖÜ][\p{L}'-]+)(?:\s+[A-ZÄÖÜ][\p{L}'-]+)?/gu;
const SELF = /\b(ich heiße|mein Name ist|my name is|I am called|ich bin der|ich bin die)\s+(?:[A-ZÄÖÜ][\p{L}'-]+)(?:\s+[A-ZÄÖÜ][\p{L}'-]+)?/giu;

/** Replaces personal data with labelled placeholders. */
export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(IBAN, '[iban]')
    .replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone]' : m))
    .replace(TITLED, (_m, title: string) => `${title} [name]`)
    .replace(SELF, (_m, lead: string) => `${lead} [name]`);
}
