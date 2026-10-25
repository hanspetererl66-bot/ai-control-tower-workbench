import { connectorDisplayName } from './connector-presentation.ts';

export type ActionInfo = {
  connector: string;
  tool: string;
  /** reads: only looks things up; changes: creates, sends, deletes or runs something; unknown: could not tell. */
  risk: 'reads' | 'changes' | 'unknown';
  params: Array<[string, string]>;
};

const CHANGES = /(^|_)(create|add|insert|send|delete|remove|update|set|save|write|post|publish|run|execute|trigger|start|stop|approve|reject|submit|sign|move|rename|install|apply|patch|upload|shell|bash|edit)(_|$)/i;
const READS = /(^|_)(get|list|search|read|show|find|fetch|describe|explain|check|simulate|view|query|enrich|load|summari[sz]e|recall)(_|$)/i;

const clip = (v: unknown, max = 160): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** What an action is about to do, in words a person can check before allowing it. */
export function describeAction(call: { title?: string; toolName?: string; rawInput?: Record<string, unknown> }): ActionInfo {
  const full = call.toolName ?? '';
  const at = full.indexOf('__');
  const ext = at > 0 ? full.slice(0, at) : '';
  const tool = at > 0 ? full.slice(at + 2) : full || (call.title ?? 'action');
  const risk: ActionInfo['risk'] = CHANGES.test(tool) ? 'changes' : READS.test(tool) ? 'reads' : 'unknown';
  const params = Object.entries(call.rawInput ?? {})
    .filter(([k]) => !/token|secret|password|key/i.test(k))
    .slice(0, 6)
    .map(([k, v]): [string, string] => [k, clip(v)]);
  return { connector: ext ? connectorDisplayName(ext) : 'Built-in tool', tool, risk, params };
}

export const RISK_LABEL: Record<ActionInfo['risk'], string> = { reads: 'Only reads', changes: 'Changes something', unknown: 'Check before allowing' };
