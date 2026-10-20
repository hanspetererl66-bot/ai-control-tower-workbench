/**
 * Search and filter for every Space. Spaces are separate sandboxed pages (some written by the agent), so the host
 * cannot reach into them. Like the text size and the theme, this is injected into the page the frame receives, which
 * covers all Spaces without editing any of them. The page script does the work; the host only shows the controls.
 *
 * Messages (checked on both sides: the page accepts only its parent, the host only its own frame):
 *   host -> page  { type: 'sp:search', query } | { type: 'sp:filter', filters: { [column label]: value } } | { type: 'sp:clear' }
 *   page -> host  { type: 'sp:state', searchable, count | null, filters: [{ label, values }] }
 *
 * What it works on: table rows, list items and cards without nested cards. Filters are derived from table columns that
 * hold a few repeating, non-numeric values (status, priority, severity, product, ...). Pages drawn on a canvas
 * (Knowledge Graph) have nothing to search and report `searchable: false`.
 */

export type SpaceFilterOption = { label: string; values: string[] };
export type SpaceToolsState = { searchable: boolean; count: number | null; filters: SpaceFilterOption[] };

const MARK = 'werkbank-space-tools';

/** Plain ES5-style script, kept as a string so it can be injected and also run by the tests. */
export const SPACE_TOOLS_SCRIPT = String.raw`
(function () {
  var HIDE = 'data-wb-hide';
  var tools = {};

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function tokens(query) { return norm(query).split(' ').filter(Boolean); }
  function matches(text, query) {
    var t = tokens(query);
    if (!t.length) return true;
    var hay = norm(text);
    for (var i = 0; i < t.length; i++) if (hay.indexOf(t[i]) < 0) return false;
    return true;
  }
  /** headers: string[]; rows: string[][]. Columns with 2-8 short, non-numeric values of which at least one repeats become filters. */
  function columns(headers, rows) {
    var out = [];
    if (rows.length < 3) return out;
    for (var c = 0; c < headers.length; c++) {
      var label = String(headers[c] || '').trim();
      if (!label) continue;
      var seen = {}, order = [], numeric = true, ok = true, filled = 0;
      for (var r = 0; r < rows.length; r++) {
        var v = String(rows[r][c] == null ? '' : rows[r][c]).trim();
        if (!v) continue;
        filled++;
        if (v.length > 28) { ok = false; break; }
        if (!/^[\d.,%\s€$+\-\/:]+$/.test(v)) numeric = false;
        if (!seen[v]) { seen[v] = 1; order.push(v); if (order.length > 8) { ok = false; break; } }
      }
      if (ok && !numeric && order.length >= 2 && order.length < filled) out.push({ index: c, label: label, values: order.sort() });
    }
    return out;
  }
  tools.norm = norm; tools.matches = matches; tools.columns = columns;
  window.__wbTools = tools;
  if (window.__WB_TEST__) return;

  var state = { query: '', filters: {} };
  var lastSent = '';
  var timer = null;
  var observer = null;

  function cellsOf(row) { return Array.prototype.map.call(row.children, function (c) { return c.textContent || ''; }); }
  function tableInfo(table) {
    var headCells = table.querySelectorAll('thead th');
    var headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    var headers = headCells.length ? Array.prototype.map.call(headCells, function (h) { return h.textContent || ''; }) : headerRow ? cellsOf(headerRow) : [];
    var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
    if (!rows.length) rows = Array.prototype.slice.call(table.querySelectorAll('tr')).slice(1);
    return { headers: headers.map(function (h) { return h.trim(); }), rows: rows };
  }
  function shown(el) { return el.getClientRects().length > 0; }

  function clearMarks() {
    var marks = document.querySelectorAll('mark.wb-hit');
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], p = m.parentNode;
      if (!p) continue;
      p.replaceChild(document.createTextNode(m.textContent || ''), m);
      p.normalize();
    }
  }
  function highlight(el, toks, budget) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) {
      var tag = n.parentNode && n.parentNode.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') continue;
      nodes.push(n);
    }
    for (var i = 0; i < nodes.length && budget.left > 0; i++) {
      var node = nodes[i], text = node.nodeValue || '', low = text.toLowerCase(), best = -1, len = 0;
      for (var t = 0; t < toks.length; t++) {
        var at = low.indexOf(toks[t]);
        if (at >= 0 && (best < 0 || at < best)) { best = at; len = toks[t].length; }
      }
      if (best < 0) continue;
      var hit = node.splitText(best);
      hit.splitText(len);
      var mark = document.createElement('mark');
      mark.className = 'wb-hit';
      hit.parentNode.replaceChild(mark, hit);
      mark.appendChild(hit);
      budget.left--;
    }
  }

  function run() {
    timer = null;
    if (observer) observer.disconnect();
    var active = state.query.trim().length > 0;
    var toks = tokens(state.query);
    var rawToks = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    clearMarks();
    var hidden = document.querySelectorAll('[' + HIDE + ']');
    for (var h = 0; h < hidden.length; h++) hidden[h].removeAttribute(HIDE);

    // Candidates: table rows, list items, cards, headings and repeated sibling blocks (message lists, tiles, steps).
    // Only the innermost ones are searched, so a panel stays visible while its items are narrowed down.
    var cand = [];
    var filterMap = {};
    var tables = document.querySelectorAll('table');
    for (var t = 0; t < tables.length; t++) {
      var info = tableInfo(tables[t]);
      var cols = columns(info.headers, info.rows.map(cellsOf));
      var visibleTable = shown(tables[t]);
      var byLabel = {};
      for (var c = 0; c < cols.length; c++) {
        byLabel[cols[c].label] = cols[c].index;
        if (visibleTable) {
          var slot = filterMap[cols[c].label] || (filterMap[cols[c].label] = {});
          for (var v = 0; v < cols[c].values.length; v++) slot[cols[c].values[v]] = 1;
        }
      }
      for (var r = 0; r < info.rows.length; r++) {
        var row = info.rows[r], cells = cellsOf(row), ok = true;
        for (var label in state.filters) {
          if (Object.prototype.hasOwnProperty.call(byLabel, label) && (cells[byLabel[label]] || '').trim() !== state.filters[label]) ok = false;
        }
        cand.push({ el: row, text: cells.join(' '), filterOk: ok });
      }
    }
    var EXCLUDED = 'nav, header, thead, button, form, select, [role="tablist"], [role="tab"], .tabs, .tab, .tablist, .tb, .filters, .filter, .nav, .toolbar, .legend, .seg, .segmented';
    var seenEls = [];
    function add(el) {
      if (seenEls.indexOf(el) >= 0 || el.closest(EXCLUDED) || el.querySelector('canvas')) return;
      var text = el.textContent || '';
      if (!text.trim() || text.length > 6000) return;
      seenEls.push(el);
      cand.push({ el: el, text: text, filterOk: true });
    }
    cand.forEach(function (c0) { seenEls.push(c0.el); });
    var lis = document.querySelectorAll('li');
    for (var i = 0; i < lis.length; i++) add(lis[i]);
    var cardEls = document.querySelectorAll('.card');
    for (var k = 0; k < cardEls.length; k++) add(cardEls[k]);
    var heads = document.querySelectorAll('h2, h3, h4');
    for (var hh = 0; hh < heads.length; hh++) add(heads[hh]);
    var blocks = document.querySelectorAll('div[class], article[class], section[class], dl[class]');
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b], par = blk.parentNode;
      if (!par || !blk.classList.length) continue;
      var same = 0, kind = blk.classList[0];
      for (var sib = par.firstElementChild; sib; sib = sib.nextElementSibling) if (sib.classList.length && sib.classList[0] === kind) same++;
      if (same >= 3) add(blk);
    }
    var outer = [];
    cand.forEach(function (c1) { for (var a = c1.el.parentElement; a; a = a.parentElement) outer.push(a); });
    var targets = cand.filter(function (c2) { return outer.indexOf(c2.el) < 0; });

    var count = 0, budget = { left: 300 };
    for (var x = 0; x < targets.length; x++) {
      var item = targets[x];
      var wasShown = shown(item.el);
      var hit = !active || matches(item.text, state.query);
      if (!(hit && item.filterOk)) { item.el.setAttribute(HIDE, '1'); continue; }
      if (active && wasShown) { count++; highlight(item.el, rawToks.length ? rawToks : toks, budget); }
    }

    var filters = Object.keys(filterMap).slice(0, 6).map(function (label) { return { label: label, values: Object.keys(filterMap[label]).sort().slice(0, 12) }; });
    var message = { type: 'sp:state', searchable: targets.length > 0, count: active ? count : null, filters: filters };
    var json = JSON.stringify(message);
    if (json !== lastSent && window.parent !== window) { lastSent = json; window.parent.postMessage(message, '*'); }
    watch();
  }
  function schedule(ms) { if (timer) clearTimeout(timer); timer = setTimeout(run, ms); }
  function watch() {
    if (!window.MutationObserver || !document.body) return;
    if (!observer) observer = new MutationObserver(function () { schedule(150); });
    observer.takeRecords();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-selected'] });
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'sp:search') {
      state.query = typeof d.query === 'string' ? d.query.slice(0, 100) : '';
      lastSent = '';
      schedule(0);
    } else if (d.type === 'sp:filter' && d.filters && typeof d.filters === 'object') {
      var next = {};
      Object.keys(d.filters).slice(0, 8).forEach(function (key) { if (typeof d.filters[key] === 'string' && d.filters[key]) next[key] = d.filters[key].slice(0, 40); });
      state.filters = next;
      lastSent = '';
      schedule(0);
    } else if (d.type === 'sp:clear') {
      state = { query: '', filters: {} };
      lastSent = '';
      schedule(0);
    }
  });
  schedule(60);
})();
`;

const STYLE = '[data-wb-hide]{display:none!important}mark.wb-hit{background:#fde68a;color:#1c1c1e;border-radius:2px;padding:0 1px}';

/** Adds the search/filter script and styles once, just before </body> (or at the end of the page). */
export function applySpaceTools(html: string): string {
  if (html.includes(`id="${MARK}"`)) return html;
  const block = `<style id="${MARK}-style">${STYLE}</style><script id="${MARK}">${SPACE_TOOLS_SCRIPT}</script>`;
  const close = html.search(/<\/body\s*>/i);
  return close >= 0 ? html.slice(0, close) + block + html.slice(close) : html + block;
}
