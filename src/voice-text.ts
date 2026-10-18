/**
 * Turn a streamed Markdown reply into sentences that can be read aloud.
 * Code blocks, tables, URLs and formatting marks are not spoken; every list item and heading ends a sentence.
 * Sentences are released as soon as they are complete so speaking can start while the reply is still streaming.
 */

// Abbreviations after which a period does not end a sentence (German and English).
const ABBREVIATIONS = new Set([
  'z', 'b', 'bzw', 'ca', 'd', 'h', 'u', 'a', 'o', 'vgl', 'dr', 'nr', 'ggf', 'evtl', 'usw', 'etc', 'inkl', 'zzgl', 'bspw',
  'mr', 'mrs', 'ms', 'prof', 'vs', 'e', 'g', 'i', 'sog', 'str',
]);

const EMOJI = /[\p{Extended_Pictographic}️‍]/gu;

/** Remove Markdown marks from one line of prose. */
export function cleanLine(line: string): string {
  return line
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>+\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split after . ! ? when followed by whitespace, except after common abbreviations and numbers like "3. Quartal". */
export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  const re = /[.!?]+(?=\s)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const end = match.index + match[0].length;
    const word = /([\p{L}\p{N}]+)$/u.exec(text.slice(start, match.index))?.[1] ?? '';
    const abbreviation = match[0] === '.' && (ABBREVIATIONS.has(word.toLowerCase()) || /^\d+$/.test(word));
    if (abbreviation) continue;
    parts.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

const isTableRow = (line: string) => /^\s*\|/.test(line) || /^\s*[-:| ]{3,}\s*$/.test(line) && line.includes('|');

export type SpeechSplitter = {
  /** Feed the next chunk of the reply; returns the sentences that are now complete. */
  push(chunk: string): string[];
  /** The reply is finished; returns whatever is left. */
  flush(): string[];
};

export function createSpeechSplitter(): SpeechSplitter {
  let pending = '';
  let inFence = false;

  function consumeLine(line: string): string[] {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return [];
    }
    if (inFence || isTableRow(line)) return [];
    const cleaned = cleanLine(line);
    return cleaned ? splitSentences(cleaned) : [];
  }

  /** Complete sentences inside a still-growing line, as long as no Markdown construct is half-written. */
  function partial(): string[] {
    if (inFence || /^\s*(```|~~~|\|)/.test(pending) || /^\s*`{1,2}$/.test(pending)) return [];
    const re = /[.!?]+(?=\s)/g;
    let cut = -1;
    let match: RegExpExecArray | null;
    while ((match = re.exec(pending))) {
      const head = pending.slice(0, match.index + match[0].length);
      const balanced = (head.match(/\[/g)?.length ?? 0) === (head.match(/\]/g)?.length ?? 0)
        && (head.match(/`/g)?.length ?? 0) % 2 === 0 && (head.match(/\*\*/g)?.length ?? 0) % 2 === 0
        && !/https?:\/\/\S*$/.test(head);
      const word = /([\p{L}\p{N}]+)$/u.exec(pending.slice(0, match.index))?.[1] ?? '';
      const abbreviation = match[0] === '.' && (ABBREVIATIONS.has(word.toLowerCase()) || /^\d+$/.test(word));
      if (balanced && !abbreviation) cut = match.index + match[0].length;
    }
    if (cut < 0) return [];
    const head = pending.slice(0, cut);
    pending = pending.slice(cut).replace(/^\s+/, '');
    const cleaned = cleanLine(head);
    return cleaned ? splitSentences(cleaned) : [];
  }

  return {
    push(chunk) {
      pending += chunk;
      const out: string[] = [];
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        out.push(...consumeLine(line));
        newline = pending.indexOf('\n');
      }
      out.push(...partial());
      return out;
    },
    flush() {
      const line = pending;
      pending = '';
      const out = consumeLine(line);
      inFence = false;
      return out;
    },
  };
}

/** Everything at once, for a finished reply. */
export function speakableSentences(markdown: string): string[] {
  const splitter = createSpeechSplitter();
  return [...splitter.push(markdown), ...splitter.flush()];
}
