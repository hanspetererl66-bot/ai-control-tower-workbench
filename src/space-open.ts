/**
 * A Space can open a part of the app itself (not another Space): it posts { type: 'wb:open-view', view: 'develop' }.
 * Only the views listed here are accepted; the host checks the name and does nothing else with the message.
 */
export const OPENABLE_VIEWS = ['develop', 'studio'] as const;
export type OpenableView = (typeof OPENABLE_VIEWS)[number];

/** The view to open, or null when the message is not a valid open request. */
export function parseOpenViewMessage(data: unknown): OpenableView | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as { type?: unknown; view?: unknown };
  if (message.type !== 'wb:open-view' || typeof message.view !== 'string') return null;
  return (OPENABLE_VIEWS as readonly string[]).includes(message.view) ? (message.view as OpenableView) : null;
}
