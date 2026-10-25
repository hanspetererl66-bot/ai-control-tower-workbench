import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { exportFileName, markdownDocument } from './export-answer';

const CSS = 'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45;color:#1c1c1e;margin:24px}h1{font-size:20pt;color:#4b0082}h2{font-size:14pt}table{border-collapse:collapse;margin:8px 0}th,td{border:1px solid #bbb;padding:4px 8px;text-align:left}th{background:#f0e9f7}code{font-family:Consolas,monospace;background:#f4f4f7;padding:0 3px}pre{background:#f4f4f7;padding:8px;white-space:pre-wrap}.meta{color:#6b7280;font-size:9pt}a{color:#6d28d9}';

export function answerHtml(title: string, text: string, sources: string[], now = new Date()): string {
  const body = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>);
  const src = sources.length ? `<h2>Sources</h2><ul>${sources.map((s) => `<li>${s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)}</li>`).join('')}</ul>` : '';
  const safeTitle = title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${safeTitle}</title><style>${CSS}</style></head><body><h1>${safeTitle}</h1><p class="meta">Exported from Werkbank on ${now.toISOString().slice(0, 10)}</p>${body}${src}</body></html>`;
}

function download(name: string, mime: string, data: string) {
  const url = URL.createObjectURL(new Blob([data], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export type ExportKind = 'md' | 'word' | 'pdf';

export function exportAnswer(kind: ExportKind, title: string, text: string, sources: string[]): void {
  if (kind === 'md') return download(exportFileName(title, 'md'), 'text/markdown', markdownDocument(title, text, sources));
  const html = answerHtml(title, text, sources);
  if (kind === 'word') return download(exportFileName(title, 'doc'), 'application/msword', html);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = html;
  frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 60_000); };
  document.body.appendChild(frame);
}
