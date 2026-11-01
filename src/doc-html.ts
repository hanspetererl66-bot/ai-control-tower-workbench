/**
 * Documents in Develop are kept as HTML, so they can carry bold, italics, fonts, sizes, links and pictures.
 * The agent writes Markdown; it is turned into HTML once. Everything that comes from the editor, a paste or an old
 * project goes through sanitizeHtml, and prompts get the text back as Markdown.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export const FONTS = [
  { label: 'Sans', value: 'Inter, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Times', value: 'Times New Roman, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Mono', value: 'Courier New, monospace' },
] as const;
export const FONT_SIZES = [11, 12, 13, 14, 16, 18, 20, 24, 28, 32] as const;

const TAGS = new Set(['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'a', 'img', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'sub', 'sup']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'noscript', 'template', 'head', 'title']);
const VOID = new Set(['br', 'hr', 'img']);
const FONT_BY_FIRST = new Map(FONTS.map((f) => [f.value.split(',')[0].trim().toLowerCase(), f.value]));
export const MAX_IMAGE_DATA_URL = 1_500_000;

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (t: string) => esc(t).replace(/"/g, '&quot;');

/** Only the style properties the editor can make, with checked values. */
export function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const part of style.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim().toLowerCase();
    if (prop === 'font-size') {
      const m = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(value);
      if (m) { const px = m[2] === 'pt' ? Number(m[1]) * 1.333 : Number(m[1]); if (px >= 8 && px <= 72) out.push(`font-size: ${Math.round(px * 10) / 10}px`); }
    } else if (prop === 'font-family') {
      const first = value.split(',')[0].trim().replace(/^["']|["']$/g, '');
      const known = FONT_BY_FIRST.get(first);
      if (known) out.push(`font-family: ${known}`);
    } else if (prop === 'font-weight' && /^(normal|bold|[1-9]00)$/.test(value)) out.push(`font-weight: ${value}`);
    else if (prop === 'font-style' && /^(normal|italic)$/.test(value)) out.push(`font-style: ${value}`);
    else if ((prop === 'text-decoration' || prop === 'text-decoration-line') && /^(none|underline|line-through)$/.test(value)) out.push(`text-decoration: ${value}`);
    else if (prop === 'text-align' && /^(left|right|center|justify)$/.test(value)) out.push(`text-align: ${value}`);
    else if (prop === 'color' && /^(#[0-9a-f]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))$/.test(value)) out.push(`color: ${value}`);
  }
  return out.join('; ');
}

export function safeHref(href: string): string {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) && !/[\s"<>]/.test(h) ? h : '';
}

export function safeImageSrc(src: string): string {
  const s = src.trim();
  if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) return s.length <= MAX_IMAGE_DATA_URL ? s : '';
  return /^https:\/\/[^\s"<>]+$/i.test(s) ? s : '';
}

function walk(node: Node, parseFont: boolean): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) { out += esc(child.textContent ?? ''); continue; }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    let tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (tag === 'font' && parseFont) {
      // Old editor output: <font face> and <font size> become a span with checked styles.
      const face = el.getAttribute('face');
      const style = [el.getAttribute('style') ?? '', face ? `font-family: ${face}` : ''].join(';');
      const s = cleanStyle(style);
      const inner = walk(el, parseFont);
      out += s ? `<span style="${escAttr(s)}">${inner}</span>` : inner;
      continue;
    }
    if (!TAGS.has(tag)) { out += walk(el, parseFont); continue; }
    if (tag === 'b') tag = 'strong';
    if (tag === 'i') tag = 'em';
    if (tag === 'strike' || tag === 'del') tag = 's';
    let attrs = '';
    const style = cleanStyle(el.getAttribute('style') ?? '');
    if (style && tag !== 'img') attrs += ` style="${escAttr(style)}"`;
    if (tag === 'a') {
      const href = safeHref(el.getAttribute('href') ?? '');
      if (!href) { out += walk(el, parseFont); continue; }
      attrs += ` href="${escAttr(href)}" target="_blank" rel="noopener noreferrer"`;
    }
    if (tag === 'img') {
      const src = safeImageSrc(el.getAttribute('src') ?? '');
      if (!src) continue;
      const w = Number(el.getAttribute('width'));
      attrs += ` src="${escAttr(src)}" alt="${escAttr((el.getAttribute('alt') ?? '').slice(0, 200))}"`;
      if (Number.isFinite(w) && w >= 16 && w <= 2000) attrs += ` width="${Math.round(w)}"`;
      const imgStyle = /^(left|right|center)$/.test(el.getAttribute('data-align') ?? '') ? '' : '';
      void imgStyle;
    }
    if ((tag === 'td' || tag === 'th')) {
      for (const k of ['colspan', 'rowspan']) { const n = Number(el.getAttribute(k)); if (Number.isInteger(n) && n > 1 && n <= 20) attrs += ` ${k}="${n}"`; }
    }
    if (VOID.has(tag)) { out += `<${tag}${attrs}>`; continue; }
    out += `<${tag}${attrs}>${walk(el, parseFont)}</${tag}>`;
  }
  return out;
}

/** Allow-list sanitiser. Needs a DOM (the browser, or jsdom in tests). */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${String(html)}</body>`, 'text/html');
  return walk(doc.body, true).trim();
}

/** Markdown from the agent as HTML. */
export function markdownToHtml(markdown: string): string {
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown));
  return sanitizeHtml(html);
}

const LOOKS_LIKE_HTML = /^\s*<(h[1-6]|p|div|table|ul|ol|blockquote|img|span|section|article|pre|strong|em|a)\b/i;

/** A stored document: HTML as it is (checked), Markdown (older projects) turned into HTML. */
export function toHtml(stored: string): string {
  if (!stored.trim()) return '';
  return LOOKS_LIKE_HTML.test(stored) ? sanitizeHtml(stored) : markdownToHtml(stored);
}

export function htmlToMarkdown(html: string, { images = 'omit' }: { images?: 'omit' | 'keep' } = {}): string {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
  td.use(gfm);
  td.addRule('image', {
    filter: 'img',
    replacement: (_c, node) => {
      const el = node as HTMLElement;
      const alt = el.getAttribute('alt') || 'image';
      return images === 'keep' ? `![${alt}](${el.getAttribute('src') ?? ''})` : `[image: ${alt}]`;
    },
  });
  return td.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain length of the text, to see whether a document has content at all. */
export function textOfHtml(html: string): string {
  const spaced = html.replace(/<\/(p|h[1-6]|li|tr|div|td|th|blockquote)>|<br\s*\/?>/gi, ' $&');
  const doc = new DOMParser().parseFromString(`<body>${spaced}</body>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A stored document as Markdown, for prompts (older projects store Markdown already). */
export function docToMarkdown(stored: string): string {
  return LOOKS_LIKE_HTML.test(stored) ? htmlToMarkdown(stored) : stored;
}
