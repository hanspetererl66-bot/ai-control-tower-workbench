/**
 * What happens with the answer of a recurring briefing: a PDF is made and, if asked for, an email draft with the PDF
 * attached is created. The Gmail connector can only create drafts, so the person always has the last word.
 */
import { scheduleTitle, type Schedule } from './schedules.ts';

/** Largest PDF that is attached (the draft would be refused far above this anyway). */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
/** The installed Gmail connector (its name starts with gmail, for example gmail-drafts). */
export const gmailExtension = (names: string[]): string => names.find((n) => /^gmail/i.test(n)) ?? '';

/** A run that ended in an error message instead of an answer is not delivered. */
export const isFailedAnswer = (text: string): boolean => !text.trim() || /^\s*⚠️/.test(text);

export function briefingSubject(s: Pick<Schedule, 'name' | 'prompt'>, now = new Date()): string {
  return `Briefing: ${scheduleTitle(s).replace(/\s+/g, ' ')} (${now.toISOString().slice(0, 10)})`.slice(0, 150);
}

export function briefingFileName(s: Pick<Schedule, 'name' | 'prompt'>, now = new Date()): string {
  const slug = scheduleTitle(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'briefing';
  return `${slug}-${now.toISOString().slice(0, 10)}.pdf`;
}

/** Arguments for the Gmail tool `create_draft`. The body is short; the answer itself is in the PDF. */
export function emailDraftArgs(s: Schedule, fileName: string, pdfBase64: string, answer: string, now = new Date()): Record<string, unknown> {
  const first = answer.trim().split(/\n{2,}/)[0]?.replace(/[#*_`>]/g, '').trim().slice(0, 400) ?? '';
  return {
    to: s.delivery?.to ?? '',
    subject: briefingSubject(s, now),
    body: `Your recurring briefing "${scheduleTitle(s)}" is attached as a PDF.${first ? `\n\nBeginning of the answer:\n${first}` : ''}\n\nCreated by Werkbank. This is a draft: check it and send it from Gmail.`,
    attachments: [{ filename: fileName, content_base64: pdfBase64, mime_type: 'application/pdf' }],
  };
}

export function deliveryLabel(s: Pick<Schedule, 'delivery'>): string {
  const d = s.delivery;
  if (!d?.pdf) return '';
  return d.email ? `PDF + email draft to ${d.to}` : 'PDF';
}

export type DeliveryDeps = {
  buildHtml: (title: string, text: string) => string;
  renderPdf: (request: { html: string; fileName: string }) => Promise<{ ok: boolean; detail?: string; path?: string; base64?: string }>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ isError?: boolean; content?: Array<{ text?: string }> } | unknown>;
  /** Name of the installed Gmail connector, empty when there is none. */
  gmail: string;
};

export type DeliveryResult = { status: 'ok' | 'error'; note: string; pdfPath?: string };

const toolFailed = (result: unknown): string => {
  const r = result as { isError?: boolean; content?: Array<{ text?: string }> } | null;
  return r?.isError ? (r.content?.map((c) => c.text).filter(Boolean).join(' ') || 'the tool refused the request').slice(0, 160) : '';
};

/** Makes the PDF and, if asked for, the email draft. Never throws; the result says what happened in one line. */
export async function deliverBriefing(s: Schedule, answer: string, deps: DeliveryDeps, now = new Date()): Promise<DeliveryResult> {
  if (isFailedAnswer(answer)) return { status: 'error', note: 'No answer, so nothing was delivered.' };
  if (!s.delivery?.pdf) return { status: 'ok', note: 'Shown in the chat.' };
  const fileName = briefingFileName(s, now);
  let pdf;
  try {
    pdf = await deps.renderPdf({ html: deps.buildHtml(scheduleTitle(s), answer), fileName });
  } catch (e) {
    pdf = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  if (!pdf.ok || !pdf.path || !pdf.base64) return { status: 'error', note: `PDF failed: ${pdf.detail ?? 'not available in this window'}` };
  if (!s.delivery.email) return { status: 'ok', note: `PDF saved: briefings/${fileName}`, pdfPath: pdf.path };
  if (!deps.gmail) return { status: 'error', note: `PDF saved (briefings/${fileName}), but the Gmail connector is not connected, so no draft was made.`, pdfPath: pdf.path };
  try {
    const failed = toolFailed(await deps.callTool(`${deps.gmail}__create_draft`, emailDraftArgs(s, fileName, pdf.base64, answer, now)));
    if (failed) return { status: 'error', note: `PDF saved, draft failed: ${failed}`, pdfPath: pdf.path };
  } catch (e) {
    return { status: 'error', note: `PDF saved, draft failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`, pdfPath: pdf.path };
  }
  return { status: 'ok', note: `PDF saved and draft for ${s.delivery.to} created in Gmail (not sent).`, pdfPath: pdf.path };
}
