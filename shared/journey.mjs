/**
 * The Sales journey: one customer, one flow through four Spaces (Sales, Customer 360, E-mail, Renewals).
 *   Today -> Understand -> Decide -> Act -> Follow up
 * Each Space shows the same rail at the top. A click inside the same Space switches its own tab or view; a click on a stop in another
 * Space asks the app (the existing hand-over `wb:handoff`, see src/space-handoff.ts) to open that Space with the context:
 * { journey: { customer, step, tab?, deal?, thread?, focus? } }. The app never runs anything from it; the receiving Space checks the shape
 * again with parse() before it uses a value.
 *
 * Spaces cannot import, so the pages carry a copy of makeJourney between `// @journey-start` and `// @journey-end`
 * (npm run sync:mockups writes it, a test fails when a page is out of date). Plain data, ES5, no network, no storage.
 */
export function makeJourney() {
  var CUSTOMERS = {
    lindenau: { name: 'Lindenau Pharma AG', sales: true, c360: 'lindenau', mail: 'lindenau', renewals: true },
    muster: { name: 'Muster Industrie AG', sales: true, c360: null, mail: 'muster', renewals: true },
    hanse: { name: 'Hanse Handelsgruppe AG', sales: true, c360: null, mail: null, renewals: true },
    nordlicht: { name: 'Nordlicht Gruppe', sales: false, c360: 'nordlicht', mail: null, renewals: false },
  };
  var STEPS = [
    { id: 'today', label: 'Today', ask: 'What needs me now?' },
    { id: 'understand', label: 'Understand', ask: 'Who is the customer, what was said?' },
    { id: 'decide', label: 'Decide', ask: 'What do we do first?' },
    { id: 'act', label: 'Act', ask: 'Prepare it, get it approved' },
    { id: 'follow', label: 'Follow up', ask: 'Did it work?' },
  ];
  var STOPS = [
    { id: 'inbox', step: 'today', label: 'Inbox', space: 'sales', tab: 'inbox' },
    { id: 'meetings', step: 'today', label: 'Meetings', space: 'sales', tab: 'meetings' },
    { id: 'renewals', step: 'today', label: 'Renewals due', space: 'renewals', tab: 'overview', needs: 'renewals' },
    { id: 'c360', step: 'understand', label: 'Customer 360', space: 'customer-360', needs: 'c360' },
    { id: 'mails', step: 'understand', label: 'E-mails', space: 'customer-emails', needs: 'mail' },
    { id: 'graph', step: 'understand', label: 'Deal graph', space: 'sales', tab: 'knowledge' },
    { id: 'renewal-map', step: 'understand', label: 'Renewal map', space: 'renewals', tab: 'process', needs: 'renewals' },
    { id: 'pipeline', step: 'decide', label: 'Pipeline', space: 'sales', tab: 'pipeline' },
    { id: 'forecast', step: 'decide', label: 'Forecast', space: 'sales', tab: 'forecast' },
    { id: 'renewal-actions', step: 'decide', label: 'Renewal actions', space: 'renewals', tab: 'nba', needs: 'renewals' },
    { id: 'workflow', step: 'act', label: 'Skills', space: 'sales', tab: 'workflow' },
    { id: 'governance', step: 'act', label: 'Approvals', space: 'sales', tab: 'governance' },
    { id: 'payments', step: 'follow', label: 'Late payments', space: 'sales', tab: 'payments' },
  ];
  /** Which step a Sales tab belongs to (for the highlighted step of the rail). */
  var TAB_STEP = { inbox: 'today', meetings: 'today', knowledge: 'understand', pipeline: 'decide', forecast: 'decide', workflow: 'act', governance: 'act', rules: 'act', payments: 'follow' };
  var TAB = /^[a-z]{1,20}$/, DEAL = /^[A-Za-z0-9-]{1,30}$/, THREAD = /^T-[0-9]{1,4}$/, FOCUS = /^(group|entity|contact|contract|product|opportunity|order|invoice|pay|ticket|signal|rec):[A-Za-z0-9._-]{1,40}$/;

  function stop(id) { for (var i = 0; i < STOPS.length; i++) if (STOPS[i].id === id) return STOPS[i]; return null; }
  function customerOfAccount(name) { for (var k in CUSTOMERS) if (CUSTOMERS[k].name === name) return k; return null; }
  /** A stop is open for a customer when the Space has sample data for him. */
  function available(s, customer) {
    var c = CUSTOMERS[customer];
    if (!c || !s) return false;
    if (s.space === 'sales') return c.sales;
    return !!c[s.needs];
  }
  /** The hand-over for a stop in another Space. ctx: { customer, deal?, thread?, focus? }. */
  function handoff(s, ctx) {
    var j = { customer: ctx.customer, step: s.step };
    if (s.tab) j.tab = s.tab;
    if (ctx.deal && DEAL.test(ctx.deal)) j.deal = ctx.deal;
    if (ctx.thread && THREAD.test(ctx.thread)) j.thread = ctx.thread;
    if (ctx.focus && FOCUS.test(ctx.focus)) j.focus = ctx.focus;
    return { type: 'wb:handoff', to: s.space, payload: { journey: j }, open: true, notice: 'Journey: ' + s.label + ' for ' + CUSTOMERS[ctx.customer].name };
  }
  /** Reads a journey from a hand-over payload: only known values pass, everything else is dropped. */
  function parse(payload) {
    var raw = payload && typeof payload === 'object' ? payload.journey : null;
    if (!raw || typeof raw !== 'object' || typeof raw.customer !== 'string' || !CUSTOMERS[raw.customer]) return null;
    var out = { customer: raw.customer, step: 'today' };
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === raw.step) out.step = raw.step;
    if (typeof raw.tab === 'string' && TAB.test(raw.tab)) out.tab = raw.tab;
    if (typeof raw.deal === 'string' && DEAL.test(raw.deal)) out.deal = raw.deal;
    if (typeof raw.thread === 'string' && THREAD.test(raw.thread)) out.thread = raw.thread;
    if (typeof raw.focus === 'string' && FOCUS.test(raw.focus)) out.focus = raw.focus;
    return out;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var CSS = '.jr{display:flex;flex-wrap:wrap;align-items:stretch;gap:8px 14px;padding:10px 16px;margin:0;background:var(--surface);border-bottom:1px solid var(--line);font-size:12px;color:var(--ink-2)}' +
    '.jr-who{display:flex;flex-direction:column;justify-content:center;min-width:130px}.jr-who b{font-size:13px;color:var(--ink)}.jr-who span{color:var(--muted)}' +
    '.jr ol{display:flex;flex:1 1 420px;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0}' +
    '.jr li{flex:1 1 130px;min-width:120px;border:1px solid var(--line);border-radius:12px;padding:6px 9px;background:var(--canvas)}' +
    '.jr li[aria-current="step"]{border-color:var(--purple);background:var(--purple-dim)}' +
    '.jr .jr-h{display:flex;gap:6px;align-items:baseline;font-weight:600;color:var(--ink)}.jr .jr-n{color:var(--purple);font-variant-numeric:tabular-nums}' +
    '.jr .jr-a{color:var(--muted);margin:1px 0 4px;font-size:11px}' +
    '.jr .jr-s{display:flex;flex-wrap:wrap;gap:4px}' +
    '.jr button{font:inherit;font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);cursor:pointer}' +
    '.jr button:hover:not(:disabled){border-color:var(--purple);color:var(--ink)}.jr button[aria-current="true"]{background:var(--purple);border-color:var(--purple);color:var(--surface)}' +
    '.jr button:disabled{opacity:.45;cursor:not-allowed}' +
    '.jr-val{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:6px 16px;border-bottom:1px solid var(--line);background:var(--canvas);font-size:12px;color:var(--muted)}' +
    '.jr-val b{color:var(--ink);font-variant-numeric:tabular-nums}.jr-val .jr-note{margin-left:auto}' +
    '@media (max-width:640px){.jr li{flex-basis:100%}}';
  function injectStyle(doc) {
    if (doc.getElementById('journey-style')) return;
    var st = doc.createElement('style'); st.id = 'journey-style'; st.textContent = CSS; doc.head.appendChild(st);
  }
  /**
   * The rail as HTML. cur: { space, step, stop?, customer }, values: [[label, value], ...] for the strip, note: optional text at the right.
   * The stop that is shown on this page gets aria-current="true"; a stop the customer has no sample data for is disabled.
   */
  function railHtml(cur, values, note) {
    var c = CUSTOMERS[cur.customer] || CUSTOMERS.lindenau;
    var steps = STEPS.map(function (st, i) {
      var stops = STOPS.filter(function (s) { return s.step === st.id; }).map(function (s) {
        var ok = available(s, cur.customer), here = cur.stop === s.id;
        return '<button type="button" data-jr-stop="' + esc(s.id) + '"' + (ok ? '' : ' disabled title="No sample data for ' + esc(c.name) + '"') + ' aria-current="' + here + '">' + esc(s.label) + '</button>';
      }).join('');
      return '<li' + (cur.step === st.id ? ' aria-current="step"' : '') + '><div class="jr-h"><span class="jr-n">' + (i + 1) + '</span>' + esc(st.label) + '</div><div class="jr-a">' + esc(st.ask) + '</div><div class="jr-s">' + stops + '</div></li>';
    }).join('');
    var strip = values && values.length ? '<div class="jr-val">' + values.map(function (v) { return '<span>' + esc(v[0]) + ' <b>' + esc(v[1]) + '</b></span>'; }).join('') + (note ? '<span class="jr-note">' + esc(note) + '</span>' : '') + '</div>' : '';
    return '<nav class="jr" aria-label="Sales journey"><div class="jr-who"><b>' + esc(c.name) + '</b><span>Sales journey</span></div><ol>' + steps + '</ol></nav>' + strip;
  }
  return { CUSTOMERS: CUSTOMERS, STEPS: STEPS, STOPS: STOPS, TAB_STEP: TAB_STEP, stop: stop, available: available, handoff: handoff, parse: parse, customerOfAccount: customerOfAccount, railHtml: railHtml, injectStyle: injectStyle };
}
