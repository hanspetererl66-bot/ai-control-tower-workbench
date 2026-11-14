/**
 * A Word document (.docx) from simple Markdown, without a library: the file is a zip of a few XML parts (Office Open XML).
 * Supported: "# " title, "## " and "### " headings, paragraphs, "- " bullets, "1. " numbered lists, "> " quotes, **bold** and *italic*.
 * Anything else is plain text. Pure functions, used by the main process (save dialog) and by the tests.
 */
import { makeZip } from './skill-package.mjs';

export const MAX_MARKDOWN = 200_000;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Control characters are not allowed in XML 1.0 (tab, line feed and carriage return are). */
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

/** Inline text into runs: **bold** and *italic* (not nested into each other, which the PRD never needs). */
export function runs(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*/g;
  let last = 0, m;
  const run = (t, props = '') => t && out.push(`<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(clean(t))}</w:t></w:r>`);
  while ((m = re.exec(text))) {
    run(text.slice(last, m.index));
    if (m[1] !== undefined) run(m[1], '<w:b/>'); else run(m[2], '<w:i/>');
    last = m.index + m[0].length;
  }
  run(text.slice(last));
  return out.join('') || '<w:r><w:t></w:t></w:r>';
}

const para = (style, text, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${runs(text)}</w:p>`;

/** The body of word/document.xml and how many numbered lists it holds (each list restarts at 1). */
export function bodyOf(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const body = [];
  let lists = 0, inNumbered = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) { inNumbered = false; continue; }
    if ((m = /^#\s+(.*)$/.exec(line))) { body.push(para('Title', m[1])); inNumbered = false; }
    else if ((m = /^##\s+(.*)$/.exec(line))) { body.push(para('Heading1', m[1])); inNumbered = false; }
    else if ((m = /^###\s+(.*)$/.exec(line))) { body.push(para('Heading2', m[1])); inNumbered = false; }
    else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { body.push(para('ListBullet', m[1], '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')); inNumbered = false; }
    else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      if (!inNumbered) { lists += 1; inNumbered = true; }
      body.push(para('ListNumber', m[1], `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${100 + lists}"/></w:numPr>`));
    }
    else if ((m = /^>\s?(.*)$/.exec(line))) { body.push(para('Quote', m[1])); inNumbered = false; }
    else { body.push(para('', line.trim())); inNumbered = false; }
  }
  if (!body.length) body.push(para('', ''));
  return { xml: body.join(''), lists };
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const STYLES = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="A0A0A0"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>
</w:styles>`;

function numberingXml(lists) {
  const bullets = '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>';
  const numbers = '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>';
  const nums = ['<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'];
  for (let i = 1; i <= lists; i++) nums.push(`<w:num w:numId="${100 + i}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`);
  return `${XML}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${bullets}${numbers}${nums.join('')}</w:numbering>`;
}

const CONTENT_TYPES = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
const ROOT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
const DOC_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;

/** The .docx file as a Buffer. The author is not set (the app does not know who writes); the creator is the tool. */
export function markdownToDocx(markdown, { title = 'Document', now = new Date() } = {}) {
  const md = String(markdown ?? '');
  if (md.length > MAX_MARKDOWN) throw new Error(`The document is too long (more than ${MAX_MARKDOWN / 1000} KB of text).`);
  const { xml, lists } = bodyOf(md);
  const document = `${XML}<w:document ${NS}><w:body>${xml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(clean(title).slice(0, 200))}</dc:title><dc:creator>Werkbank</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
  const files = [
    ['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', ROOT_RELS], ['word/document.xml', document], ['word/_rels/document.xml.rels', DOC_RELS],
    ['word/styles.xml', STYLES], ['word/numbering.xml', numberingXml(lists)], ['docProps/core.xml', core],
  ].map(([path, text]) => ({ path, data: Buffer.from(text, 'utf8') }));
  return makeZip('', files, now);
}

/** A safe file name from a title: letters, digits, dots, dashes and underscores, at most 80 characters, with the extension. */
export function docxFileName(title) {
  const base = String(title ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80);
  return `${base || 'document'}.docx`;
}
