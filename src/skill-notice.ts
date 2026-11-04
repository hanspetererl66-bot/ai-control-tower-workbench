/** The end-of-life notice of a skill pulled from the shared registry: "Ends 2026-12-01 · replaced by x". */
export type NoticeLike = { sunsetAt?: string; replacedBy?: string };
const DAY = 86_400_000;

export type SkillNotice = { text: string; state: 'upcoming' | 'ended' };

export function skillNotice(s: NoticeLike, now = Date.now()): SkillNotice | null {
  if (!s.sunsetAt && !s.replacedBy) return null;
  const end = s.sunsetAt && /^\d{4}-\d{2}-\d{2}$/.test(s.sunsetAt) ? Date.parse(`${s.sunsetAt}T23:59:59Z`) : NaN;
  const ended = Number.isFinite(end) && end < now;
  const parts: string[] = [];
  if (s.sunsetAt) parts.push(ended ? `Ended ${s.sunsetAt}` : `Ends ${s.sunsetAt}${Number.isFinite(end) ? ` (in ${Math.max(0, Math.ceil((end - now) / DAY))} days)` : ''}`);
  if (s.replacedBy) parts.push(`use “${s.replacedBy}” instead`);
  return { text: parts.join(' · '), state: ended ? 'ended' : 'upcoming' };
}
