/**
 * Which Control Tower tab shows the same information as a connector tool.
 * The mapping is static on purpose: it does not depend on parsing tool output,
 * and test/control-tower-views.test.mjs keeps it in step with the `view` field
 * the connector itself returns.
 */

export const CONTROL_TOWER_SPACE = 'ai-control-tower';

/** Tab ids are the `go('<id>')` ids in examples/control-tower/index.html. */
export const TOOL_TABS: Record<string, string> = {
  get_risks: 'risk',
  get_risk: 'risk',
  get_agent_overview: 'repo',
  get_unregistered_assets: 'repo',
  get_overprivileged_agents: 'repo',
  get_budget: 'gov',
};

export const TAB_LABELS: Record<string, string> = {
  risk: 'Risk & Compliance',
  repo: 'Agent Repository',
  gov: 'Model Governance',
};

export type ControlTowerView = { space: string; tab: string; label: string };

type ToolLike = { toolName?: string; extensionName?: string; status?: string };

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The view for a completed Control Tower tool call, or null for any other tool.
 * goose names tools "<extension>__<tool>" and may also report the extension
 * separately; if the extension is known it must be ours.
 */
export function controlTowerViewFor(tool: ToolLike): ControlTowerView | null {
  if (tool.status !== 'completed' || !tool.toolName) return null;
  const parts = tool.toolName.split('__');
  const name = parts[parts.length - 1];
  const extension = tool.extensionName ?? (parts.length > 1 ? parts.slice(0, -1).join('__') : undefined);
  if (extension !== undefined && normalized(extension) !== normalized(CONTROL_TOWER_SPACE)) return null;
  const tab = Object.hasOwn(TOOL_TABS, name) ? TOOL_TABS[name] : undefined;
  return tab ? { space: CONTROL_TOWER_SPACE, tab, label: TAB_LABELS[tab] ?? tab } : null;
}

/** Distinct views for a message's tools, in the order they were first used. */
export function controlTowerViews(tools: ToolLike[]): ControlTowerView[] {
  const seen = new Set<string>();
  const views: ControlTowerView[] = [];
  for (const tool of tools) {
    const view = controlTowerViewFor(tool);
    if (view && !seen.has(view.tab)) {
      seen.add(view.tab);
      views.push(view);
    }
  }
  return views;
}
