/**
 * Confirmation mail of the Customer Hotline, built and sent only by the main process.
 * The Space delivers a few plain fields (request, customer name, task, window). Subject and text are built here from fixed
 * wording, the recipient is NOT taken from the Space: it comes from a local file (the test address), and sending needs a
 * confirmation in a dialog the Space cannot reach. The Gmail login stays in the main process and is never shown to a Space.
 * The Gmail agent connector still has no send tool; this module uses only its plain API client.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '../connectors/gmail/server/gmail.mjs';

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const ID = /^[A-Za-z0-9._-]{1,30}$/;
const EMAIL = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;
export class MailError extends Error {}

/** One line of plain text: no control characters, no line breaks, cut to length. */
const line = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function readFields(f) {
  const o = f && typeof f === 'object' ? f : {};
  const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : '';
  const customer = line(o.customer, 80), task = line(o.task, 80), target = line(o.target, 60);
  const start = typeof o.start === 'string' && TIME.test(o.start) ? o.start : '', end = typeof o.end === 'string' && TIME.test(o.end) ? o.end : '';
  if (!id || !customer || !task || !target) throw new MailError('The request is incomplete: id, customer, task and system are needed.');
  if (!start || !end || end <= start) throw new MailError('The agreed window is missing or invalid.');
  return { id, customer, task, target, start, end };
}

const show = (t) => t.replace('T', ' ');

/** The text is fixed; only the plain fields are filled in. */
export function buildMail(fields, to) {
  const f = readFields(fields);
  const subject = `[TEST] Downtime window confirmed: ${f.task} on ${f.target} (${f.id})`;
  const body = [
    'This is a test mail of the Werkbank prototype. The real customer has not been contacted.',
    '',
    `Dear ${f.customer} team,`,
    '',
    `as agreed with our hotline, the following downtime window is confirmed for service request ${f.id}:`,
    '',
    `  Task:    ${f.task}`,
    `  System:  ${f.target}`,
    `  Window:  ${show(f.start)} to ${show(f.end)}`,
    '',
    'If this does not match what you agreed, please answer this mail or call the hotline before the window starts.',
    '',
    'Kind regards',
    'Infrastructure Operations',
  ].join('\n');
  return { to, subject, body };
}

/** RFC 5322 message, base64url as the Gmail API wants it. Subject and body are encoded, so no text can add a header. */
export function rawMessage({ to, subject, body }) {
  if (!EMAIL.test(to)) throw new MailError('The recipient is not a valid address.');
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const text = b64(body).replace(/(.{76})/g, '$1\r\n');
  const head = [`To: ${to}`, `Subject: =?UTF-8?B?${b64(line(subject, 200))}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  return Buffer.from(`${head.join('\r\n')}\r\n\r\n${text}`, 'utf8').toString('base64url');
}

/** The local file { "to": "address" } names the only recipient. It is not part of the repo. */
export function readRecipient(file) {
  let to = '';
  try { to = String(JSON.parse(readFileSync(file, 'utf8')).to ?? '').trim(); } catch { /* missing or unreadable */ }
  if (!EMAIL.test(to)) throw new MailError('No test recipient is set. Create goose-home/hotline-mail.json with {"to": "address"}.');
  return to;
}

/**
 * confirm(mail) → Promise<boolean> asks the person in a dialog; log(entry) writes the protocol; env holds the Gmail login.
 */
export function createHotlineMail({ recipientFile, env, confirm, log = () => {}, fetchImpl = fetch, now = () => new Date() }) {
  return {
    preview(fields) { const m = buildMail(fields, readRecipient(recipientFile)); return { to: m.to, subject: m.subject, body: m.body }; },
    async send(fields) {
      const mail = buildMail(fields, readRecipient(recipientFile));
      if (!(await confirm(mail))) return { sent: false, reason: 'declined' };
      const client = createClient(typeof env === 'function' ? env() : env, fetchImpl);
      const res = await client.call('/users/me/messages/send', { method: 'POST', body: { raw: rawMessage(mail) } });
      const at = now().toISOString();
      log({ at, to: mail.to, subject: mail.subject, request: readFields(fields).id, messageId: res?.id ?? '' });
      return { sent: true, at, to: mail.to };
    },
  };
}
