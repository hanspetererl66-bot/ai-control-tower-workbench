#!/usr/bin/env node
import { PREFERENCE_TOOL_DEFINITIONS, createPreferenceHandlers } from '../../_lib/server/preferences.mjs';
import { GROUP_TOOL_DEFINITIONS, createGroupHandlers } from '../../_lib/server/groups.mjs';
import { serve } from '../../_lib/server/runtime.mjs';

serve({
  name: 'werkbank-workspace',
  version: '1.0.0',
  instructions: "Personal settings sync (never secrets) and shared groups with roles, Spaces, configuration and team memory. Writes are limited to those tables.",
  tools: [...PREFERENCE_TOOL_DEFINITIONS, ...GROUP_TOOL_DEFINITIONS],
  handlers: ({ rpc }) => ({ ...createPreferenceHandlers(rpc), ...createGroupHandlers(rpc) }),
});
