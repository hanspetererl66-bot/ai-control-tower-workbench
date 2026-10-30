#!/usr/bin/env node
import { TICKET_TOOL_DEFINITIONS, createTicketHandlers } from '../../_lib/server/tickets.mjs';
import { SUB4ME_TOOL_DEFINITIONS, createSub4MeHandlers } from '../../_lib/server/sub4me.mjs';
import { CROSS_SPACE_TOOL_DEFINITIONS, createCrossSpaceHandlers } from '../../_lib/server/cross-space.mjs';
import { serve } from '../../_lib/server/runtime.mjs';

serve({
  name: 'sub4me',
  version: '1.0.0',
  instructions: "Sub4Me test customer (sample data): customers, contracts, offers, consumption and demo service tickets. Creating a ticket is the only write and goes to a demo table.",
  tools: [...TICKET_TOOL_DEFINITIONS, ...SUB4ME_TOOL_DEFINITIONS, ...CROSS_SPACE_TOOL_DEFINITIONS],
  handlers: ({ rpc, loadTower }) => {
    const sub4me = createSub4MeHandlers(undefined, rpc);
    return { ...createTicketHandlers(rpc), ...sub4me, ...createCrossSpaceHandlers({ sub4me, loadTower, rpc }) };
  },
});
