/**
 * "Connect your tools": one card each for Jira, Slack, Linear and Figma on the Connectors page.
 * Pure logic only (what a card says, which state it is in, how a connection test is read);
 * the card itself is src/ui/ConnectTools.tsx.
 */

export type ToolId = 'jira' | 'slack' | 'linear' | 'figma';

export type ToolCard = {
  id: ToolId;
  name: string;
  /** What the connector reads without asking. */
  reads: string;
  /** What it changes, and only after the person has confirmed. */
  writes: string;
  /** Where the key comes from. */
  key: string;
  /** Command that adds the connector when it is not in the local configuration yet. */
  addCommand: string;
};

export const TOOL_CARDS: ToolCard[] = [
  {
    id: 'jira', name: 'Jira',
    reads: 'Reads issues and backlogs (JQL search) to start from requirements.',
    writes: 'Comments, labels, status changes and new issues only after you confirmed a preview.',
    key: 'Needs your site, e-mail and an API token from id.atlassian.com (Security, API tokens).',
    addCommand: 'npm run connect:connectors -- --only jira',
  },
  {
    id: 'slack', name: 'Slack',
    reads: 'Reads channels and threads the app is a member of, and searches them.',
    writes: 'Posts a message only after you confirmed it; everybody in the channel sees it.',
    key: 'Needs a bot token (xoxb-…) from your Slack app; search also needs a user token.',
    addCommand: 'npm run connect:connectors -- --only slack',
  },
  {
    id: 'linear', name: 'Linear',
    reads: 'Reads teams, projects and issues to start from requirements.',
    writes: 'Adds a comment to an issue only after you confirmed it. Nothing else can change.',
    key: 'Needs a personal API key from Linear (Settings, Account, Security & access) with Read and Create comments.',
    addCommand: 'npm run connect:connectors -- --only linear',
  },
  {
    id: 'figma', name: 'Figma',
    reads: 'Reads open comments and the text in frames of a design file to start from requirements.',
    writes: 'Nothing: the connector is read only. Even after you confirmed, it cannot change a Figma file.',
    key: 'Needs a personal access token from Figma (Settings, Security, Personal access tokens) with read scopes only.',
    addCommand: 'npm run connect:connectors -- --only figma',
  },
];

export type CardState = 'connected' | 'off' | 'not-added';

/** The state a card shows, from the connectors goose reports. */
export function cardState(id: ToolId, extensions: { configKey: string; enabled: boolean }[]): { state: CardState; configKey: string | null } {
  const ext = findExtension(id, extensions);
  if (!ext) return { state: 'not-added', configKey: null };
  return { state: ext.enabled ? 'connected' : 'off', configKey: ext.configKey };
}

/** The installed connector for a tool: the exact id first, then a name that contains it (for example "jira-cloud"). */
export function findExtension<T extends { configKey: string }>(id: ToolId, extensions: T[]): T | undefined {
  return extensions.find((e) => e.configKey.toLowerCase() === id) ?? extensions.find((e) => e.configKey.toLowerCase().includes(id));
}

/** The name of the connection-test tool as goose knows it: "<connector>__<tool>_check_connection". */
export const checkToolName = (id: ToolId, configKey: string) => `${configKey}__${id}_check_connection`;

export type CheckOutcome = { ok: boolean; text: string };

/**
 * Reads the answer of `<tool>_check_connection`. The text is shown to the person, so it is
 * cut short, and anything that looks like a key is replaced.
 */
export function readCheck(result: unknown): CheckOutcome {
  const r = (result && typeof result === 'object' ? result : {}) as { isError?: boolean; content?: unknown };
  const first = Array.isArray(r.content) ? r.content[0] : undefined;
  const raw = first && typeof first === 'object' && typeof (first as { text?: unknown }).text === 'string' ? (first as { text: string }).text : '';
  if (r.isError) return { ok: false, text: scrub(raw || 'The connector reported an error.') };
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); } catch { return { ok: false, text: 'The connector returned an answer that could not be read.' }; }
  if (data.ok === false) return { ok: false, text: scrub(String(data.error ?? 'The connection failed.')) };
  const who = [data.user, data.name, data.bot, data.bot_user].find((v) => typeof v === 'string' && v) as string | undefined;
  const where = [data.site, data.workspace, data.team, data.url].find((v) => typeof v === 'string' && v) as string | undefined;
  const parts = [who ? `as ${who}` : '', where ? `in ${where}` : ''].filter(Boolean).join(' ');
  return { ok: true, text: scrub(`Connected${parts ? ` ${parts}` : ''}.`) };
}

/** Never show something that looks like a token, whatever the connector put in the text. */
export function scrub(text: string): string {
  return text
    .replace(/\b(xox[abprs]-|lin_api_|lin_oauth_|ATATT|figd_)[A-Za-z0-9_\-=]+/g, '<hidden>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
