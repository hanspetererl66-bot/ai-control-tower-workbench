/**
 * Names of the connectors the chat knows by name, and the shape of a starter prompt. The empty chat shows no
 * built-in suggestions; only the person's own prompts and favourite skills appear there.
 */

/** The connector's name as defined in connectors/ai-control-tower/manifest.json. */
export const CONTROL_TOWER_CONNECTOR = 'ai-control-tower';

/** Personal settings sync and groups (connectors/werkbank-workspace). */
export const WORKSPACE_CONNECTOR = 'werkbank-workspace';

export type StarterPrompt = {
  /** Short label on the chip. */
  label: string;
  /** What is sent to the agent, and shown as the user's message. */
  prompt: string;
};

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when the Control Tower connector is among the configured connectors. */
export function hasControlTowerConnector(names: Iterable<string>): boolean {
  const wanted = normalized(CONTROL_TOWER_CONNECTOR);
  for (const name of names) if (normalized(name) === wanted) return true;
  return false;
}
