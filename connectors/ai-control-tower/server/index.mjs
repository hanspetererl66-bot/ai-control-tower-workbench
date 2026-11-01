#!/usr/bin/env node
import { TOOL_DEFINITIONS } from '../../_lib/server/tools.mjs';
import { WHAT_IF_TOOL_DEFINITIONS, createWhatIfHandlers } from '../../_lib/server/what-if.mjs';
import { ToolError, serve } from '../../_lib/server/runtime.mjs';

serve({
  name: 'ai-control-tower',
  version: '1.0.0',
  instructions: "Read-only access to the AI Control Tower: risk register, agent registry and AI budget. Results include a \"view\" field naming the Control Tower tab that shows the same information.",
  tools: [...TOOL_DEFINITIONS, ...WHAT_IF_TOOL_DEFINITIONS],
  dashboard: true,
  handlers: ({ loadTower }) => ({ ...createWhatIfHandlers({ loadTower, ToolError }) }),
});
