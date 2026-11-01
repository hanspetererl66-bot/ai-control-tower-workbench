#!/usr/bin/env node
import { TOOL_DEFINITIONS } from '../../_lib/server/tools.mjs';
import { WHAT_IF_TOOL_DEFINITIONS, createWhatIfHandlers } from '../../_lib/server/what-if.mjs';
import { FINANCE_FORECAST_TOOL_DEFINITIONS, createFinanceForecastHandlers } from '../../_lib/server/finance-forecast.mjs';
import { ToolError, serve } from '../../_lib/server/runtime.mjs';

serve({
  name: 'ai-control-tower',
  version: '1.1.0',
  instructions: "Read-only access to the AI Control Tower: risk register, agent registry and AI budget, plus two TabPFN forecasts for Controlling (forecast_budget, estimate_accruals; read only, they need the forecast service and say so when it is missing). Results include a \"view\" field naming the Control Tower tab that shows the same information.",
  tools: [...TOOL_DEFINITIONS, ...WHAT_IF_TOOL_DEFINITIONS, ...FINANCE_FORECAST_TOOL_DEFINITIONS],
  dashboard: true,
  handlers: ({ loadTower }) => ({ ...createWhatIfHandlers({ loadTower, ToolError }), ...createFinanceForecastHandlers({ loadTower, ToolError }) }),
});
