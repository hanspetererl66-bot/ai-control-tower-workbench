/**
 * Control over what the app knows about the person: the preview of the context that goes with every message,
 * export and deletion of all personalisation data on this computer, and the audit trail of approvals.
 * Everything here is local (localStorage). Nothing is sent anywhere.
 */
import type { SkillGov } from './skill-governance';

/** Every localStorage key that holds personalisation data. Conversations and app settings are not part of it. */
export const PERSONAL_KEYS = [
  'werkbank.memory', 'werkbank.personas', 'werkbank.commands', 'werkbank.skillGovernance', 'werkbank.memoryGovernance',
  'werkbank.agentGovernance', 'werkbank.studioAgents', 'werkbank.localGroups', 'werkbank.groupMode', 'werkbank.schedules.v1',
] as const;

export type ExportBundle = { app: 'Joule Work X – Next Gen (prototype)'; exportedAt: string; note: string; data: Record<string, unknown> };

export function exportPersonal(store: Pick<Storage, 'getItem'>, now = new Date()): ExportBundle {
  const data: Record<string, unknown> = {};
  for (const key of PERSONAL_KEYS) {
    let raw: string | null = null;
    try { raw = store.getItem(key); } catch { /* unreadable */ }
    if (raw == null) continue;
    try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
  }
  return { app: 'Joule Work X – Next Gen (prototype)', exportedAt: now.toISOString(), note: 'All personalisation data stored on this computer: memory, personas, commands, approvals, agents, groups, schedules.', data };
}

/** Removes every personalisation key; returns how many were present. */
export function clearPersonal(store: Pick<Storage, 'getItem' | 'removeItem'>): number {
  let n = 0;
  for (const key of PERSONAL_KEYS) {
    try { if (store.getItem(key) != null) { store.removeItem(key); n++; } } catch { /* ignore */ }
  }
  return n;
}

/* ---- Preview: what goes along with the next message ---- */
export type PreviewSection = { id: string; title: string; text: string; active: boolean; hint: string };
export function contextPreview(parts: { style: string; persona: string; memory: string; group: string }): PreviewSection[] {
  const sec = (id: string, title: string, text: string, hint: string): PreviewSection => ({ id, title, text: text.trim(), active: text.trim().length > 0, hint });
  return [
    sec('style', 'Assistant style', parts.style, 'Settings, tab Assistant'),
    sec('persona', 'Persona', parts.persona, 'Persona in the bar above the message box'),
    sec('memory', 'Memory', parts.memory, 'Settings, tab Memory'),
    sec('group', 'Group', parts.group, 'Settings, tab Groups'),
  ];
}

/* ---- Audit trail, derived from the approval stores ---- */
export type AuditEvent = { at: number; kind: 'Skill' | 'Memory' | 'Agent'; what: string; action: 'requested' | 'approved' | 'rejected'; from: string; to: string; note: string };
export function buildAudit(sources: Array<{ kind: AuditEvent['kind']; gov: SkillGov; nameOf: (id: string) => string }>): AuditEvent[] {
  const out: AuditEvent[] = [];
  for (const { kind, gov, nameOf } of sources) {
    for (const r of gov.requests) {
      const base = { kind, what: nameOf(r.skill), from: gov.levels[r.from] ?? String(r.from), to: gov.levels[r.to] ?? String(r.to) };
      out.push({ ...base, at: r.createdAt, action: 'requested', note: r.note ?? '' });
      if ((r.status === 'approved' || r.status === 'rejected') && r.decidedAt) out.push({ ...base, at: r.decidedAt, action: r.status, note: r.reason ?? '' });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
export function auditCsv(events: AuditEvent[]): string {
  const rows = events.map((e) => [new Date(e.at).toISOString(), e.kind, e.what, e.action, e.from, e.to, e.note].map((c) => csvCell(String(c))).join(','));
  return ['time,kind,item,action,from,to,note', ...rows].join('\n');
}
