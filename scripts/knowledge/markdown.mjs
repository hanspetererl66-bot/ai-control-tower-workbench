/**
 * Tolerant cleaner and chunker for the markdown of SAP documentation repositories.
 * Written against real files (SAP-docs/btp-cloud-logging): a "<!-- loio... -->" marker on top, anchors like
 * <a name="loio...__section_x"/>, blockquote notes ("> ### Note:"), HTML tables, fenced code, relative links.
 */
export const CHUNK_MIN = 800;
export const CHUNK_MAX = 1500;

/** Plain text of one markdown file: the title (front matter or first heading) and the cleaned body. */
export function cleanMarkdown(input) {
  let s = String(input ?? '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  let fmTitle = '';
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(s);
  if (fm) {
    fmTitle = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1] ?? '';
    s = s.slice(fm[0].length);
  }
  // protect fenced code so nothing below touches it
  const code = [];
  s = s.replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, (m) => { code.push(m); return `\u0000${code.length - 1}\u0000`; });
  s = s
    .replace(/<!--[\s\S]*?-->/g, '')                                  // comments, loio markers
    .replace(/\{\{\s*(?:include|>)[^}]*\}\}/gi, '')                   // include markers
    .replace(/^\s*\[\[(?:include|TOC)[^\]]*\]\]\s*$/gim, '')
    .replace(/<a\s+[^>]*?(?:name|id)=[^>]*?(?:\/>|>\s*<\/a>)/gi, '')   // empty anchors
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                             // images
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\{:[^}]*\}/g, '')                                       // kramdown attributes
    .replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, ' | ')                   // table cells
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(?:p|div|li|dd|dt|h[1-6]|table|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')                               // any remaining tag, text stays
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')            // links keep their text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^\[[^\]]+\]:\s*\S+.*$/gm, '')                           // reference definitions
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^>\s?/gm, '')                                           // blockquote marks; "### Note:" stays as a heading line
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => code[Number(i)]);
  s = s.trim();
  const h1 = /^#\s+(.+)$/m.exec(s)?.[1]?.trim() ?? '';
  return { title: (fmTitle || h1).slice(0, 200), text: s };
}

const NOTE_HEADING = /^(?:note|caution|tip|restriction|example|warning|recommendation|prerequisites?)\b[:\s]*$/i;

/** Sections by heading, each with its heading path ("Title > Procedure > Single document"). Note-style headings stay in the text. */
export function sections(text, rootTitle = '') {
  const lines = text.split('\n');
  const out = [];
  const path = [];
  let cur = { path: rootTitle ? [rootTitle] : [], body: [] };
  let inCode = false;
  const flush = () => { const body = cur.body.join('\n').trim(); if (body) out.push({ heading: cur.path.join(' > '), body }); };
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) inCode = !inCode;
    const m = !inCode && /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (m && NOTE_HEADING.test(m[2].trim())) { cur.body.push(`${m[2].trim().replace(/:$/, '')}:`); continue; }
    if (m) {
      flush();
      const depth = m[1].length;
      path.length = Math.min(path.length, depth - 1);
      path[depth - 1] = m[2].trim();
      const clean = path.filter(Boolean);
      cur = { path: clean[0] === rootTitle || !rootTitle ? clean : [rootTitle, ...clean], body: [] };
      continue;
    }
    cur.body.push(line);
  }
  flush();
  return out;
}

function splitLong(block) {
  if (block.length <= CHUNK_MAX) return [block];
  const parts = [];
  let rest = block;
  while (rest.length > CHUNK_MAX) {
    const window = rest.slice(0, CHUNK_MAX);
    const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. ') + 1, window.lastIndexOf(' '));
    const at = cut >= CHUNK_MIN / 2 ? cut : CHUNK_MAX;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Chunks of roughly 800 to 1500 characters that keep their heading path. Small neighbouring sections are packed together
 * (the later section's own heading stays in the text); the chunk's path is the one of its first section.
 */
export function chunkMarkdown(text, rootTitle = '') {
  const chunks = [];
  let buf = '';
  let heading = '';
  const push = () => { if (buf.trim()) chunks.push({ heading, text: buf.trim() }); buf = ''; };
  for (const sec of sections(text, rootTitle)) {
    const label = sec.heading.split(' > ').pop();
    const blocks = sec.body.split(/\n{2,}/).flatMap((b) => splitLong(b.trim())).filter(Boolean);
    let lead = true;
    for (const block of blocks) {
      const piece = lead && buf && label ? `${label}\n${block}` : block;
      if (buf && buf.length + piece.length + 2 > CHUNK_MAX) { push(); }
      if (!buf) heading = sec.heading;
      buf = buf ? `${buf}\n\n${piece}` : block;
      lead = false;
      if (buf.length >= CHUNK_MIN) push();
    }
  }
  push();
  // a tiny tail (a few words) is dropped, a noisy chunk is worth nothing in the graph
  return chunks.filter((c) => c.text.replace(/\s/g, '').length >= 40);
}
