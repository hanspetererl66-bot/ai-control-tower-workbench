/**
 * A Space can open a part of the app itself (not another Space): it posts { type: 'wb:open-view', view: 'develop' }.
 * Only the views listed here are accepted; the host checks the name and does nothing else with the message.
 */
export const OPENABLE_VIEWS = ['develop', 'studio'] as const;
export type OpenableView = (typeof OPENABLE_VIEWS)[number];

/** A Space can ask the host to open another Space: { type: 'wb:open-space', to: '<slug>' }. Only a folder name is accepted; nothing is delivered to that Space. */
const SPACE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
export function parseOpenSpaceMessage(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as { type?: unknown; to?: unknown };
  return message.type === 'wb:open-space' && typeof message.to === 'string' && SPACE_SLUG.test(message.to) ? message.to : null;
}

/** The view to open, or null when the message is not a valid open request. */
export function parseOpenViewMessage(data: unknown): OpenableView | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as { type?: unknown; view?: unknown };
  if (message.type !== 'wb:open-view' || typeof message.view !== 'string') return null;
  return (OPENABLE_VIEWS as readonly string[]).includes(message.view) ? (message.view as OpenableView) : null;
}
