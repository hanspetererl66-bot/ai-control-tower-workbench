/**
 * The broker of the agent network, inside the app. It connects the mailbox of the connector `agent-network` with the rules of agent-network.ts:
 * it hands the list of agents that accept questions to the connector, fetches the questions that wait, checks every one with `decide`, runs the
 * asked agent in a session of its own (`runSpecialist`), writes the run records and gives the answer back. Everything it needs from the outside
 * comes in through `NetDeps`, so the tests run the whole path against the real connector handlers with a fake model.
 *
 * Honest limits: the asked agent runs in a new session of the same assistant (its sources are narrowed to the ticked connectors, every permission
 * request is refused, and the question is marked as untrusted text), it is not an operating-system sandbox. The outcome "needs approval" is not
 * released because there is no approval inbox yet.
 */
import { agentPrompt, type Source, type StudioAgent } from './agent-studio.ts';
import { contractOf, decide, logLine, networkBrief, readEnvelope, redact, specialistPrompt, type Decision, type Envelope, type NetMessage } from './agent-network.ts';
import { newRunId, newTrace, type AgentRun, type RunStatus } from './agent-runs.ts';

export type ToolReply = { text: string; isError?: boolean };
/** The text of an MCP tool result as the assistant client returns it. */
export function replyOf(r: { content?: unknown[]; isError?: boolean } | null | undefined): ToolReply {
  const parts = (r?.content ?? []).map((c) => (c && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '')).filter(Boolean);
  return { text: parts.join('\n'), isError: r?.isError === true };
}
export type RunEvent = { type: 'start'; run: Omit<AgentRun, 'ms' | 'status' | 'note'> } | { type: 'finish'; id: string; status: Exclude<RunStatus, 'running'>; note: string };
export type NetDeps = {
  /** Calls a tool of the connector agent-network. */
  call: (tool: string, args: Record<string, unknown>) => Promise<ToolReply>;
  agents: () => StudioAgent[];
  catalog: () => Source[];
  published: (id: string) => boolean;
  stopped: (id: string) => boolean;
  version: (a: StudioAgent) => string;
  /** Runs a prompt for one agent in a session of its own, narrowed to `allowed` connector names; returns the answer text. */
  runSpecialist: (agent: StudioAgent, prompt: string, allowed: string[]) => Promise<string>;
  record: (e: RunEvent) => void;
  now?: () => number;
  /** How long a specialist may take before the question is answered with an error. */
  specialistTimeoutMs?: number;
  /** The person switched the network on. Off: runs are recorded but no agent gets a run id to ask with. */
  enabled?: () => boolean;
};
type TraceEntry = { agentId: string; hop: number; calls: number; root: string; runId: string };

/** Connector names an agent may use: its ticked connectors, plus the network connector when it may ask others. */
export function allowedConnectors(a: StudioAgent, networkName = 'agent-network'): string[] {
  const names = a.sources.filter((s) => s.startsWith('conn:')).map((s) => s.slice(5));
  if (contractOf(a).mayCall.length) names.push(networkName);
  return [...new Set(names)];
}

export function createBroker(deps: NetDeps) {
  const now = deps.now ?? Date.now;
  const traces = new Map<string, TraceEntry>();
  const budgets = new Map<string, { n: number }>();
  const messages: NetMessage[] = [];
  let lastSync = '';
  /** Questions being answered right now. An asked agent can itself ask another one, so rounds must overlap; a poll takes each question only once. */
  let inflight = 0;
  const MAX_INFLIGHT = 4;

  /** The agent list as the connector should know it: published, not stopped, accepting questions. */
  function snapshot() {
    return deps.agents().filter((a) => contractOf(a).callable && deps.published(a.id) && !deps.stopped(a.id)).map((a) => ({ id: a.id, name: a.name, capability: contractOf(a).capability, accepts: contractOf(a).accepts, returns: contractOf(a).returns }));
  }
  async function sync(): Promise<void> {
    const agents = snapshot(), key = JSON.stringify(agents);
    if (key === lastSync) return;
    const r = await deps.call('sync_agents', { agents });
    if (!r.isError) lastSync = key;
  }

  /** A run the app starts itself (chat, schedule, bench) gets a run id; the brief carries it, and only with that id the agent may ask. Returns the text for the brief ('' when the agent asks nobody). */
  function beginRun(agentId: string, trigger: AgentRun['trigger'], rand: () => number = Math.random): { trace: string; brief: string; end: (status: Exclude<RunStatus, 'running'>, note: string) => void } {
    const a = deps.agents().find((x) => x.id === agentId);
    const trace = newTrace(rand, now()), runId = newRunId(trace, 0);
    deps.record({ type: 'start', run: { id: runId, agentId, version: a ? deps.version(a) : '', at: now(), trigger, trace, hops: 0 } });
    const brief = a && deps.enabled?.() !== false ? networkBrief(a, trace, deps.agents(), deps.published) : '';
    if (brief) { const b = { n: 0 }; budgets.set(trace, b); traces.set(trace, { agentId, hop: 0, root: trace, runId, get calls() { return b.n; } } as TraceEntry); }
    return { trace, brief, end: (status, note) => { traces.delete(trace); budgets.delete(trace); deps.record({ type: 'finish', id: runId, status, note }); } };
  }

  const submit = (id: string, d: { outcome: string; reason: string }, answer: string, ms: number, message?: NetMessage) => deps.call('submit_response', { id, outcome: d.outcome, reason: d.reason, answer, ms, ...(message ? { message } : {}) });

  async function handle(raw: unknown): Promise<void> {
    const t0 = now(), shape = readEnvelope(raw, t0);
    if (!shape.ok) { const id = (raw as any)?.id; if (typeof id === 'string' && /^[A-Za-z0-9._-]{4,60}$/.test(id)) await submit(id, { outcome: 'refused', reason: shape.reason }, '', 0); return; }
    const env: Envelope = shape.envelope, agents = deps.agents();
    const d: Decision = decide(env, { agents, published: deps.published, stopped: deps.stopped, traces });
    const entry = traces.get(env.trace);
    const finish = async (dec: { outcome: string; reason: string }, answer: string) => {
      const m = logLine({ ...env, hop: (entry?.hop ?? 0) + 1 }, dec as { outcome: Decision['outcome'] | 'error'; reason: string }, now() - t0);
      messages.push(m); if (messages.length > 200) messages.shift();
      await submit(env.id, dec, answer, now() - t0, m);
    };
    if (d.outcome === 'refused' || d.outcome === 'needs_approval' || !entry) {
      if (entry && !deps.stopped(env.from)) { const b = budgets.get(entry.root); if (b) b.n += 1; }
      await finish(d, '');
      return;
    }
    const b = budgets.get(entry.root); if (b) b.n += 1;
    const to = agents.find((a) => a.id === env.to)!, from = agents.find((a) => a.id === env.from)!;
    // The asked agent runs as the next hop of the same chain; if it may ask others, it gets a run id of its own that shares the budget.
    const childTrace = `${entry.root}.${entry.hop + 1}`, childRun = newRunId(childTrace, entry.hop + 1);
    deps.record({ type: 'start', run: { id: childRun, agentId: to.id, version: deps.version(to), at: now(), trigger: 'network', trace: childTrace, parent: entry.runId, hops: entry.hop + 1 } });
    const brief = deps.enabled?.() === false ? '' : networkBrief(to, childTrace, agents, deps.published);
    if (brief) traces.set(childTrace, { agentId: to.id, hop: entry.hop + 1, root: entry.root, runId: childRun, get calls() { return budgets.get(entry.root)?.n ?? 0; } } as TraceEntry);
    try {
      const prompt = specialistPrompt(agentPrompt(to, deps.catalog(), brief), env, from, d.outcome);
      const limit = deps.specialistTimeoutMs ?? 120_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const answer = await Promise.race([deps.runSpecialist(to, prompt, allowedConnectors(to)), new Promise<string>((_, rej) => { timer = setTimeout(() => rej(new Error(`"${to.name}" took longer than ${Math.round(limit / 1000)} seconds.`)), limit); })]).finally(() => clearTimeout(timer));
      const text = d.outcome === 'redacted' ? redact(answer) : answer;
      deps.record({ type: 'finish', id: childRun, status: 'ok', note: `Answered ${from.name}.` });
      await finish(d, text);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 250);
      deps.record({ type: 'finish', id: childRun, status: 'error', note: reason });
      await finish({ outcome: 'error', reason: `"${to.name}" could not answer: ${reason}` }, '');
    } finally { traces.delete(childTrace); }
  }

  /** One round: tell the connector which agents accept questions, fetch the waiting questions, answer them. Never throws. */
  async function tick(): Promise<number> {
    if (inflight >= MAX_INFLIGHT) return 0;
    try {
      await sync();
      const r = await deps.call('poll_requests', { limit: 5 });
      if (r.isError) return 0;
      let list: unknown[] = [];
      try { list = (JSON.parse(r.text)?.requests ?? []) as unknown[]; } catch { return 0; }
      await Promise.all(list.map(async (x) => { inflight += 1; try { await handle(x); } catch { /* answered with an error inside handle */ } finally { inflight -= 1; } }));
      return list.length;
    } catch { return 0; }
  }

  return { beginRun, tick, handle, sync, messages: () => messages.slice(), activeTraces: () => new Map(traces) };
}
export type Broker = ReturnType<typeof createBroker>;
