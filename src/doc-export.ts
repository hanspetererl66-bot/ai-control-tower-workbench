import { htmlToMarkdown } from './doc-html';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PAGE_CSS = `
body{font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1d2433;max-width:820px;margin:32px auto;padding:0 28px}
h1{font-size:28px;line-height:1.25;margin:0 0 18px;padding-bottom:10px;border-bottom:3px solid #6d4aff}
h2{font-size:20px;margin:30px 0 8px;color:#3b2a99}h3{font-size:16px;margin:20px 0 6px}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}th{background:#efeaff;text-align:left}
th,td{border:1px solid #cfc8ee;padding:6px 10px;vertical-align:top}tr:nth-child(even) td{background:#faf9ff}
blockquote{margin:12px 0;padding:6px 14px;border-left:4px solid #b9a8ff;background:#f6f3ff}
code{background:#f1f0f7;padding:1px 5px;border-radius:4px}pre{background:#f1f0f7;padding:12px;border-radius:8px;overflow:auto}
img{max-width:100%;height:auto}a{color:#5b3fe0}
@media print{body{margin:0;max-width:none}h2{break-after:avoid}table,img{break-inside:avoid}}`;

/** A complete, self-contained HTML file for one document. */
export function wrapHtml(html: string, title: string): string {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${PAGE_CSS}</style></head><body>\n${html}\n</body></html>\n`;
}

/** Word opens HTML with these namespaces as a document. */
export function wrapWord(html: string, title: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body>\n${html}\n</body></html>`;
}

export function saveFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ExportFormat = 'html' | 'word' | 'md' | 'pdf';

/** PDF goes through the print dialog of the system ("Save as PDF"). */
function printHtml(html: string, title: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = wrapHtml(html, title);
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

export function exportDocument(format: ExportFormat, html: string, baseName: string, title: string): void {
  if (format === 'html') saveFile(`${baseName}.html`, wrapHtml(html, title), 'text/html;charset=utf-8');
  else if (format === 'word') saveFile(`${baseName}.doc`, wrapWord(html, title), 'application/msword');
  else if (format === 'md') saveFile(`${baseName}.md`, htmlToMarkdown(html, { images: 'keep' }) + '\n', 'text/markdown;charset=utf-8');
  else printHtml(html, title);
}
