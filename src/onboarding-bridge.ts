/**
 * Bridge for the Onboarding Space. The Space may send three fixed requests and nothing else:
 *   ob:list-request     → ob:list    (the onboarding cases this person may see, and signed hires that wait for the handover)
 *   ob:handover-request → ob:handed  (HR hands a signed hire over to onboarding; the database accepts only the HR approver)
 *   ob:set-request      → ob:set     (one step: done, blocked with a reason, not applicable, or open again)
 * Everything runs through the main process as the stored e-mail, not through the agent: the agent has no tool for it.
 * The answer is cut down to the fields the Space renders (the new hire's name is not in the Werkbank).
 */
export const ONBOARDING_SPACE = 'onboarding';

type Res = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
export interface OnboardingHost {
  list: () => Promise<Res>;
  handover?: (id: number, start: string) => Promise<Res>;
  set?: (id: number, step: string, status: string, note: string) => Promise<Res>;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const STEP = /^[a-z0-9_]{2,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const STEP_STATUSES = ['open', 'done', 'blocked', 'na'] as const;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const rows = (v: unknown, max: number): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject).slice(0, max) : []);

export function pickOnboarding(raw: unknown): { cases: Record<string, unknown>[]; ready: Record<string, unknown>[] } {
  const d = isObject(raw) ? raw : {};
  const cases = rows(d.cases, 200).map((c) => ({
    id: typeof c.id === 'number' ? c.id : 0, requisition: str(c.requisition, 40), title: str(c.title, 120), dept: str(c.dept, 60), candidate: str(c.candidate, 40),
    start: str(c.start, 10), handedOverAt: str(c.handedOverAt, 40), handedOverBy: str(c.handedOverBy, 120),
    contract: isObject(c.contract) ? { status: str(c.contract.status, 20), signedAt: str(c.contract.signedAt, 40) } : null,
    steps: rows(c.steps, 40).map((s) => ({ id: str(s.id, 40), status: (STEP_STATUSES as readonly string[]).includes(str(s.status, 10)) ? str(s.status, 10) : 'open', note: str(s.note, 300), by: str(s.by, 120), at: str(s.at, 40) })),
  }));
  const ready = rows(d.ready, 200).map((r) => ({ id: typeof r.id === 'number' ? r.id : 0, requisition: str(r.requisition, 40), title: str(r.title, 120), dept: str(r.dept, 60), signedAt: str(r.signedAt, 40) }));
  return { cases, ready };
}

export async function handleOnboardingMessage(data: unknown, host: OnboardingHost | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || typeof data.type !== 'string') return null;
  if (!['ob:list-request', 'ob:handover-request', 'ob:set-request'].includes(data.type)) return null;
  const requestId = typeof data.requestId === 'string' && REQUEST_ID.test(data.requestId) ? data.requestId : null;
  if (!requestId) return null;
  const fail = (message: string) => ({ type: 'ct:error', requestId, message });
  if (!host) return fail('Onboarding needs the desktop app and the shared database.');
  try {
    if (data.type === 'ob:list-request') {
      const res = await host.list();
      return res.ok ? { type: 'ob:list', requestId, ...pickOnboarding(res.data) } : fail(res.error);
    }
    const id = data.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return fail('Unknown hire.');
    if (data.type === 'ob:handover-request') {
      const start = typeof data.start === 'string' && DATE.test(data.start) ? data.start : '';
      if (!start) return fail('A start date is needed (like 2027-01-11).');
      if (!host.handover) return fail('The handover needs the desktop app.');
      const res = await host.handover(id, start);
      return res.ok ? { type: 'ob:handed', requestId, result: { id, created: res.data?.created === true } } : fail(res.error);
    }
    const step = typeof data.step === 'string' && STEP.test(data.step) ? data.step : '';
    const status = (STEP_STATUSES as readonly string[]).includes(String(data.status)) ? String(data.status) : '';
    const note = str(data.note, 300).trim();
    if (!step || !status) return fail('Unknown step or status.');
    if (status === 'blocked' && !note) return fail('A reason is needed to mark a step as blocked.');
    if (!host.set) return fail('Marking a step needs the desktop app.');
    const res = await host.set(id, step, status, note);
    return res.ok ? { type: 'ob:set', requestId, result: { id, step, status } } : fail(res.error);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
