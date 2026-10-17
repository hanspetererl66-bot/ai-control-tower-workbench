import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, extname, join, parse } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 120_000;

export const ATTACHMENT_FILTERS = [
  {
    name: 'Supported files',
    extensions: [
      'pptx',
      'ppt',
      'docx',
      'doc',
      'txt',
      'md',
      'csv',
      'json',
      'png',
      'jpg',
      'jpeg',
      'webp',
    ],
  },
  { name: 'PowerPoint', extensions: ['pptx', 'ppt'] },
  { name: 'Word', extensions: ['docx', 'doc'] },
  { name: 'Text', extensions: ['txt', 'md', 'csv', 'json'] },
  { name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
];

const TYPES = {
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'presentation',
  ],
  ppt: ['application/vnd.ms-powerpoint', 'presentation'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'document',
  ],
  doc: ['application/msword', 'document'],
  txt: ['text/plain', 'text'],
  md: ['text/markdown', 'text'],
  csv: ['text/csv', 'text'],
  json: ['application/json', 'text'],
  png: ['image/png', 'image'],
  jpg: ['image/jpeg', 'image'],
  jpeg: ['image/jpeg', 'image'],
  webp: ['image/webp', 'image'],
};

function extensionOf(path) {
  return extname(path).slice(1).toLowerCase();
}

function safeFilename(name) {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'attachment').slice(0, 180);
}

function uniqueDestination(dir, originalName) {
  const safe = safeFilename(originalName);
  const parts = parse(safe);
  let candidate = join(dir, safe);
  for (let number = 2; existsSync(candidate); number += 1) {
    candidate = join(dir, `${parts.name} (${number})${parts.ext}`);
  }
  return candidate;
}

function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, value) => String.fromCodePoint(Number(value)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function xmlToText(xml) {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, '\t')
    .replace(/<(?:w:br|a:br)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/+(?:w:p|a:p|p:sp|p:graphicFrame)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXml(withBreaks)
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function unzipList(path) {
  return execFileSync('/usr/bin/unzip', ['-Z1', path], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter(Boolean);
}

function unzipEntry(path, entry) {
  return execFileSync('/usr/bin/unzip', ['-p', path, entry], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function numericXmlSort(left, right) {
  const number = (value) => Number(/(\d+)\.xml$/i.exec(value)?.[1] ?? 0);
  return number(left) - number(right);
}

export function extractDocxText(path) {
  const entries = unzipList(path);
  const ordered = [
    'word/document.xml',
    ...entries.filter((entry) => /^word\/header\d+\.xml$/i.test(entry)).sort(numericXmlSort),
    ...entries.filter((entry) => /^word\/footer\d+\.xml$/i.test(entry)).sort(numericXmlSort),
    ...entries.filter((entry) => /^word\/(?:footnotes|endnotes)\.xml$/i.test(entry)),
  ].filter((entry) => entries.includes(entry));
  if (!ordered.length) throw new Error('Word document has no readable document XML');
  return ordered.map((entry) => xmlToText(unzipEntry(path, entry))).filter(Boolean).join('\n\n');
}

export function extractPptxText(path) {
  const entries = unzipList(path);
  const slides = entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
    .sort(numericXmlSort);
  if (!slides.length) throw new Error('PowerPoint has no readable slides');
  const notes = new Map(
    entries
      .filter((entry) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(entry))
      .map((entry) => [Number(/(\d+)\.xml$/i.exec(entry)?.[1]), entry])
  );
  return slides
    .map((entry, index) => {
      const slideNumber = index + 1;
      const body = xmlToText(unzipEntry(path, entry));
      const noteEntry = notes.get(slideNumber);
      const note = noteEntry ? xmlToText(unzipEntry(path, noteEntry)) : '';
      return [`--- Slide ${slideNumber} ---`, body, note ? `Speaker notes:\n${note}` : '']
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function extractLegacyOffice(path, extension) {
  if (extension === 'doc') {
    return execFileSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', path], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  // LibreOffice is optional, but when present it gives legacy .ppt files the
  // same reliable OOXML extraction path as .pptx. The original file is still
  // attached as a resource if conversion is unavailable.
  const temp = mkdtempSync(join(tmpdir(), 'werkbank-ppt-'));
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'pptx', '--outdir', temp, path], {
      encoding: 'utf8',
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const converted = readdirSync(temp).find((name) => name.toLowerCase().endsWith('.pptx'));
    if (!converted) throw new Error('LibreOffice did not produce a PPTX file');
    return extractPptxText(join(temp, converted));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function extractAttachmentText(path, extension = extensionOf(path)) {
  if (['txt', 'md', 'csv', 'json'].includes(extension)) return readFileSync(path, 'utf8');
  if (extension === 'docx') return extractDocxText(path);
  if (extension === 'pptx') return extractPptxText(path);
  if (extension === 'doc' || extension === 'ppt') return extractLegacyOffice(path, extension);
  if (TYPES[extension]?.[1] === 'image') {
    return execFileSync('tesseract', [path, 'stdout', '-l', 'eng'], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }
  return '';
}

function clippedText(text) {
  if (text.length <= MAX_EXTRACTED_CHARS) return { text, warning: '' };
  return {
    text: `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[Extracted text clipped at ${MAX_EXTRACTED_CHARS.toLocaleString()} characters.]`,
    warning: 'Extracted text was clipped to fit the conversation context.',
  };
}

/** Copy selected files into the agent workspace and make their context portable over IPC. */
export function prepareAttachments(selectedPaths, workspaceDir) {
  if (!Array.isArray(selectedPaths)) throw new Error('selected paths must be an array');
  if (selectedPaths.length > MAX_ATTACHMENTS) {
    throw new Error(`Attach at most ${MAX_ATTACHMENTS} files at once.`);
  }

  const sources = selectedPaths.map((selected) => {
    const source = realpathSync(selected);
    const stats = statSync(source);
    const extension = extensionOf(source);
    if (!stats.isFile()) throw new Error(`${basename(source)} is not a regular file.`);
    if (!TYPES[extension]) throw new Error(`${basename(source)} is not a supported file type.`);
    if (stats.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${basename(source)} is larger than 20 MB.`);
    }
    return { source, stats, extension };
  });
  const total = sources.reduce((bytes, item) => bytes + item.stats.size, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error('The selected files are larger than 50 MB in total.');

  const attachmentDir = join(workspaceDir, 'attachments');
  mkdirSync(attachmentDir, { recursive: true });
  const files = [];
  const errors = [];

  for (const { source, stats, extension } of sources) {
    try {
      const destination = uniqueDestination(attachmentDir, basename(source));
      copyFileSync(source, destination, constants.COPYFILE_EXCL);
      const [mimeType, kind] = TYPES[extension];
      let extractedText = '';
      let warning = '';
      try {
        const clipped = clippedText(extractAttachmentText(destination, extension));
        extractedText = clipped.text;
        warning = clipped.warning;
      } catch (error) {
        if (kind !== 'image') {
          warning = `Text extraction was unavailable: ${error?.message ?? String(error)}`;
        }
      }
      files.push({
        id: randomUUID(),
        name: basename(source),
        path: destination,
        uri: pathToFileURL(destination).href,
        size: stats.size,
        mimeType,
        kind,
        extractedText,
        imageData: kind === 'image' ? readFileSync(destination).toString('base64') : '',
        warning,
      });
    } catch (error) {
      errors.push(`${basename(source)}: ${error?.message ?? String(error)}`);
    }
  }

  return { files, errors };
}
