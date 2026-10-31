#!/usr/bin/env node
import { PREFERENCE_TOOL_DEFINITIONS, createPreferenceHandlers } from '../../_lib/server/preferences.mjs';
import { GROUP_TOOL_DEFINITIONS, createGroupHandlers } from '../../_lib/server/groups.mjs';
import { WORK_ITEM_TOOL_DEFINITIONS, createWorkItemHandlers } from '../../_lib/server/work-items.mjs';
import { serve } from '../../_lib/server/runtime.mjs';

serve({
  name: 'werkbank-workspace',
  version: '1.1.0',
  instructions: "Personal settings sync (never secrets) and shared groups with roles, Spaces, configuration and team memory. Agents, workflows and code of any kind are saved as revisions in the shared database (save_work_item, get_work_item, list_work_items, work_item_history, archive_work_item). Writes ask the person first and name the actor by e-mail.",
  tools: [...PREFERENCE_TOOL_DEFINITIONS, ...GROUP_TOOL_DEFINITIONS, ...WORK_ITEM_TOOL_DEFINITIONS],
  handlers: ({ rpc }) => ({ ...createPreferenceHandlers(rpc), ...createGroupHandlers(rpc), ...createWorkItemHandlers(rpc) }),
});
