/**
 * Bridge for the Customer Hotline Space. The Space may send two fixed requests and nothing else:
 *   hm:preview-request → hm:preview  (the confirmation mail as the main process would send it: recipient, subject, text)
 *   hm:send-request    → hm:sent     (the main process asks the person in its own dialog, then sends through Gmail)
 * The Space delivers plain fields only. Recipient, wording and the Gmail login belong to the main process, never to the Space or the agent.
 */
export const HOTLINE_SPACE = 'infra-hotline';

type Res = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
export interface HotlineMailHost {
  preview: (fields: Record<string, string>) => Promise<Res>;
  send?: (fields: Record<string, string>) => Promise<Res>;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const FIELDS: Array<[string, number]> = [['id', 30], ['customer', 80], ['task', 80], ['target', 60], ['start', 16], ['end', 16]];

export function pickFields(raw: unknown): Record<string, string> {
  const o = isObject(raw) ? raw : {};
  return Object.fromEntries(FIELDS.map(([k, max]) => [k, str(o[k], max)]));
}

export async function handleHotlineMailMessage(data: unknown, host: HotlineMailHost | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || typeof data.type !== 'string' || !['hm:preview-request', 'hm:send-request'].includes(data.type)) return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'ct:error', requestId, message });
  if (!host) return fail('Sending the confirmation needs the desktop app.');
  const fields = pickFields(data.fields);
  try {
    if (data.type === 'hm:preview-request') {
      const res = await host.preview(fields);
      return res.ok ? { type: 'hm:preview', requestId, mail: { to: str(res.data.to, 200), subject: str(res.data.subject, 300), body: str(res.data.body, 4000) } } : fail(res.error);
    }
    if (!host.send) return fail('Sending needs the desktop app.');
    const res = await host.send(fields);
    return res.ok ? { type: 'hm:sent', requestId, result: { sent: res.data.sent === true, reason: str(res.data.reason, 40), at: str(res.data.at, 40), to: str(res.data.to, 200) } } : fail(res.error);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
