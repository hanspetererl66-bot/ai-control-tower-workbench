/**
 * Bridge between the sandboxed PRD Builder Space and the connectors of its sources: Jira, Linear, Slack and Notion.
 * The Space has no network, so it asks the app by postMessage. Only these read-only tools can be reached through here:
 * jira_list_projects, jira_read_backlog, linear_list_teams, linear_read_backlog, slack_list_channels, slack_read_channel,
 * notion_search and notion_read_page. Nothing in the sources is changed (no posting, no comments, no write-back).
 */
import { parseToolResult, type BridgeCall } from './sub4me-bridge.ts';
import { fromLinear, fromNotion, fromSlack, notionChoices, notionId, SLACK_CHANNEL_ID, SLACK_CHANNEL_NAME, TEAM_KEY } from './prd-sources.ts';

export const PRD_SPACE = 'prd-builder';
export const JIRA_EXTENSION = 'jira';
/** The extension (connector) that answers a tool: by the prefix of its name; `names` are the installed extensions, the first that matches wins. */
export function prdExtensionFor(tool: string, names: string[]): string {
  const source = /^(jira|linear|slack|notion)_/.exec(tool)?.[1] ?? 'jira';
  return names.find((n) => n.toLowerCase().includes(source)) ?? source;
}
const PROJECT = /^[A-Za-z][A-Za-z0-9_]{1,19}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

/** What the bridge may ask of the app besides the connectors: saving the confirmed document as a Word file (the person picks the place in a dialog). */
export type PrdHost = { exportDocx?: (payload: { title: string; markdown: string }) => Promise<{ ok: boolean; canceled?: boolean; detail?: string; path?: string; bytes?: number }> };
export const MAX_DOC = 100_000;

/** The answer to a request to save the confirmed document as a Word file (the same for the PRD Builder and the Spec Builder). */
export async function exportDocxReply(data: Record<string, unknown>, host: PrdHost | undefined, type: string): Promise<Record<string, unknown>> {
  if (!host?.exportDocx) return { type, ok: false, detail: 'Saving as Word works in the Werkbank app. Open this Space there, or copy the text.' };
  if (data.confirmed !== true) return { type, ok: false, detail: 'Confirm the document first.' };
  const markdown = typeof data.markdown === 'string' ? data.markdown : '';
  if (!markdown.trim()) return { type, ok: false, detail: 'There is nothing to save.' };
  if (markdown.length > MAX_DOC) return { type, ok: false, detail: `The document is too long (more than ${MAX_DOC / 1000} KB of text).` };
  try {
    const r = await host.exportDocx({ title: str(data.title, 120) || 'Document', markdown });
    return r.canceled ? { type, ok: false, canceled: true } : { type, ok: r.ok === true, path: str(r.path, 500), bytes: typeof r.bytes === 'number' ? r.bytes : 0, detail: r.ok ? '' : str(r.detail, 300) || 'The file could not be saved.' };
  } catch (e) { return { type, ok: false, detail: e instanceof Error ? e.message.slice(0, 300) : 'The file could not be saved.' }; }
}

export async function handlePrdMessage(data: unknown, call: BridgeCall | undefined, host?: PrdHost): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || typeof data.type !== 'string' || !data.type.startsWith('prd:')) return null;
  const fail = (message: string) => ({ type: 'prd:error', message });
  if (data.type === 'prd:export-docx') return exportDocxReply(data, host, 'prd:exported');
  const noConnector = (name: string) => fail(`The ${name} connector is not connected yet. Import it under Connectors & Skills, or use the demo.`);
  if (data.type === 'prd:linear-teams-request') {
    if (!call) return noConnector('Linear');
    try {
      const { teams } = parseToolResult(await call('linear_list_teams', {}));
      return { type: 'prd:linear-teams', teams: (Array.isArray(teams) ? teams : []).filter(isObject).slice(0, 50).map((t) => ({ key: str(t.key, 10), name: str(t.name, 80) })).filter((t) => TEAM_KEY.test(t.key)) };
    } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  }
  if (data.type === 'prd:slack-channels-request') {
    if (!call) return noConnector('Slack');
    try {
      const { channels } = parseToolResult(await call('slack_list_channels', {}));
      return { type: 'prd:slack-channels', channels: (Array.isArray(channels) ? channels : []).filter(isObject).filter((c) => c.member === true).slice(0, 100).map((c) => ({ id: str(c.id, 20), name: str(c.name, 80) })).filter((c) => SLACK_CHANNEL_ID.test(c.id)) };
    } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  }
  if (data.type === 'prd:source-request') {
    const source = data.source;
    if (source === 'linear') {
      if (!call) return noConnector('Linear');
      const team = typeof data.team === 'string' ? data.team.trim() : '';
      if (!TEAM_KEY.test(team)) return fail('Use the Linear team key (the short code, for example ENG).');
      try {
        const r: any = parseToolResult(await call('linear_read_backlog', { team: team.toUpperCase() }));
        const issues = fromLinear(r.issues);
        return { type: 'prd:backlog', source: 'linear', project: `Linear ${team.toUpperCase()}`, issues, more: Array.isArray(r.issues) && r.issues.length >= 100 };
      } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
    }
    if (source === 'slack') {
      if (!call) return noConnector('Slack');
      const raw = typeof data.channel === 'string' ? data.channel.trim() : '';
      if (!SLACK_CHANNEL_ID.test(raw) && !SLACK_CHANNEL_NAME.test(raw)) return fail('Use a channel from the list, or its name (for example product-feedback).');
      try {
        let id = raw, name = raw.replace(/^#/, '');
        if (!SLACK_CHANNEL_ID.test(raw)) {
          const { channels } = parseToolResult(await call('slack_list_channels', { query: name }));
          const hit = (Array.isArray(channels) ? channels : []).filter(isObject).find((c) => c.name === name);
          if (!hit || !SLACK_CHANNEL_ID.test(str(hit.id, 20))) return fail(`Slack channel ${name} was not found. Pick one from the list.`);
          id = str(hit.id, 20);
        } else {
          const { channels } = parseToolResult(await call('slack_list_channels', {}));
          const hit = (Array.isArray(channels) ? channels : []).filter(isObject).find((c) => c.id === raw);
          if (hit) name = str(hit.name, 80);
        }
        const r: any = parseToolResult(await call('slack_read_channel', { channel: id, limit: 50 }));
        const issues = fromSlack(r.messages, name);
        if (!issues.length) return fail(`No usable messages in #${name} (very short messages and thread replies are left out).`);
        return { type: 'prd:backlog', source: 'slack', project: `Slack #${name}`, issues, more: false };
      } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
    }
    if (source === 'notion') {
      if (!call) return noConnector('Notion');
      const query = typeof data.query === 'string' ? data.query.trim().slice(0, 300) : '';
      if (!query) return fail('Search for a page by words, or paste the link of the page.');
      try {
        const id = notionId(query);
        if (!id) {
          const found = parseToolResult(await call('notion_search', { query, type: 'page', limit: 10 }));
          const choices = notionChoices(found);
          return choices.length ? { type: 'prd:notion-choices', choices } : fail(`Notion found no page for "${query.slice(0, 60)}". Is the page shared with the integration?`);
        }
        const page = parseToolResult(await call('notion_read_page', { id }));
        const issues = fromNotion(page);
        if (!issues.length) return fail('The page has no text sections to take over.');
        return { type: 'prd:backlog', source: 'notion', project: `Notion ${issues[0].summary}`.slice(0, 100), issues, more: (page as any)?.truncated === true };
      } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
    }
    return fail('Unknown source.');
  }
  if (data.type === 'prd:projects-request') {
    if (!call) return fail('The Jira connector is not connected yet. Import it under Connectors & Skills, or use the demo backlog.');
    try {
      const { projects } = parseToolResult(await call('jira_list_projects', {}));
      return { type: 'prd:projects', projects: (Array.isArray(projects) ? projects : []).filter(isObject).slice(0, 50).map((p) => ({ key: str(p.key, 20), name: str(p.name, 80) })) };
    } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  }
  if (data.type === 'prd:backlog-request') {
    if (!call) return fail('The Jira connector is not connected yet. Import it under Connectors & Skills, or use the demo backlog.');
    if (typeof data.project !== 'string' || !PROJECT.test(data.project.trim())) return fail('Use the project key (the short code, for example ABC).');
    try {
      const r: any = parseToolResult(await call('jira_read_backlog', { project: data.project.trim().toUpperCase() }));
      const issues = (Array.isArray(r.issues) ? r.issues : []).filter(isObject).slice(0, 100).map((i: Record<string, unknown>) => ({
        key: str(i.key, 30), summary: str(i.summary, 300), type: str(i.type, 30), status: str(i.status, 40), priority: str(i.priority, 20),
        parentKey: str(i.parentKey, 30) || null, parentSummary: str(i.parentSummary, 300) || null,
        labels: Array.isArray(i.labels) ? i.labels.filter((l: unknown): l is string => typeof l === 'string').slice(0, 10) : [], description: str(i.description, 1800),
      }));
      return { type: 'prd:backlog', source: 'jira', project: str(r.project, 20), issues: issues.map((i: Record<string, unknown>) => ({ ...i, source: 'jira', url: '' })), more: r.more === true };
    } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  }
  return null;
}
