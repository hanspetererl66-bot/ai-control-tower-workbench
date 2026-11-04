import { reviewSkill, type CheckResult } from './skill-review.ts';

export type PackFile = { path: string; bytes: number };

/** The automatic review used before a skill is handed on or taken in (same five checks as the promotion flow). */
export function reviewPackage(text: string): CheckResult[] {
  return reviewSkill(text, 'department');
}

/** A skill with a credential in it must not be handed to others; every other finding is only shown. */
export function exportBlocker(results: CheckResult[]): string | null {
  const secret = results.find((r) => r.id === 'secrets' && r.status === 'fail');
  return secret ? `Not exported: ${secret.detail}` : null;
}

/** An import with a red finding (credential, dangerous command, bypassing the harness) cannot be installed. */
export function importBlocked(results: CheckResult[]): boolean {
  return results.some((r) => r.status === 'fail');
}

/** Files that are more than instructions: scripts and anything that is not plain text or Markdown. */
export function extraFiles(files: PackFile[]): PackFile[] {
  return files.filter((f) => f.path !== 'SKILL.md' && !/\.(md|txt)$/i.test(f.path));
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
