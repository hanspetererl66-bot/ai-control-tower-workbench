/**
 * Spaces cannot talk to each other (each runs in its own sandboxed frame), so a hand-over goes through the host:
 *   Space A  posts { type: 'wb:handoff', to: '<slug>', payload: {...} }   → the host opens Space B and delivers it
 *   Space B  posts { type: 'wb:handoff', to: '<from>', payload: {...} }   → back to A (the host tells B who sent it)
 * With open:false the host only queues the message (delivered when that Space is opened next) and shows `notice` as a toast.
 * A Space keeps its own working state across such a trip by posting { type: 'wb:state', state: {...} } while it works;
 * the host holds the latest copy in memory and posts { type: 'wb:restore', state, handoffs: [...] } when the frame has loaded.
 * The host checks shape and size only; it never runs anything from the payload.
 */
export const MAX_HANDOFF_BYTES = 40_000;
export const MAX_STATE_BYTES = 300_000;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;

export type Handoff = { to: string; payload: Record<string, unknown>; open: boolean; notice?: string };
export type IncomingHandoff = { from: string; payload: Record<string, unknown>; nonce: number };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sizeOf = (v: unknown): number => { try { return JSON.stringify(v).length; } catch { return Infinity; } };

export function parseHandoffMessage(data: unknown): Handoff | null {
  if (!isPlainObject(data) || data.type !== 'wb:handoff') return null;
  if (typeof data.to !== 'string' || !SLUG.test(data.to) || !isPlainObject(data.payload)) return null;
  if (sizeOf(data.payload) > MAX_HANDOFF_BYTES) return null;
  const notice = typeof data.notice === 'string' ? data.notice.replace(/\s+/g, ' ').trim().slice(0, 160) : undefined;
  return { to: data.to, payload: data.payload, open: data.open !== false, ...(notice ? { notice } : {}) };
}

export function parseStateMessage(data: unknown): Record<string, unknown> | null {
  if (!isPlainObject(data) || data.type !== 'wb:state' || !isPlainObject(data.state)) return null;
  return sizeOf(data.state) <= MAX_STATE_BYTES ? data.state : null;
}

/** What the host posts into a freshly loaded frame. */
export function restoreMessage(state: Record<string, unknown> | undefined, handoffs: IncomingHandoff[]) {
  return { type: 'wb:restore', state: state ?? null, handoffs: handoffs.map((h) => ({ from: h.from, payload: h.payload })) };
}
