/**
 * Terms of the ontology in every Space (act B, docs/ontology-akt-b-concept.md). Like the search (space-tools.ts) this is
 * injected into the page the frame receives; the Space itself is not edited. The page script marks the words that are terms
 * of the ontology (dotted underline) and shows a card with definition, owner, status and mapping. It never changes the text
 * of the page and does nothing until the host has sent a glossary AND switched it on.
 *
 * Messages (checked on both sides: the page accepts only its parent, the host only its own frame):
 *   host -> page  { type: 'ot:glossary', entries } | { type: 'ot:enable', on }
 *   page -> host  { type: 'ot:state', enabled, count } | { type: 'ot:open', key }
 * The host takes a key out of `ot:open` only when it is in its own glossary; an address or a command from the page is never used.
 *
 * What is marked is decided by the same rules as `findMentions` in `ontology-glossary.ts` (phrases of two or more words,
 * capital acronyms in exactly that spelling, never a single everyday word; at most 2 marks per term and 200 per page). The
 * script below is the same algorithm in plain ES5 style because it runs inside the page; a test compares both.
 */
import type { Glossary, GlossaryEntry } from './ontology-glossary.ts';
import { MAX_PER_PAGE, MAX_PER_TERM } from './ontology-glossary.ts';
import type { Preferences } from './preferences.ts';

const MARK = 'werkbank-space-terms';

/** The part of a glossary entry the page needs; the page never gets more than this. */
export type PageEntry = Pick<GlossaryEntry, 'key' | 'label' | 'phrases' | 'definition' | 'owner' | 'status' | 'replacedBy' | 'mappings' | 'ontology'>;

export const pageEntries = (entries: readonly GlossaryEntry[]): PageEntry[] =>
  entries.map((e) => ({ key: e.key, label: e.label, phrases: e.phrases, definition: e.definition, owner: e.owner, status: e.status, replacedBy: e.replacedBy, mappings: e.mappings, ontology: e.ontology }));

/** Plain script as a string, injected into the page and run by the tests. No back quotes and no dollar-brace inside. */
export const SPACE_TERMS_SCRIPT = String.raw`
(function () {
  var MAX_PER_TERM = ${MAX_PER_TERM}, MAX_PER_PAGE = ${MAX_PER_PAGE}, MAX_NODES = 20000;
  var SKIP = 'script,style,input,textarea,select,button,code,pre,svg,canvas,th,thead,mark,noscript,option,[data-wb-noterms],[hidden],[data-wb-hide],[contenteditable="true"],.wb-term,#wb-term-card';
  var tools = {};

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function normMap(text) {
    var out = '', at = [], pending = false;
    for (var i = 0; i < text.length; i++) {
      var piece = text[i].toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (var j = 0; j < piece.length; j++) {
        var ch = piece[j];
        if (/\s/.test(ch)) { pending = out.length > 0; continue; }
        if (pending) { out += ' '; at.push(i); pending = false; }
        out += ch; at.push(i);
      }
    }
    return { norm: out, at: at };
  }
  function escapeRe(s) { return s.replace(/[.*+?^${'$'}{}()|[\]\\]/g, '\\$&'); }
  function isAcronym(p) { return /^[A-Z]{2,6}$/.test(String(p).trim()); }

  /** Multi-word phrases and capital acronyms only; terms that share a phrase are listed under it together. */
  function buildIndex(entries) {
    var map = {}, list = [];
    for (var e = 0; e < entries.length; e++) {
      var en = entries[e], ph = en.phrases || [];
      for (var p = 0; p < ph.length; p++) {
        var acr = isAcronym(ph[p]), n = norm(ph[p]);
        if (!acr && n.indexOf(' ') < 0) continue;
        var id = (acr ? 'A:' + String(ph[p]).trim() : 'P:' + n);
        var cur = map[id];
        if (!cur) { cur = map[id] = { phrase: acr ? String(ph[p]).trim() : n, norm: n, acronym: acr, keys: [] }; list.push(cur); }
        if (cur.keys.indexOf(en.key) < 0) cur.keys.push(en.key);
      }
    }
    list.sort(function (a, b) { return (b.phrase.length - a.phrase.length) || (a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0); });
    return { phrases: list };
  }
  function newBudget() { return { perTerm: {}, total: 0 }; }
  function findMentions(text, index, budget) {
    var src = String(text == null ? '' : text);
    if (!src.trim() || !index.phrases.length) return [];
    budget = budget || newBudget();
    var nm = normMap(src), hits = [];
    for (var i = 0; i < index.phrases.length; i++) {
      var p = index.phrases[i], m, re;
      if (p.acronym) {
        re = new RegExp('(?<![A-Za-z0-9])' + escapeRe(p.phrase) + '(?![A-Za-z0-9])', 'g');
        while ((m = re.exec(src))) hits.push({ start: m.index, end: m.index + m[0].length, keys: p.keys });
      } else {
        re = new RegExp('(?<![a-z0-9])(' + escapeRe(p.norm) + '(?:e?s)?)(?![a-z0-9])', 'g');
        while ((m = re.exec(nm.norm))) {
          var a = m.index, b = a + m[1].length;
          hits.push({ start: nm.at[a] == null ? 0 : nm.at[a], end: (nm.at[b - 1] == null ? src.length - 1 : nm.at[b - 1]) + 1, keys: p.keys });
        }
      }
    }
    hits.sort(function (x, y) { return ((y.end - y.start) - (x.end - x.start)) || (x.start - y.start); });
    var taken = [];
    for (var h = 0; h < hits.length; h++) {
      var overlap = false;
      for (var t = 0; t < taken.length; t++) if (hits[h].start < taken[t].end && taken[t].start < hits[h].end) { overlap = true; break; }
      if (!overlap) taken.push(hits[h]);
    }
    taken.sort(function (x, y) { return x.start - y.start; });
    var out = [];
    for (var k = 0; k < taken.length; k++) {
      var hit = taken[k];
      if (budget.total >= MAX_PER_PAGE) break;
      var full = false;
      for (var q = 0; q < hit.keys.length; q++) if ((budget.perTerm[hit.keys[q]] || 0) >= MAX_PER_TERM) full = true;
      if (full) continue;
      for (var r = 0; r < hit.keys.length; r++) budget.perTerm[hit.keys[r]] = (budget.perTerm[hit.keys[r]] || 0) + 1;
      budget.total++;
      out.push({ start: hit.start, end: hit.end, text: src.slice(hit.start, hit.end), keys: hit.keys });
    }
    return out;
  }
  tools.norm = norm; tools.buildIndex = buildIndex; tools.findMentions = findMentions; tools.newBudget = newBudget; tools.isAcronym = isAcronym;
  window.__wbTerms = tools;
  if (window.__WB_TEST__) return;

  var byKey = {}, index = null, on = false, shownKeys = [], count = 0, lastSent = '';
  var timer = null, observer = null, lastText = null, card = null, anchor = null, pinned = false, hoverTimer = null, leaveTimer = null;

  function post(message) { if (window.parent !== window) window.parent.postMessage(message, '*'); }
  function report() {
    var msg = { type: 'ot:state', enabled: on, count: count }, json = JSON.stringify(msg);
    if (json !== lastSent) { lastSent = json; post(msg); }
  }

  function unmark() {
    closeCard(false);
    var spans = document.querySelectorAll('span.wb-term');
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i], p = s.parentNode;
      if (!p) continue;
      while (s.firstChild) p.insertBefore(s.firstChild, s);
      p.removeChild(s);
      p.normalize();
    }
    shownKeys = []; count = 0;
  }
  function textNodes() {
    var out = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n, seen = 0;
    while ((n = walker.nextNode()) && seen++ < MAX_NODES) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      var el = n.parentElement;
      if (!el || el.closest(SKIP)) continue;
      out.push(n);
    }
    return out;
  }
  function mark() {
    var budget = newBudget(), nodes = textNodes();
    for (var i = 0; i < nodes.length && budget.total < MAX_PER_PAGE; i++) {
      var node = nodes[i], text = node.nodeValue, ms = findMentions(text, index, budget);
      if (!ms.length) continue;
      var frag = document.createDocumentFragment(), pos = 0;
      for (var m = 0; m < ms.length; m++) {
        if (ms[m].start > pos) frag.appendChild(document.createTextNode(text.slice(pos, ms[m].start)));
        var span = document.createElement('span');
        span.className = 'wb-term';
        span.setAttribute('tabindex', '0');
        span.setAttribute('role', 'button');
        span.setAttribute('data-wb-i', String(shownKeys.length));
        shownKeys.push(ms[m].keys);
        span.textContent = ms[m].text;
        frag.appendChild(span);
        pos = ms[m].end;
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag, node);
      count += ms.length;
    }
  }

  function run() {
    timer = null;
    if (observer) observer.disconnect();
    unmark();
    if (on && index && index.phrases.length && document.body) mark();
    lastText = pageText();
    report();
    watch();
  }
  function schedule(ms) { if (timer) clearTimeout(timer); timer = setTimeout(run, ms); }
  /** The text of the page without the card: opening the card must not look like a change of the page. */
  function pageText() {
    var t = document.body ? document.body.textContent : '';
    return card ? t.replace(card.textContent, '') : t;
  }
  function watch() {
    if (!window.MutationObserver || !document.body) return;
    if (!observer) {
      observer = new MutationObserver(function (records) {
        var changed = false;
        for (var i = 0; i < records.length; i++) { var tg = records[i].target; if (records[i].type === 'attributes' && !(tg.closest && tg.closest('#wb-term-card'))) changed = true; }
        // Marks and card change the tree but never the text: only a changed text (or changed visibility) needs a new pass.
        if (!changed && pageText() === lastText) return;
        schedule(200);
      });
    }
    observer.takeRecords();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-selected'] });
  }

  // ---- the card (drawn inside the page; built with textContent only)
  function add(parent, tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    parent.appendChild(el);
    return el;
  }
  function statusText(e) {
    if (e.status === 'deprecated') return 'Deprecated' + (e.replacedBy ? ', replaced by ' + e.replacedBy : '');
    return 'Approved';
  }
  function buildCard(keys) {
    var el = document.createElement('div');
    el.id = 'wb-term-card';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Term definition');
    el.setAttribute('tabindex', '-1');
    var entries = [];
    for (var i = 0; i < keys.length; i++) if (byKey[keys[i]]) entries.push(byKey[keys[i]]);
    if (entries.length > 1) add(el, 'p', 'wb-t-amb', 'This name means different things in ' + entries.length + ' ontologies.');
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j], box = add(el, 'section', 'wb-t-item');
      var head = add(box, 'p', 'wb-t-head');
      add(head, 'strong', '', e.label);
      add(head, 'span', e.status === 'deprecated' ? 'wb-t-chip wb-t-chip-old' : 'wb-t-chip', statusText(e));
      add(box, 'p', 'wb-t-def', e.definition || 'No definition yet.');
      add(box, 'p', 'wb-t-meta', 'Owner: ' + (e.owner || 'Not assigned') + ' · ' + e.ontology);
      var syn = [];
      for (var s = 0; s < e.phrases.length; s++) if (norm(e.phrases[s]) !== norm(e.label)) syn.push(e.phrases[s]);
      if (syn.length) add(box, 'p', 'wb-t-meta', 'Also called: ' + syn.slice(0, 6).join(', '));
      for (var m = 0; m < e.mappings.length && m < 3; m++) add(box, 'p', 'wb-t-meta', e.mappings[m].system + ': ' + e.mappings[m].ref);
      var btn = add(box, 'button', 'wb-t-open', 'Open in the catalog');
      btn.type = 'button';
      btn.setAttribute('data-key', e.key);
    }
    return el;
  }
  function place(el, a) {
    var r = a.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 16);
    el.style.width = w + 'px';
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    el.style.left = left + 'px';
    el.style.top = (r.bottom + 6) + 'px';
    var h = el.offsetHeight;
    if (r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0) el.style.top = (r.top - 6 - h) + 'px';
  }
  function openCard(a, pin, focus) {
    var keys = shownKeys[Number(a.getAttribute('data-wb-i'))];
    if (!keys) return;
    if (card && anchor === a) { pinned = pinned || pin; return; }
    closeCard(false);
    card = buildCard(keys);
    document.body.appendChild(card);
    anchor = a; pinned = pin;
    a.setAttribute('aria-describedby', 'wb-term-card');
    place(card, a);
    if (focus) card.focus();
  }
  function closeCard(refocus) {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
    if (card && card.parentNode) card.parentNode.removeChild(card);
    var a = anchor;
    if (a) a.removeAttribute('aria-describedby');
    card = null; anchor = null; pinned = false;
    if (refocus && a && a.focus) a.focus();
  }
  function termOf(target) { return target && target.closest ? target.closest('span.wb-term') : null; }

  document.addEventListener('mouseover', function (e) {
    var a = termOf(e.target);
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
    if (a && !pinned) { if (hoverTimer) clearTimeout(hoverTimer); hoverTimer = setTimeout(function () { openCard(a, false, false); }, 150); }
  });
  document.addEventListener('mouseout', function (e) {
    var a = termOf(e.target), inCard = e.target && e.target.closest && e.target.closest('#wb-term-card');
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    if ((a || inCard) && !pinned) { if (leaveTimer) clearTimeout(leaveTimer); leaveTimer = setTimeout(function () { closeCard(false); }, 250); }
  });
  document.addEventListener('click', function (e) {
    var open = e.target && e.target.closest ? e.target.closest('.wb-t-open') : null;
    if (open) { var key = open.getAttribute('data-key'); if (key && byKey[key]) post({ type: 'ot:open', key: key }); return; }
    var a = termOf(e.target);
    if (a) { if (card && anchor === a && pinned) closeCard(false); else { closeCard(false); openCard(a, true, false); } return; }
    if (card && !(e.target.closest && e.target.closest('#wb-term-card'))) closeCard(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && card) { e.preventDefault(); closeCard(true); return; }
    var a = termOf(e.target);
    if (a && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); closeCard(false); openCard(a, true, true); }
  });

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'ot:glossary' && Array.isArray(d.entries)) {
      var list = [];
      byKey = {};
      for (var i = 0; i < d.entries.length && i < 400; i++) {
        var en = d.entries[i];
        if (!en || typeof en.key !== 'string' || typeof en.label !== 'string' || !Array.isArray(en.phrases)) continue;
        var clean = {
          key: en.key, label: en.label, phrases: en.phrases.filter(function (p) { return typeof p === 'string'; }).slice(0, 12),
          definition: typeof en.definition === 'string' ? en.definition : '', owner: typeof en.owner === 'string' ? en.owner : '',
          status: en.status === 'deprecated' ? 'deprecated' : 'approved', replacedBy: typeof en.replacedBy === 'string' ? en.replacedBy : '',
          mappings: Array.isArray(en.mappings) ? en.mappings.filter(function (m) { return m && typeof m.system === 'string' && typeof m.ref === 'string'; }) : [],
          ontology: typeof en.ontology === 'string' ? en.ontology : '',
        };
        byKey[clean.key] = clean; list.push(clean);
      }
      index = buildIndex(list);
      lastSent = '';
      schedule(0);
    } else if (d.type === 'ot:enable') {
      on = d.on === true;
      lastSent = '';
      schedule(0);
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', report); else report();
})();
`;

const STYLE = [
  '.wb-term{border-bottom:1px dotted var(--accent, var(--purple, LinkText));cursor:help}',
  '.wb-term:focus-visible{outline:2px solid var(--accent, var(--purple, Highlight));outline-offset:2px;border-radius:2px}',
  '#wb-term-card{position:fixed;z-index:2147483000;box-sizing:border-box;max-height:70vh;overflow:auto;padding:10px 12px;border:1px solid var(--line, GrayText);border-radius:8px;background:var(--surface, Canvas);color:var(--ink, CanvasText);font:13px/1.45 system-ui,sans-serif;box-shadow:0 4px 18px color-mix(in srgb, CanvasText 25%, transparent);text-align:left}',
  '#wb-term-card p{margin:0}',
  '#wb-term-card .wb-t-item+.wb-t-item{margin-top:10px;padding-top:10px;border-top:1px solid var(--line, GrayText)}',
  '#wb-term-card .wb-t-amb{margin-bottom:8px;font-weight:600}',
  '#wb-term-card .wb-t-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
  '#wb-term-card .wb-t-chip{padding:0 6px;border:1px solid var(--line, GrayText);border-radius:999px;font-size:11px}',
  '#wb-term-card .wb-t-chip-old{font-style:italic}',
  '#wb-term-card .wb-t-def{margin-top:4px}',
  '#wb-term-card .wb-t-meta{margin-top:3px;color:var(--muted, GrayText);font-size:12px}',
  '#wb-term-card .wb-t-open{margin-top:8px;padding:3px 8px;border:1px solid var(--line, GrayText);border-radius:6px;background:var(--surface, Canvas);color:var(--ink, CanvasText);font:inherit;font-size:12px;cursor:pointer}',
  '#wb-term-card .wb-t-open:focus-visible{outline:2px solid var(--accent, var(--purple, Highlight));outline-offset:2px}',
].join('');
export const SPACE_TERMS_STYLE = STYLE;

/** Adds the terms script and styles once, just before </body> (or at the end of the page). */
export function applySpaceTerms(html: string): string {
  if (html.includes(`id="${MARK}"`)) return html;
  const block = `<style id="${MARK}-style">${STYLE}</style><script id="${MARK}">${SPACE_TERMS_SCRIPT}</script>`;
  const close = html.search(/<\/body\s*>/i);
  return close >= 0 ? html.slice(0, close) + block + html.slice(close) : html + block;
}

// ---------------------------------------------------------------- opt-in (per Space or per domain)

/** What the Space header needs to show and steer the terms. */
export type SpaceTermsControl = {
  /** Switched on for this Space (itself or through its domain). */
  on: boolean;
  domain: string;
  domainOn: boolean;
  /** `unavailable`: the real catalog could not be read; the app then shows no terms instead of guessing. */
  state: 'loading' | 'ready' | 'unavailable';
  reason: string;
  glossary: Glossary | null;
  onToggle: (on: boolean) => void;
  onToggleDomain: (on: boolean) => void;
  /** A term was asked for in the catalog; the key comes from the glossary of the host. */
  onOpen: (key: string) => void;
};

type TermsPrefs = Pick<Preferences, 'termSpaces' | 'termDomains'>;
/** The terms are on for a Space when the Space itself or its whole domain was switched on. Default: off. */
export const termsOn = (prefs: TermsPrefs, slug: string, domain: string): boolean => prefs.termSpaces.includes(slug) || prefs.termDomains.includes(domain);

export function setTermsForSpace<T extends TermsPrefs>(prefs: T, slug: string, domain: string, on: boolean): T {
  const termSpaces = on ? [...new Set([...prefs.termSpaces, slug])].slice(-200) : prefs.termSpaces.filter((s) => s !== slug);
  // Switching a Space off while its whole domain is on turns the domain choice off too; otherwise the switch would do nothing.
  const termDomains = !on ? prefs.termDomains.filter((d) => d !== domain) : prefs.termDomains;
  return { ...prefs, termSpaces, termDomains };
}

export function setTermsForDomain<T extends TermsPrefs>(prefs: T, domain: string, on: boolean): T {
  const termDomains = on ? [...new Set([...prefs.termDomains, domain])].slice(-50) : prefs.termDomains.filter((d) => d !== domain);
  return { ...prefs, termDomains };
}

/** What the host accepts from `ot:open`: only a key of its own glossary, nothing the page invents. */
export function parseOpenTermMessage(data: unknown, known: ReadonlySet<string>): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as { type?: unknown; key?: unknown };
  return m.type === 'ot:open' && typeof m.key === 'string' && known.has(m.key) ? m.key : null;
}
