import type { ToolCall } from './acp.ts';

const SEP = '__';

/** "ai-control-tower__get_contracts" → { ext: "ai-control-tower", tool: "get_contracts" } */
export function splitTool(call: Pick<ToolCall, 'toolName' | 'extensionName'>): { ext: string; tool: string } {
  const name = call.toolName ?? '';
  const at = name.indexOf(SEP);
  if (at > 0) return { ext: name.slice(0, at), tool: name.slice(at + SEP.length) };
  return { ext: call.extensionName ?? '', tool: name };
}
