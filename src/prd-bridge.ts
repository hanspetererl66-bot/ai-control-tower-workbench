/**
 * Bridge between the sandboxed PRD Builder Space and the Jira connector.
 * The Space has no network, so it asks the app by postMessage. Only two read-only tools can be reached through here:
 * jira_list_projects and jira_read_backlog. Nothing in Jira is changed.
 */
import { parseToolResult, type BridgeCall } from './sub4me-bridge.ts';

export const PRD_SPACE = 'prd-builder';
export const JIRA_EXTENSION = 'jira';
const PROJECT = /^[A-Za-z][A-Za-z0-9_]{1,19}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

export async function handlePrdMessage(data: unknown, call: BridgeCall | undefined): Promise<Record<string, unknown> | null> {
  if (!isObject(data) || typeof data.type !== 'string' || !data.type.startsWith('prd:')) return null;
  const fail = (message: string) => ({ type: 'prd:error', message });
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
      return { type: 'prd:backlog', project: str(r.project, 20), issues, more: r.more === true };
    } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  }
  return null;
}
