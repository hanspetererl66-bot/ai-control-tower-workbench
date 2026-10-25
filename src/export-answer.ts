/** Export of one answer: file name and Markdown document (pure). The HTML for Word and PDF is built in export-answer-html.tsx. */
export function exportFileName(title: string, ext: string, now = new Date()): string {
  const slug = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 50) || 'answer';
  return `${slug}-${now.toISOString().slice(0, 10)}.${ext}`;
}

export function markdownDocument(title: string, text: string, sources: string[] = [], now = new Date()): string {
  const lines = [`# ${title}`, '', `_Exported from Werkbank on ${now.toISOString().slice(0, 10)}._`, '', text.trim(), ''];
  if (sources.length) lines.push('## Sources', '', ...sources.map((s) => `- ${s}`), '');
  return lines.join('\n');
}
