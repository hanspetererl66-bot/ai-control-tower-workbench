import { connectorDisplayName } from './connector-presentation.ts';

export type ActionInfo = {
  connector: string;
  tool: string;
  /** reads: only looks things up; changes: creates, sends, deletes or runs something; unknown: could not tell. */
  risk: 'reads' | 'changes' | 'unknown';
  params: Array<[string, string]>;
};

const CHANGES = /(^|_)(create|add|insert|send|delete|remove|update|set|save|write|post|publish|run|execute|trigger|start|stop|approve|reject|submit|sign|move|rename|install|apply|patch|upload|shell|bash|edit)(_|$)/i;
const READS = /(^|_)(get|list|search|read|show|find|fetch|describe|explain|check|simulate|predict|forecast|estimate|view|query|enrich|load|summari[sz]e|recall)(_|$)/i;

/**
 * ARC-1 (ABAP over ADT) names its tools SAPRead, SAPWrite and so on, in camel case without underscores, so the word rules
 * above cannot tell them apart (every call would read "Check before allowing", and a write would not be marked as a change).
 * The classes follow the scopes in ARC-1's own authorization guide: read = SAPRead, SAPSearch, SAPNavigate, SAPContext,
 * SAPLint, SAPDiagnose; write = SAPWrite, SAPActivate, SAPManage, SAPTransport; data = table contents; sql = SAPQuery;
 * Git is a separate server flag. Whatever is not clearly a read is never shown as one.
 * Not run against a real ARC-1 here: the argument names `action` and `type` come from its configuration reference.
 */
const ARC1_READS = new Set(['SAPRead', 'SAPSearch', 'SAPNavigate', 'SAPContext', 'SAPLint', 'SAPDiagnose']);
const ARC1_CHANGES = new Set(['SAPWrite', 'SAPActivate', 'SAPTransport', 'SAPGit']);
/** Business data (free SQL) or a tool whose actions we cannot tell apart (SAPManage includes package operations). */
const ARC1_CHECK = new Set(['SAPQuery', 'SAPManage']);
/** Transport actions that only look: the others (create, release, delete, reassign) change the system. */
const ARC1_TRANSPORT_READS = new Set(['list', 'get', 'check', 'history']);

function arc1Risk(tool: string, input: Record<string, unknown> | undefined): ActionInfo['risk'] | null {
  if (ARC1_READS.has(tool)) {
    // Table contents are business data: any argument value naming them needs a look, whatever the argument is called.
    const data = Object.values(input ?? {}).some((v) => typeof v === 'string' && v.trim().toUpperCase() === 'TABLE_CONTENTS');
    return data ? 'unknown' : 'reads';
  }
  if (tool === 'SAPTransport') {
    const action = input?.action;
    return typeof action === 'string' && ARC1_TRANSPORT_READS.has(action.trim().toLowerCase()) ? 'reads' : 'changes';
  }
  if (ARC1_CHANGES.has(tool)) return 'changes';
  if (ARC1_CHECK.has(tool)) return 'unknown';
  return null;
}

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
  const risk: ActionInfo['risk'] = arc1Risk(tool, call.rawInput) ?? (CHANGES.test(tool) ? 'changes' : READS.test(tool) ? 'reads' : 'unknown');
  const params = Object.entries(call.rawInput ?? {})
    .filter(([k]) => !/token|secret|password|key/i.test(k))
    .slice(0, 6)
    .map(([k, v]): [string, string] => [k, clip(v)]);
  return { connector: ext ? connectorDisplayName(ext) : 'Built-in tool', tool, risk, params };
}

export const RISK_LABEL: Record<ActionInfo['risk'], string> = { reads: 'Only reads', changes: 'Changes something', unknown: 'Check before allowing' };
