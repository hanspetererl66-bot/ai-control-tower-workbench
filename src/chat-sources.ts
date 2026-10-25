import { connectorDisplayName } from './connector-presentation.ts';
import { isWebTool } from './web-search.ts';
import type { ToolCall } from './acp.ts';
import { splitTool } from './chat-sources-split.ts';

export type Source = {
  kind: 'connector' | 'web' | 'file';
  label: string;
  /** Tools used (connector) or what the page is (web). */
  detail?: string;
  url?: string;
};

const cleanUrl = (u: string) => u.replace(/[.,;:!?)\]]+$/, '');

/** Where an answer came from: the connectors it called, web pages it links to and files it touched. Most useful first. */
export function collectSources(tools: ToolCall[], text: string): Source[] {
  const out: Source[] = [];
  const byExt = new Map<string, string[]>();
  let webCalls = 0;
  for (const call of tools) {
    if (call.status === 'failed') continue;
    if (isWebTool(call)) { webCalls += 1; continue; }
    const { ext, tool } = splitTool(call);
    if (!ext || ext === 'developer' || ext === 'todo' || ext === 'chatrecall') continue;
    const list = byExt.get(ext) ?? [];
    if (tool && !list.includes(tool)) list.push(tool);
    byExt.set(ext, list);
  }
  for (const [ext, list] of byExt) out.push({ kind: 'connector', label: connectorDisplayName(ext), detail: list.slice(0, 6).join(', ') });
  const seen = new Set<string>();
  for (const raw of text.match(/https?:\/\/[^\s)\]>"']+/g) ?? []) {
    const url = cleanUrl(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep the raw text */ }
    out.push({ kind: 'web', label: host, url });
  }
  if (webCalls > 0 && ![...seen].length) out.push({ kind: 'web', label: 'Web search', detail: `${webCalls} lookup${webCalls === 1 ? '' : 's'}` });
  const files = new Set<string>();
  for (const call of tools) for (const loc of call.locations ?? []) if (loc.path && !files.has(loc.path) && files.size < 5) { files.add(loc.path); out.push({ kind: 'file', label: loc.path.split('/').pop() ?? loc.path, detail: loc.path }); }
  return out;
}

export function sourceSummary(sources: Source[]): string {
  const n = (k: Source['kind']) => sources.filter((s) => s.kind === k).length;
  const parts = [
    n('connector') ? `${n('connector')} connector${n('connector') === 1 ? '' : 's'}` : '',
    n('web') ? `${n('web')} web source${n('web') === 1 ? '' : 's'}` : '',
    n('file') ? `${n('file')} file${n('file') === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
