#!/usr/bin/env node
import { SAP_HELP_TOOL_DEFINITIONS, createSapHelpHandlers } from '../../_lib/server/sap-help.mjs';
import { WEB_SOURCE_TOOL_DEFINITIONS, createWebSourceHandlers } from '../../_lib/server/web-sources.mjs';
import { serve } from '../../_lib/server/runtime.mjs';

const sapHelp = createSapHelpHandlers();
const webSources = createWebSourceHandlers();

serve({
  name: 'web-sources',
  version: '1.0.0',
  instructions: "Search and read approved public sources (SAP Help, SAP Community, other approved sites). Read only; other websites are refused.",
  tools: [...SAP_HELP_TOOL_DEFINITIONS, ...WEB_SOURCE_TOOL_DEFINITIONS],
  handlers: () => ({ ...sapHelp, ...webSources }),
});
