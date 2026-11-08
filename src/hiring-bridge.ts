/**
 * Bridge for the Hiring Approvals Space. The Space may send three fixed requests and nothing else:
 *   ha:list-request    → ha:list      (the hiring requests this person may see)
 *   ha:decide-request  → ha:decided   (Approve, Return or Decline of the step that is this person's turn)
 *   ha:release-request → ha:released  (HR releases the prepared contract; the database accepts only the HR approver)
 *   ha:open-tools      → (no reply)   the App opens the proposals and criteria screen
 * Both reads and decisions go through the main process as the stored e-mail, not through the agent: the agent has no tool to decide.
 * The answer is cut down to the fields the Space renders (no free text beyond the notes, no contact data).
 */
export const HIRING_SPACE = 'hiring-approvals';

export interface HiringHost {
  release?: (id: number) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
  list: (args: Record<string, unknown>) => Promise<{ ok: true; data: { requests?: unknown[] } } | { ok: false; error: string }>;
  decide: (id: number, decision: 'approve' | 'return' | 'decline', note: string) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const STATUS = ['pending', 'approved', 'returned', 'declined'];
const DECISIONS = ['approve', 'return', 'decline'] as const;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rows = (v: unknown, max: number): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject).slice(0, max) : []);

/** The state of the contract only: never its text and never the signed document (those stay in the database). */
export function pickContract(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw)) return null;
  const status = str(raw.status, 20);
  if (!['prepared', 'released', 'sent', 'signed', 'declined', 'expired'].includes(status)) return null;
  return {
    status, template: str(raw.template, 40), bodySha256: str(raw.bodySha256, 64), provider: str(raw.provider, 60),
    preparedAt: str(raw.preparedAt, 40), releasedAt: str(raw.releasedAt, 40), releasedBy: str(raw.releasedBy, 120), mine: raw.mine === true, sentAt: str(raw.sentAt, 40), expiresAt: str(raw.expiresAt, 40), decidedAt: str(raw.decidedAt, 40), signedAt: str(raw.signedAt, 40),
    signedSha256: str(raw.signedSha256, 64), hasDocument: raw.hasDocument === true, method: str(raw.method, 120),
  };
}

export function pickHireRequests(raw: unknown): Record<string, unknown>[] {
  return rows(raw, 200).map((r) => {
    const t = isObject(r.terms) ? r.terms : {};
    return {
      id: num(r.id), requisition: str(r.requisition, 20), title: str(r.title, 120), dept: str(r.dept, 60), candidate: str(r.candidate, 20),
      terms: { level: str(t.level, 40), band: str(t.band, 40), start_on: str(t.start_on, 10), contract: str(t.contract, 20), note: str(t.note, 300) },
      evidence: str(r.evidence, 600), status: str(r.status, 20), currentStep: num(r.currentStep), createdBy: str(r.createdBy, 120),
      at: str(r.at, 40), decidedAt: str(r.decidedAt, 40), mine: r.mine === true,
      steps: rows(r.steps, 6).map((s) => ({ ord: num(s.ord), role: str(s.role, 20), approver: str(s.approver, 120), status: str(s.status, 20), decidedAt: str(s.decidedAt, 40), note: str(s.note, 300) })),
      events: rows(r.events, 80).map((e) => ({ event: str(e.event, 30), role: str(e.role, 20), actor: str(e.actor, 120), at: str(e.at, 40), note: str(e.note, 300) })),
      contract: pickContract(r.contract),
    };
  });
}

export function pickDecision(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw)) return null;
  return { id: num(raw.id), event: str(raw.event, 30), step: num(raw.step), final: raw.final === true, status: str(raw.status, 20) };
}

export async function handleHiringMessage(data: unknown, host: HiringHost | undefined, onOpenTools?: () => void): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || typeof data.type !== 'string') return null;
  if (data.type === 'ha:open-tools') { onOpenTools?.(); return null; }
  if (data.type !== 'ha:list-request' && data.type !== 'ha:decide-request' && data.type !== 'ha:release-request') return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'ct:error', requestId, message });
  if (!host) return fail('The hiring approvals need the desktop app and the shared database.');
  try {
    if (data.type === 'ha:list-request') {
      const status = typeof data.status === 'string' && STATUS.includes(data.status) ? data.status : 'pending';
      const res = await host.list({ status, limit: 200 });
      return res.ok ? { type: 'ha:list', requestId, status, requests: pickHireRequests(res.data?.requests) } : fail(res.error);
    }
    if (data.type === 'ha:release-request') {
      const rid = data.id;
      if (typeof rid !== 'number' || !Number.isInteger(rid) || rid < 1) return fail('Unknown request.');
      if (!host.release) return fail('Releasing a contract needs the desktop app.');
      const res = await host.release(rid);
      return res.ok ? { type: 'ha:released', requestId, result: { id: num(res.data?.id), status: str(res.data?.status, 20) } } : fail(res.error);
    }
    const id = data.id;
    const decision = DECISIONS.find((d) => d === data.decision);
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || !decision) return fail('Unknown decision.');
    const note = str(data.note, 300).trim();
    if (decision !== 'approve' && !note) return fail('A reason is needed to return or decline.');
    const res = await host.decide(id, decision, note);
    const picked = res.ok ? pickDecision(res.data) : null;
    return res.ok ? (picked ? { type: 'ha:decided', requestId, result: picked } : fail('unexpected answer')) : fail(res.error);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
