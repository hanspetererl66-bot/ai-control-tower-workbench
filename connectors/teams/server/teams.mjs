/**
 * Microsoft Teams tools for the Teams connector over Microsoft Graph, read only.
 * No dependencies. fetch and the environment are injected so tests never touch a network.
 * Two ways to sign in: an app registration (tenant id, client id, client secret; application permissions, admin consent needed)
 * or a ready access token (delegated, short lived, good for a first try). The secret goes only to login.microsoftonline.com,
 * the token only to graph.microsoft.com, and neither appears in results or errors.
 */
export class TeamsError extends Error {}

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';
const clip = (v, max = 400) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL = /^19:[A-Za-z0-9._@-]{3,200}$/;
const MESSAGE = /^\d{10,20}$/;

/** Teams puts HTML in messages. This keeps the words, line breaks and the names of mentions. */
export function textOf(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<attachment[^>]*>\s*<\/attachment>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Ids from a Teams message link (Copy link to message): team (groupId), channel and message. null = not such a link. */
export function linkOf(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { return null; }
  if (!/(^|\.)teams\.(microsoft|live)\.com$/i.test(url.hostname)) return null;
  const m = /^\/l\/message\/([^/]+)\/(\d+)/.exec(url.pathname);
  if (!m) return null;
  const channel = decodeURIComponent(m[1]);
  const team = url.searchParams.get('groupId') ?? '';
  if (!CHANNEL.test(channel) || !GUID.test(team)) return null;
  return { team_id: team, channel_id: channel, message_id: m[2] };
}

const teamId = (v) => { const s = String(v ?? '').trim(); if (!GUID.test(s)) throw new TeamsError('team_id must be the id of a team (from teams_list_teams).'); return s; };
const channelId = (v) => { const s = String(v ?? '').trim(); if (!CHANNEL.test(s)) throw new TeamsError('channel_id must be the id of a channel (from teams_list_channels), it starts with "19:".'); return s; };
const messageId = (v) => { const s = String(v ?? '').trim(); if (!MESSAGE.test(s)) throw new TeamsError('message_id must be the numeric id of a message.'); return s; };

export function messageRow(m) {
  return {
    id: m.id,
    from: m.from?.user?.displayName ?? m.from?.application?.displayName ?? null,
    created: m.createdDateTime ?? null,
    subject: clip(m.subject ?? '', 160) || null,
    text: clip(textOf(m.body?.contentType === 'html' ? m.body.content : String(m.body?.content ?? '').replace(/</g, '&lt;')), 1500),
    url: m.webUrl ?? null,
  };
}

export function createTeamsHandlers({ env: rawEnv = process.env, fetchImpl = globalThis.fetch } = {}) {
  let cached = null;
  // An optional field that was left empty can arrive as the unreplaced placeholder; both count as empty.
  const env = Object.fromEntries(Object.entries(rawEnv).map(([k, v]) => [k, String(v ?? '').trim().startsWith('${') ? '' : v]));
  const secrets = () => [env.TEAMS_CLIENT_SECRET, env.TEAMS_ACCESS_TOKEN, cached?.token].map((s) => String(s ?? '').trim()).filter((s) => s.length > 6);
  const hide = (text) => secrets().reduce((t, s) => t.split(s).join('***'), String(text));

  async function accessToken() {
    const direct = String(env.TEAMS_ACCESS_TOKEN ?? '').trim();
    if (direct) return { token: direct, delegated: true };
    if (cached && cached.until > Date.now() + 60_000) return cached;
    const tenant = String(env.TEAMS_TENANT_ID ?? '').trim(), client = String(env.TEAMS_CLIENT_ID ?? '').trim(), secret = String(env.TEAMS_CLIENT_SECRET ?? '').trim();
    if (!tenant || !client || !secret) throw new TeamsError('Sign-in is missing: give an access token (TEAMS_ACCESS_TOKEN), or tenant id, client id and client secret of an app registration (TEAMS_TENANT_ID, TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET).');
    if (!GUID.test(tenant) && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(tenant)) throw new TeamsError('TEAMS_TENANT_ID must be the directory (tenant) id or the domain of your tenant.');
    let res;
    try {
      res = await fetchImpl(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client, client_secret: secret, scope: 'https://graph.microsoft.com/.default' }).toString(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) { throw new TeamsError(`Could not reach Microsoft sign-in: ${hide(error.message)}`); }
    if (!res.ok) {
      let detail = '';
      try { detail = String((await res.json()).error_description ?? '').split('\n')[0]; } catch { /* no body */ }
      throw new TeamsError(`Microsoft did not give a token (HTTP ${res.status})${detail ? `: ${hide(detail).slice(0, 200)}` : ''}. Check tenant id, client id and secret.`);
    }
    const body = await res.json();
    if (!body?.access_token) throw new TeamsError('Microsoft answered without a token.');
    cached = { token: body.access_token, delegated: false, until: Date.now() + Math.max(60, Number(body.expires_in) || 3000) * 1000 };
    return cached;
  }

  async function graph(path) {
    const { token, delegated } = await accessToken();
    let res;
    try {
      res = await fetchImpl(`${GRAPH}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    } catch (error) { throw new TeamsError(`Could not reach Microsoft Graph: ${hide(error.message)}`); }
    if (res.status === 401) throw new TeamsError(delegated ? 'Microsoft does not accept the access token (HTTP 401). It may have expired (they last about an hour).' : 'Microsoft does not accept the token (HTTP 401). Check the app registration.');
    if (res.status === 403) throw new TeamsError('The app may not read that (HTTP 403). Reading channel messages needs ChannelMessage.Read.All (and Team.ReadBasic.All, Channel.ReadBasic.All) with admin consent, or the same as delegated rights.');
    if (res.status === 404) throw new TeamsError('Teams did not find that (HTTP 404). Check the team and channel ids.');
    if (res.status === 429) throw new TeamsError('Microsoft asks to slow down (rate limit). Try again in a minute.');
    if (!res.ok) {
      let detail = '';
      try { detail = String((await res.json()).error?.message ?? ''); } catch { /* no body */ }
      throw new TeamsError(`Microsoft Graph answered HTTP ${res.status}${detail ? `: ${hide(detail).slice(0, 250)}` : ''}`);
    }
    return res.json();
  }

  const limitOf = (args, def = 25, max = 50) => Math.min(max, Math.max(1, Number.isInteger(args.limit) ? args.limit : def));
  const real = (m) => m && m.messageType === 'message' && !m.deletedDateTime;

  return {
    async teams_check_connection() {
      const { delegated } = await accessToken();
      if (delegated) { const me = await graph('/me?$select=displayName'); return { ok: true, signed_in_as: me.displayName ?? 'user', mode: 'access token' }; }
      const org = await graph('/teams?$top=1').catch(() => null);
      return { ok: true, mode: 'app registration', teams_visible: org ? undefined : 'unknown (listing teams needs Group.Read.All or Team.ReadBasic.All)' };
    },
    async teams_list_teams(args = {}) {
      const { delegated } = await accessToken();
      const path = delegated
        ? '/me/joinedTeams?$select=id,displayName,description'
        : `/groups?$filter=${encodeURIComponent("resourceProvisioningOptions/Any(x:x eq 'Team')")}&$select=id,displayName,description&$top=${limitOf(args, 25, 50)}`;
      const res = await graph(path);
      const teams = (res.value ?? []).slice(0, limitOf(args, 25, 50)).map((t) => ({ id: t.id, name: clip(t.displayName ?? '', 120), description: clip(t.description ?? '', 160) || null }));
      return { count: teams.length, teams };
    },
    async teams_list_channels(args) {
      const id = teamId(args.team_id);
      const res = await graph(`/teams/${id}/channels?$select=id,displayName,description,membershipType`);
      const channels = (res.value ?? []).map((c) => ({ id: c.id, name: clip(c.displayName ?? '', 120), description: clip(c.description ?? '', 160) || null, type: c.membershipType ?? 'standard' }));
      return { count: channels.length, channels };
    },
    async teams_read_channel(args) {
      let { team_id: t, channel_id: c } = args;
      if (args.link) { const l = linkOf(args.link); if (!l) throw new TeamsError('That is not a Teams message link. Use "Copy link to message" in Teams, or give team_id and channel_id.'); t = l.team_id; c = l.channel_id; }
      const team = teamId(t), channel = channelId(c);
      const words = String(args.contains ?? '').trim().toLowerCase();
      if (words.length > 200) throw new TeamsError('contains is too long.');
      const res = await graph(`/teams/${team}/channels/${encodeURIComponent(channel)}/messages?$top=${limitOf(args)}`);
      let rows = (res.value ?? []).filter(real).map(messageRow);
      if (words) rows = rows.filter((r) => `${r.subject ?? ''} ${r.text}`.toLowerCase().includes(words));
      return { count: rows.length, messages: rows, more: Boolean(res['@odata.nextLink']), note: 'Newest first. Replies are read with teams_read_thread.' };
    },
    async teams_read_thread(args) {
      let { team_id: t, channel_id: c, message_id: m } = args;
      if (args.link) { const l = linkOf(args.link); if (!l) throw new TeamsError('That is not a Teams message link.'); t = l.team_id; c = l.channel_id; m = l.message_id; }
      const team = teamId(t), channel = channelId(c), message = messageId(m);
      const base = `/teams/${team}/channels/${encodeURIComponent(channel)}/messages/${message}`;
      const [root, replies] = await Promise.all([graph(base), graph(`${base}/replies?$top=${limitOf(args, 50)}`)]);
      const rows = (replies.value ?? []).filter(real).map(messageRow);
      return { message: real(root) ? messageRow(root) : null, replies: rows, count: rows.length, more: Boolean(replies['@odata.nextLink']) };
    },
  };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const TOOL_DEFINITIONS = [
  { name: 'teams_check_connection', description: 'Check the Microsoft Teams sign-in (access token or app registration).', inputSchema: obj({}) },
  { name: 'teams_list_teams', description: 'List the teams the app (or the signed-in user) can see: id, name, description. Read only.', inputSchema: obj({ limit: { type: 'integer', description: '1 to 50 (default 25).' } }) },
  { name: 'teams_list_channels', description: 'List the channels of a team: id (starts with "19:"), name, description. Read only.', inputSchema: obj({ team_id: { type: 'string', description: 'Team id from teams_list_teams.' } }, ['team_id']) },
  { name: 'teams_read_channel', description: 'Read the newest messages of a channel (author, time, subject, text, link). Give team_id and channel_id, or a "Copy link to message" link. contains keeps only messages with those words. Read only.', inputSchema: obj({ team_id: { type: 'string' }, channel_id: { type: 'string' }, link: { type: 'string', description: 'A Teams message link instead of team_id and channel_id.' }, contains: { type: 'string', description: 'Only messages containing these words.' }, limit: { type: 'integer', description: '1 to 50 (default 25).' } }) },
  { name: 'teams_read_thread', description: 'Read one channel message with its replies. Give team_id, channel_id and message_id, or a "Copy link to message" link. Read only.', inputSchema: obj({ team_id: { type: 'string' }, channel_id: { type: 'string' }, message_id: { type: 'string' }, link: { type: 'string' }, limit: { type: 'integer', description: '1 to 50 (default 50).' } }) },
];
