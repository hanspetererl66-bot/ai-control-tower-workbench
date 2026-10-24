import { packageFileName } from '../shared/space-package.mjs';

/** Share a Space as one file and install a file from someone else. The dev server does the disk work (vite.config.mts). */
export type ImportResult = { slug: string; title: string; replaced?: boolean } | { exists: true; slug: string; title: string };

export async function downloadSpaceFile(slug: string): Promise<string> {
  const res = await fetch(`/__spaces/${encodeURIComponent(slug)}/package`, { cache: 'no-store' });
  if (!res.ok) throw new Error('The Space could not be read.');
  const blob = new Blob([await res.text()], { type: 'application/json' });
  const name = packageFileName(slug);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/** A mail draft cannot carry an attachment, so the text tells the sender to attach the downloaded file. */
export function emailDraftUrl(title: string, fileName: string): string {
  const subject = `Werkbank Space: ${title}`;
  const body = [
    `Hello,`,
    ``,
    `attached is the Space "${title}" for Joule Work X (file ${fileName}).`,
    `To use it: open Joule Work X, go to Spaces, click "Import Space" and choose the file.`,
    ``,
  ].join('\n');
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function importSpaceFile(file: File, mode?: 'new' | 'replace'): Promise<ImportResult> {
  if (file.size > 5 * 1024 * 1024) throw new Error('The file is too large for a Space (limit 5 MB).');
  const res = await fetch(`/__spaces/import${mode ? `?mode=${mode}` : ''}`, { method: 'POST', body: await file.text() });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409) return body;
  if (!res.ok) throw new Error(body?.error ?? 'The Space could not be imported.');
  return body;
}
