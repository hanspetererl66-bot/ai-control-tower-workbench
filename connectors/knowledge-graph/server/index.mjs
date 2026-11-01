#!/usr/bin/env node
import { GRAPH_TOOL_DEFINITIONS, createGraphHandlers } from '../../_lib/server/graph.mjs';
import { serve } from '../../_lib/server/runtime.mjs';

serve({
  name: 'knowledge-graph',
  version: '1.0.0',
  instructions: "Knowledge graph over the sample data: find nodes, follow connections and analyse impact. Read only.",
  tools: GRAPH_TOOL_DEFINITIONS,
  handlers: () => createGraphHandlers(),
});
