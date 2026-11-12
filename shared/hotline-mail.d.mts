export class MailError extends Error {}
export interface MailFields { id: string; customer: string; task: string; target: string; start: string; end: string }
export interface Mail { to: string; subject: string; body: string }
export function readFields(f: unknown): MailFields;
export function buildMail(fields: unknown, to: string): Mail;
export function rawMessage(mail: Mail): string;
export function readRecipient(file: string): string;
export function createHotlineMail(opts: {
  recipientFile: string; env: Record<string, string | undefined> | (() => Record<string, string | undefined>);
  confirm: (mail: Mail) => Promise<boolean>; log?: (entry: Record<string, string>) => void; fetchImpl?: typeof fetch; now?: () => Date;
}): { preview(fields: unknown): Mail; send(fields: unknown): Promise<{ sent: boolean; reason?: string; at?: string; to?: string }> };
