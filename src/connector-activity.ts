/**
 * Which connectors the agent is using right now: those with a tool call that has been announced and not finished yet.
 * Names are compared in a normalised form (lower case, letters and digits only), because the runtime name of a connector
 * and its configuration key can be written differently ("ai-control-tower", "AI Control Tower").
 */
export type RunningTool = { extensionName?: string; toolName?: string; status?: string };

export const normalizeConnector = (name: string): string => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The connector of a tool call: the extension name, or the part of the tool name before "__". Empty for a built-in tool. */
export function connectorOfTool(tool: RunningTool): string {
  if (tool.extensionName) return normalizeConnector(tool.extensionName);
  const full = tool.toolName ?? '';
  const at = full.indexOf('__');
  return at > 0 ? normalizeConnector(full.slice(0, at)) : '';
}

/** The normalised names of the connectors with a tool call that is still running (status "pending"), each once. */
export function liveConnectors(tools: readonly RunningTool[]): string[] {
  const out = new Set<string>();
  for (const tool of tools) {
    if (tool.status !== 'pending') continue;
    const name = connectorOfTool(tool);
    if (name) out.add(name);
  }
  return [...out];
}

export const isLiveConnector = (live: readonly string[], name: string): boolean => live.includes(normalizeConnector(name));
