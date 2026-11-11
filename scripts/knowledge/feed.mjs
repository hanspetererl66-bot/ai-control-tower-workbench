/**
 * Feed collector for metadata_only sources. Reads RSS 2.0 and Atom and keeps ONLY title, URL, date, categories and
 * language. The parser never looks at description, summary or content elements, so no body text can pass through.
 */
import { assertCollectable } from './registry.mjs';
import { RobotsDisallowedError } from './http.mjs';
import { metadataDocument, shortHash } from './documents.mjs';

const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const text = (s) => decode(String(s ?? '').replace(CDATA, '$1').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const first = (xml, tag) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml); return m ? text(m[1]) : ''; };
const all = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => text(m[1])).filter(Boolean);
const isoDate = (v) => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : ''; };

/** Items of a feed as {guid, title, url, date, categories, language}. Tolerant: an item without title and URL is dropped. */
export function parseFeed(xml) {
  const src = String(xml ?? '');
  const channelLang = first(src.replace(/<item[\s\S]*$/i, ''), 'language') || (/<feed\b[^>]*xml:lang="([^"]+)"/i.exec(src)?.[1] ?? '');
  const items = [];
  for (const m of src.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const x = m[1];
    items.push({ guid: first(x, 'guid'), title: first(x, 'title'), url: first(x, 'link'), date: isoDate(first(x, 'pubDate') || first(x, 'dc:date')), categories: all(x, 'category'), language: channelLang });
  }
  for (const m of src.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const x = m[1];
    const href = /<link\b[^>]*?href="([^"]+)"[^>]*?(?:rel="alternate"[^>]*)?\/?>/i.exec(x)?.[1] ?? '';
    const cats = [...x.matchAll(/<category\b[^>]*?(?:term|label)="([^"]+)"/gi)].map((c) => decode(c[1]).trim()).filter(Boolean);
    items.push({ guid: first(x, 'id'), title: first(x, 'title'), url: decode(href), date: isoDate(first(x, 'published') || first(x, 'updated')), categories: cats, language: /xml:lang="([^"]+)"/i.exec(x)?.[1] ?? channelLang });
  }
  return items.filter((i) => (i.title || i.url) && /^https:\/\//.test(i.url || 'https://'));
}

const SEEN_MAX = 5000;

/**
 * @returns {{documents, nextState, refused: {feed, why}[], items: number}} documents = items not seen in `state`.
 */
export async function collectFeed({ source, feeds, http, state, limit = Infinity, full = false }) {
  assertCollectable(source, 'metadata');
  const documents = [];
  const refused = [];
  const next = { ...state, feeds: { ...state.feeds } };
  let items = 0;
  for (const feed of feeds) {
    const key = `${source.id}|${feed}`;
    let xml;
    try {
      const res = await http.get(feed, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9' } });
      if (!res.ok) { refused.push({ feed, why: `HTTP ${res.status}` }); continue; }
      xml = await res.text();
    } catch (e) {
      refused.push({ feed, why: e instanceof RobotsDisallowedError ? e.message : `could not fetch: ${e.message}` });
      continue;
    }
    const seen = new Set(full ? [] : state.feeds[key]?.seen ?? []);
    const nowSeen = [...seen];
    for (const it of parseFeed(xml)) {
      items += 1;
      const id = shortHash(it.guid || it.url);
      if (seen.has(id)) continue;
      if (documents.length >= limit) break; // not recorded as seen: the next run takes it
      documents.push(metadataDocument(source, { guid: it.guid, title: it.title, url: it.url, date: it.date, categories: it.categories, language: it.language, feed }));
      nowSeen.push(id);
    }
    next.feeds[key] = { seen: nowSeen.slice(-SEEN_MAX) };
  }
  return { documents, nextState: next, refused, items };
}
