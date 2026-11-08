/**
 * Pure helpers of the job posting screen inside Hiring approvals. The database decides who may release, publish or withdraw
 * (only the hiring manager of the requisition) and keeps the log; this file only shapes what the screen shows.
 * Publishing is a simulation: no channel is connected.
 */
export type PostingStatus = 'draft' | 'in_review' | 'released' | 'withdrawn';
export type Section = { key: string; label: string; text: string; locked: boolean };
export type Posting = {
  id: number; requisition: string; title: string; status: PostingStatus; sections: Section[]; createdBy: string; updatedAt: string;
  releasedBy: string | null; releasedAt: string | null; publications: Array<{ channel: string; mode: string; status: string; at: string }>;
};
export type Channel = { id: string; name: string; limit: number };

const STATUS = new Set<string>(['draft', 'in_review', 'released', 'withdrawn']);
export const STATUS_LABEL: Record<PostingStatus, string> = { draft: 'Draft', in_review: 'Waiting for you', released: 'Released', withdrawn: 'Withdrawn' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads recruiting_postings_list and the channels; rows that do not look right are dropped, never repaired. */
export function readPostings(data: unknown): { postings: Posting[]; channels: Channel[] } {
  const d = isObj(data) ? data : {};
  const postings: Posting[] = [];
  for (const r of Array.isArray(d.postings) ? d.postings : []) {
    if (!isObj(r) || !Number.isInteger(r.id) || typeof r.requisition !== 'string' || typeof r.title !== 'string' || !STATUS.has(String(r.status))) continue;
    const sections: Section[] = (Array.isArray(r.sections) ? r.sections : []).filter(isObj)
      .filter((s) => typeof s.key === 'string' && typeof s.text === 'string')
      .map((s) => ({ key: String(s.key), label: String(s.label ?? s.key), text: String(s.text), locked: s.locked === true }));
    postings.push({
      id: r.id as number, requisition: r.requisition, title: r.title, status: r.status as PostingStatus, sections, createdBy: String(r.createdBy ?? ''),
      updatedAt: String(r.updatedAt ?? ''), releasedBy: typeof r.releasedBy === 'string' ? r.releasedBy : null, releasedAt: typeof r.releasedAt === 'string' ? r.releasedAt : null,
      publications: (Array.isArray(r.publications) ? r.publications : []).filter(isObj).map((b) => ({ channel: String(b.channel ?? ''), mode: String(b.mode ?? ''), status: String(b.status ?? ''), at: String(b.at ?? '') })),
    });
  }
  const channels: Channel[] = (Array.isArray(d.channels) ? d.channels : []).filter(isObj)
    .filter((c) => typeof c.id === 'string' && typeof c.name === 'string')
    .map((c) => ({ id: String(c.id), name: String(c.name), limit: Number(c.limit) || 0 }));
  return { postings, channels };
}

/** Postings waiting for the manager first, then drafts, released, withdrawn; newest first inside a group. */
export function sortPostings(list: Posting[]): Posting[] {
  const rank: Record<PostingStatus, number> = { in_review: 0, released: 1, draft: 2, withdrawn: 3 };
  return [...list].sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt.localeCompare(a.updatedAt));
}

export function countPostings(list: Posting[]): Record<PostingStatus, number> {
  const out: Record<PostingStatus, number> = { draft: 0, in_review: 0, released: 0, withdrawn: 0 };
  for (const p of list) out[p.status] += 1;
  return out;
}

/** Channels not yet published for this posting (publishing again is harmless, but there is nothing to choose). */
export function openChannels(p: Posting, channels: Channel[]): Channel[] {
  const done = new Set(p.publications.map((b) => b.channel));
  return channels.filter((c) => !done.has(c.id));
}

/** Database messages in plain words. */
export function postingError(message: string): string {
  if (/only the hiring manager/i.test(message)) return 'Only the hiring manager of this requisition can do this.';
  if (/empty field|credential|personal trait|gender-neutral/i.test(message)) return `The text needs a change first: ${message}`;
  if (/accepts up to/i.test(message)) return message;
  if (/not open/i.test(message)) return 'The requisition is not open any more.';
  return message;
}
