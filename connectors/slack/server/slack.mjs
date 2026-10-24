/**
 * Slack tools for the Slack connector over the Web API (bot token of an own Slack app, optional user token for search).
 * No dependencies. fetch and the environment are injected so tests never touch a network.
 * Tokens are sent only to slack.com and never appear in results or errors.
 */
export class SlackError extends Error {}

const clip = (v, max = 1500) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v);
const CHANNEL = /^[CGD][A-Z0-9]{6,20}$/;
const TS = /^\d{9,11}\.\d{3,6}$/;

const ERRORS = {
  invalid_auth: 'Slack does not accept the token (invalid_auth).',
  not_authed: 'No Slack token is configured.',
  token_revoked: 'The Slack token was revoked.',
  channel_not_found: 'Slack does not know this channel, or the app cannot see it. Invite the app to the channel first (/invite @app).',
  not_in_channel: 'The app is not in this channel. Invite it first (/invite @app).',
  missing_scope: 'The Slack app lacks a permission (scope) for this call. Add it in the app settings and reinstall the app.',
  ratelimited: 'Slack asks to slow down (rate limit). Try again in a minute.',
  is_archived: 'The channel is archived.',
};

export function createSlackHandlers({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const botToken = () => {
    const token = String(env.SLACK_BOT_TOKEN ?? '').trim();
    if (!token) throw new SlackError('SLACK_BOT_TOKEN is missing (the Bot User OAuth Token xoxb-… of your Slack app).');
    return token;
  };

  async function api(method, params, token = botToken(), post = false) {
    let response;
    try {
      const url = new URL(`https://slack.com/api/${method}`);
      const init = { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) };
      if (post) {
        init.method = 'POST';
        init.headers['Content-Type'] = 'application/json; charset=utf-8';
        init.body = JSON.stringify(params);
      } else {
        for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
      }
      response = await fetchImpl(url.toString(), init);
    } catch (error) {
      throw new SlackError(`Could not reach Slack: ${String(error.message).replace(token, '***')}`);
    }
    if (response.status === 429) throw new SlackError(ERRORS.ratelimited);
    if (!response.ok) throw new SlackError(`Slack answered HTTP ${response.status}.`);
    const body = await response.json();
    if (!body.ok) throw new SlackError(ERRORS[body.error] ?? `Slack answered: ${String(body.error).slice(0, 80)}${body.needed ? ` (needs ${String(body.needed).slice(0, 80)})` : ''}`);
    return body;
  }

  const channelOf = (args) => {
    const id = String(args.channel ?? '').trim();
    if (!CHANNEL.test(id)) throw new SlackError('channel must be a channel id such as C0123456789. "slack_list_channels" shows the ids.');
    return id;
  };
  const limitOf = (args, def = 20) => Math.min(50, Math.max(1, Number.isInteger(args.limit) ? args.limit : def));
  const message = (m) => ({ ts: m.ts, user: m.user ?? m.bot_id ?? null, text: clip(m.text ?? ''), thread_ts: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : undefined, replies: m.reply_count || undefined });

  return {
    async slack_check_connection() {
      const r = await api('auth.test', {});
      return { ok: true, workspace: r.team, bot: r.user, user_token_for_search: env.SLACK_USER_TOKEN ? 'set' : 'not set' };
    },
    async slack_list_channels(args) {
      const r = await api('conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 200 });
      const q = String(args.query ?? '').trim().toLowerCase();
      const list = (r.channels ?? []).filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 100);
      return { channels: list.map((c) => ({ id: c.id, name: c.name, private: Boolean(c.is_private), member: Boolean(c.is_member), topic: clip(c.topic?.value ?? '', 120) })) };
    },
    async slack_read_channel(args) {
      const r = await api('conversations.history', { channel: channelOf(args), limit: limitOf(args) });
      return { messages: (r.messages ?? []).map(message) };
    },
    async slack_read_thread(args) {
      const ts = String(args.thread_ts ?? '').trim();
      if (!TS.test(ts)) throw new SlackError('thread_ts must look like 1700000000.000100.');
      const r = await api('conversations.replies', { channel: channelOf(args), ts, limit: limitOf(args, 30) });
      return { messages: (r.messages ?? []).map(message) };
    },
    async slack_search_messages(args) {
      const user = String(env.SLACK_USER_TOKEN ?? '').trim();
      if (!user) throw new SlackError('Search needs a user token. Add SLACK_USER_TOKEN (xoxp-…, scope search:read) in the connector settings.');
      const query = String(args.query ?? '').trim();
      if (!query || query.length > 300) throw new SlackError('query is required (at most 300 characters).');
      const r = await api('search.messages', { query, count: limitOf(args, 10) }, user);
      return { total: r.messages?.total ?? 0, matches: (r.messages?.matches ?? []).map((m) => ({ channel: m.channel?.name ?? null, channel_id: m.channel?.id ?? null, user: m.username ?? null, ts: m.ts, text: clip(m.text ?? '', 600), link: m.permalink })) };
    },
    async slack_post_message(args) {
      const channel = channelOf(args);
      const text = String(args.text ?? '').trim();
      if (!text) throw new SlackError('text is required.');
      if (text.length > 3500) throw new SlackError('text is too long (3500 characters).');
      const params = { channel, text };
      if (args.thread_ts !== undefined && args.thread_ts !== '') {
        if (!TS.test(String(args.thread_ts))) throw new SlackError('thread_ts must look like 1700000000.000100.');
        params.thread_ts = String(args.thread_ts);
      }
      const r = await api('chat.postMessage', params, botToken(), true);
      return { posted: true, channel: r.channel, ts: r.ts };
    },
  };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const TOOL_DEFINITIONS = [
  { name: 'slack_check_connection', description: 'Check the Slack connection and show the workspace and the bot name.', inputSchema: obj({}) },
  { name: 'slack_list_channels', description: 'List the channels the app can see (id, name, member). Optional name filter.', inputSchema: obj({ query: { type: 'string' } }) },
  { name: 'slack_read_channel', description: 'Read the latest messages of a channel the app is a member of.', inputSchema: obj({ channel: { type: 'string', description: 'Channel id such as C0123456789.' }, limit: { type: 'integer', description: '1 to 50 (default 20).' } }, ['channel']) },
  { name: 'slack_read_thread', description: 'Read the replies of one thread.', inputSchema: obj({ channel: { type: 'string' }, thread_ts: { type: 'string' }, limit: { type: 'integer' } }, ['channel', 'thread_ts']) },
  { name: 'slack_search_messages', description: 'Search messages across the workspace (needs the optional user token).', inputSchema: obj({ query: { type: 'string' }, limit: { type: 'integer' } }, ['query']) },
  { name: 'slack_post_message', description: 'Post a message to a channel, or as a reply when thread_ts is given (this posts to Slack for everyone in the channel). Ask the person before using it.', inputSchema: obj({ channel: { type: 'string' }, text: { type: 'string' }, thread_ts: { type: 'string', description: 'Optional: reply in this thread.' } }, ['channel', 'text']) },
];
