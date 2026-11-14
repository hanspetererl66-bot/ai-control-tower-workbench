/**
 * A proper title on top of every Space, like the one in the Sales Space: large, bold, the last word in violet.
 * The app puts it in when it opens a Space (the title comes from space.json, so new and designed Spaces get one too and no page has to change).
 * A Space that already carries a title of its own gets none: a heading in the page, a brand header that already says the name, or `ownTitle: true`
 * in its space.json (for a page whose heading is made by its script). `heading` in space.json replaces the title where the title does not read well as a heading.
 */
export const SPACE_TITLE_ID = 'werkbank-space-title';

export type TitleSource = { title: string; heading?: string; ownTitle?: boolean };

const MAX_HEADING = 80;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The words shown as the heading: `heading` when the Space gives one, else the title; one line, not longer than 80 characters. */
export function headingOf(space: TitleSource): string {
  const own = typeof space.heading === 'string' ? squash(space.heading) : '';
  const text = own || squash(space.title ?? '');
  return text.length > MAX_HEADING ? `${text.slice(0, MAX_HEADING - 1).trimEnd()}…` : text;
}

/** The heading in two parts: everything but the last word, and the last word (the whole text when it is one word). */
export function splitHeading(text: string): { lead: string; accent: string } {
  const t = squash(text);
  const at = t.lastIndexOf(' ');
  return at < 0 ? { lead: '', accent: t } : { lead: t.slice(0, at), accent: t.slice(at + 1) };
}

const plain = (s: string): string => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();

/** Does the page say its own name already? A heading in the markup, a header that carries the title, or the flag. Scripts and styles do not count. */
export type OwnTitle = 'flag' | 'heading' | 'brand' | null;

/** What kind of title the page has: the flag, a heading in the markup, a header that carries the name (the name at the very start of the page), or none. */
export function ownTitleKind(html: string, space: TitleSource): OwnTitle {
  if (space.ownTitle === true) return 'flag';
  const at = html.search(/<body[\s>]/i);
  if (at < 0) return 'flag'; // not a page we can put anything into
  const body = html.slice(at).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  if (/<h1[\s>]/i.test(body)) return 'heading';
  // the first words of the page as a person reads them: inline tags (a bold last word in a logo) do not split a word, other tags are a space
  const top = plain(body.slice(0, 4000).replace(/<\/?(?:b|i|em|strong|span|small|mark)\b[^>]*>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').slice(0, 220));
  const names = [space.title, space.heading].filter((n): n is string => typeof n === 'string' && plain(n).length >= 3).map(plain);
  return names.some((n) => ` ${top} `.includes(` ${n} `)) ? 'brand' : null;
}

export const hasOwnTitle = (html: string, space: TitleSource): boolean => ownTitleKind(html, space) !== null;

/** The style of the title: tokens only, so light, dark and the chosen accent apply. */
export function titleCss(): string {
  return `.wb-space-title{margin:20px 32px 4px;padding:0;font-size:28px;line-height:1.15;font-weight:750;letter-spacing:-.025em;color:var(--ink,inherit)}`
    + `.wb-space-title span{color:var(--purple,var(--accent,inherit))}`
    + `@media (max-width:640px){.wb-space-title{margin:16px 16px 2px;font-size:23px}}`;
}

/**
 * The name in the header of a page (the logo with a bold last word, or the title of a Control Tower style header) gets the same look as the title above:
 * large, bold, the last word violet. Only the size, weight and colour change; the page keeps its own header.
 */
export function brandCss(): string {
  return `header .logo{font-size:28px;line-height:1.15;font-weight:750;letter-spacing:-.025em}`
    + `header .logo b{color:var(--purple,var(--accent,inherit))}`
    + `.hdr .hdr-title{font-size:24px;line-height:1.15;font-weight:750;letter-spacing:-.02em}`;
}

/** The page with the title as its first element; a page with a header name gets that name restyled; a page with a heading of its own stays as it is. */
export function applySpaceTitle(html: string, space: TitleSource): string {
  if (!html || html.includes(`id="${SPACE_TITLE_ID}"`) || html.includes(`id="${SPACE_TITLE_ID}-style"`)) return html;
  const kind = ownTitleKind(html, space);
  if (kind === 'brand') {
    const style = `<style id="${SPACE_TITLE_ID}-style">${brandCss()}</style>`;
    const out = html.replace(/<\/head>/i, `${style}</head>`);
    return out === html ? html.replace(/<body([\s>])/i, `${style}<body$1`) : out;
  }
  if (kind) return html;
  const text = headingOf(space);
  if (!text) return html;
  const { lead, accent } = splitHeading(text);
  const h1 = `<h1 class="wb-space-title" id="${SPACE_TITLE_ID}">${lead ? `${esc(lead)} ` : ''}<span>${esc(accent)}</span></h1>`;
  const style = `<style id="${SPACE_TITLE_ID}-style">${titleCss()}</style>`;
  let out = html.replace(/<\/head>/i, `${style}</head>`);
  if (out === html) out = html.replace(/<body([\s>])/i, `${style}<body$1`);
  return out.replace(/<body\b[^>]*>/i, (open) => `${open}${h1}`);
}
