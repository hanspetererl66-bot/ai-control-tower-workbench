#!/usr/bin/env node
import { N8N_TOOL_DEFINITIONS, createN8nHandlers } from '../../_lib/server/n8n.mjs';
import { INFRA_TOOL_DEFINITIONS, createInfraOpsHandlers } from '../../_lib/server/infra-ops.mjs';
import { ToolError, serve } from '../../_lib/server/runtime.mjs';

const n8n = createN8nHandlers();
const infra = createInfraOpsHandlers({ ToolError });

serve({
  name: 'n8n-automation',
  version: '1.0.0',
  instructions: "Read access to the n8n Cloud automation (workflows, executions, categories) and the demo workflows. Infrastructure changes are only planned unless a webhook is configured.",
  tools: [...N8N_TOOL_DEFINITIONS, ...INFRA_TOOL_DEFINITIONS],
  handlers: () => ({ ...n8n, ...infra }),
});
