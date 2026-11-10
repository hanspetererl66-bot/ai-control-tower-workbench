export type Rules = {
  MAX_HOPS: number;
  MAX_CALLS_PER_TRACE: number;
  CLASSES: string[];
  DEFAULT_RELEASES: Record<string, string>;
  decide: (env: { trace: string; from: string; to: string; classes: string[] }, ctx: { agents: Array<{ id: string; name: string; contract?: unknown }>; published: (id: string) => boolean; stopped: (id: string) => boolean; traces: Map<string, { agentId: string; hop: number; calls: number }> }) => { outcome: 'answer' | 'redacted' | 'needs_approval' | 'refused'; reason: string };
  redact: (text: string) => string;
};
export function makeNetworkRules(): Rules;
