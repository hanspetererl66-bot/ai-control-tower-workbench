/**
 * The Sales journey: one customer, one flow through Spaces that show the rail (Sales, Customer 360, E-mail) and Spaces that only receive a stop
 * (Collections: it carries this code to read the hand-over with parse() but does not draw the rail).
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
    lindenau: { name: 'Lindenau Pharma AG', sales: true, c360: 'lindenau', mail: 'lindenau', renewals: true, collections: true },
    muster: { name: 'Muster Industrie AG', sales: true, c360: null, mail: 'muster', renewals: true, collections: true },
    hanse: { name: 'Hanse Handelsgruppe AG', sales: true, c360: null, mail: null, renewals: true, collections: true },
    nordlicht: { name: 'Nordlicht Gruppe', sales: false, c360: 'nordlicht', mail: null, renewals: false, collections: false },
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
    { id: 'c360', step: 'understand', label: 'Customer 360', space: 'customer-360', needs: 'c360' },
    { id: 'mails', step: 'understand', label: 'E-mails', space: 'customer-emails', needs: 'mail' },
    { id: 'graph', step: 'understand', label: 'Deal graph', space: 'sales', tab: 'knowledge' },
    { id: 'pipeline', step: 'decide', label: 'Pipeline', space: 'sales', tab: 'pipeline' },
    { id: 'forecast', step: 'decide', label: 'Forecast', space: 'sales', tab: 'forecast' },
    { id: 'workflow', step: 'act', label: 'Skills', space: 'sales', tab: 'workflow' },
    { id: 'governance', step: 'act', label: 'Approvals', space: 'sales', tab: 'governance' },
    { id: 'payments', step: 'follow', label: 'Late payments', space: 'sales', tab: 'payments' },
    { id: 'collections', step: 'follow', label: 'Collections', space: 'collections', tab: 'list', needs: 'collections' },
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

  // The rail is big on purpose: five cards on one path. A dot per step (done = filled with a tick, now = large and pulsing, later = outline),
  // a line that draws itself from step to step when the page opens (and from the old to the new step when the step changes), cards that
  // rise one after the other, a lift on hover. "Reduce motion" turns all of it off; the resting state is the finished picture.
  var CSS = '.jr{--g:14px;display:block;margin:0;padding:18px 22px 22px;background:var(--surface);border-bottom:1px solid var(--line);font-size:13px;color:var(--ink-2)}' +
    '.jr-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;margin:0 0 18px}' +
    '.jr-who{display:flex;flex-direction:column;min-width:0}.jr-who b{font-size:21px;font-weight:750;letter-spacing:-.02em;line-height:1.15;color:var(--purple)}.jr-who span{color:var(--muted);font-size:12.5px;margin-top:2px}' +
    '.jr-val{display:flex;gap:8px;flex-wrap:wrap}.jr-val span{padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--canvas);font-size:12.5px;color:var(--muted)}.jr-val b{color:var(--ink);font-variant-numeric:tabular-nums}' +
    '.jr-note{margin-left:auto;color:var(--muted);font-size:12px;max-width:46ch;text-align:right}' +
    '.jr ol{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:var(--g);list-style:none;margin:0;padding:0}' +
    '.jr li{position:relative;display:flex;flex-direction:column;align-items:stretch}' +
    '.jr-dot{position:relative;z-index:1;align-self:center;flex:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;margin-bottom:12px;border:3px solid var(--line);background:var(--surface);color:var(--muted);font-size:17px;font-weight:750;font-variant-numeric:tabular-nums}' +
    '.jr li.done .jr-dot,.jr li.cur .jr-dot{background:var(--purple);border-color:var(--purple);color:var(--surface)}' +
    '.jr li.cur .jr-dot{transform:scale(1.18);box-shadow:0 0 0 6px var(--purple-dim);animation:jr-pulse 2.4s ease-in-out 1.2s infinite}' +
    '.jr li:not(:first-child)::before{content:"";position:absolute;top:20px;left:calc(-1 * (var(--g) + 50%));width:calc(100% + var(--g));height:4px;border-radius:2px;background:var(--line);transform-origin:left center}' +
    '.jr li.done::before,.jr li.cur::before{background:var(--purple)}' +
    '.jr-card{flex:1;display:flex;flex-direction:column;gap:7px;border:1px solid var(--line);border-radius:16px;padding:14px 16px;background:var(--canvas);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,background-color .18s ease}' +
    '.jr li.done .jr-card{border-color:var(--purple-border)}' +
    '.jr li.cur .jr-card{border:2px solid var(--purple);background:var(--purple-dim);padding:13px 15px;box-shadow:0 10px 24px color-mix(in srgb,var(--purple) 20%,transparent)}' +
    '.jr li:hover .jr-card{transform:translateY(-3px);box-shadow:var(--shadow)}.jr li.cur:hover .jr-card{box-shadow:0 14px 30px color-mix(in srgb,var(--purple) 26%,transparent)}' +
    '.jr .jr-h{font-size:18px;font-weight:750;letter-spacing:-.015em;line-height:1.2;color:var(--ink)}' +
    '.jr .jr-a{color:var(--muted);font-size:13px;line-height:1.35}' +
    '.jr-m{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.jr-m b{font-size:24px;font-weight:750;letter-spacing:-.02em;line-height:1.1;color:var(--purple);font-variant-numeric:tabular-nums}.jr-m span{font-size:12px;color:var(--muted)}' +
    '.jr .jr-s{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:4px}' +
    '.jr button{font:inherit;font-size:13px;font-weight:550;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);cursor:pointer;transition:transform .12s ease,border-color .12s ease,background-color .12s ease,color .12s ease}' +
    '.jr button:hover:not(:disabled){border-color:var(--purple);color:var(--ink);transform:translateY(-1px)}.jr button[aria-current="true"]{background:var(--purple);border-color:var(--purple);color:var(--surface)}' +
    '.jr button:disabled{opacity:.45;cursor:not-allowed}' +
    '@keyframes jr-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}' +
    '@keyframes jr-pop{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:none}}' +
    '@keyframes jr-popc{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:scale(1.18)}}' +
    '@keyframes jr-draw{from{transform:scaleX(0)}to{transform:none}}' +
    '@keyframes jr-drawy{from{transform:scaleY(0)}to{transform:none}}' +
    '@keyframes jr-pulse{0%,100%{box-shadow:0 0 0 6px var(--purple-dim)}50%{box-shadow:0 0 0 13px color-mix(in srgb,var(--purple) 7%,transparent)}}' +
    '.jr-in .jr-card{animation:jr-rise .6s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--k) * 90ms + .15s)}' +
    '.jr-in .jr-dot{animation:jr-pop .5s cubic-bezier(.2,.9,.3,1.3) both;animation-delay:calc(var(--k) * 140ms)}' +
    '.jr-in li.cur .jr-dot{animation:jr-popc .5s cubic-bezier(.2,.9,.3,1.3) calc(var(--k) * 140ms) both,jr-pulse 2.4s ease-in-out 1.6s infinite}' +
    '.jr-in li::before{animation:jr-draw .5s ease both;animation-delay:calc(var(--k) * 140ms - 60ms)}' +
    '.jr-move li.cur .jr-dot{animation:jr-popc .55s cubic-bezier(.2,.9,.3,1.3) .1s both,jr-pulse 2.4s ease-in-out 1s infinite}' +
    '.jr-move li.go::before{animation:jr-draw .45s ease both;animation-delay:calc((var(--k) - var(--jr-from)) * 150ms - 100ms)}' +
    '@media (max-width:760px){.jr{--gm:12px;padding:14px 14px 18px}.jr ol{grid-template-columns:1fr;gap:var(--gm)}.jr li{flex-direction:row;gap:14px;align-items:flex-start}.jr-dot{margin:0;align-self:flex-start}' +
    '.jr li:not(:first-child)::before{display:none}.jr li:not(:last-child)::after{content:"";position:absolute;left:20px;top:44px;bottom:calc(-1 * var(--gm));width:4px;border-radius:2px;background:var(--line);transform-origin:top center}' +
    '.jr li.done:not(:last-child)::after{background:var(--purple)}.jr-in li:not(:last-child)::after{animation:jr-drawy .5s ease both;animation-delay:calc(var(--k) * 140ms)}.jr-note{margin-left:0;text-align:left}}' +
    '@media (prefers-reduced-motion:reduce){.jr *,.jr *::before,.jr *::after{animation:none!important;transition:none!important}}';
  function injectStyle(doc) {
    if (doc.getElementById('journey-style')) return;
    var st = doc.createElement('style'); st.id = 'journey-style'; st.textContent = CSS; doc.head.appendChild(st);
  }
  /** The figures the pages pass in (a label and a value) belong to a step: they are shown big under that step. Others stay in the strip on top. */
  var VALUE_STEP = [[/^Money in play/, 'decide'], [/^Due within/, 'today'], [/^Waiting for our answer/, 'today'], [/^Past the/, 'today'], [/^Deals with a risk/, 'understand'], [/^Open points/, 'understand'], [/^Waiting for your decision/, 'act']];
  function stepOfValue(label) { for (var i = 0; i < VALUE_STEP.length; i++) if (VALUE_STEP[i][0].test(label)) return VALUE_STEP[i][1]; return null; }
  /** Where the rail was drawn last (null = never): the first drawing plays the entrance, a later one with another step glides from the old step. */
  var drawn = { idx: null };
  /**
   * The rail as HTML. cur: { space, step, stop?, customer }, values: [[label, value], ...], note: optional text at the right.
   * The stop that is shown on this page gets aria-current="true"; a stop the customer has no sample data for is disabled.
   */
  function railHtml(cur, values, note) {
    var c = CUSTOMERS[cur.customer] || CUSTOMERS.lindenau;
    var idx = 0;
    for (var q = 0; q < STEPS.length; q++) if (STEPS[q].id === cur.step) idx = q;
    var mode = drawn.idx === null ? 'in' : drawn.idx !== idx ? 'move' : 'still', from = drawn.idx === null ? 0 : drawn.idx;
    drawn.idx = idx;
    var byStep = {}, rest = [];
    (values || []).forEach(function (v) { var st = stepOfValue(String(v[0])); if (st) (byStep[st] = byStep[st] || []).push(v); else rest.push(v); });
    var steps = STEPS.map(function (st, i) {
      var stops = STOPS.filter(function (s) { return s.step === st.id; }).map(function (s) {
        var ok = available(s, cur.customer), here = cur.stop === s.id;
        return '<button type="button" data-jr-stop="' + esc(s.id) + '"' + (ok ? '' : ' disabled title="No sample data for ' + esc(c.name) + '"') + ' aria-current="' + here + '">' + esc(s.label) + '</button>';
      }).join('');
      var metrics = (byStep[st.id] || []).slice(0, 2).map(function (v) { return '<div class="jr-m"><b>' + esc(v[1]) + '</b><span>' + esc(v[0]) + '</span></div>'; }).join('');
      var state = i < idx ? 'done' : i === idx ? 'cur' : 'todo', go = mode === 'move' && idx > from && i > from && i <= idx ? ' go' : '';
      return '<li class="' + state + go + '" style="--k:' + i + '"' + (i === idx ? ' aria-current="step"' : '') + '><div class="jr-dot" aria-hidden="true">' + (i < idx ? '&#10003;' : i + 1) + '</div><div class="jr-card"><div class="jr-h">' + esc(st.label) + '</div><div class="jr-a">' + esc(st.ask) + '</div>' + metrics + '<div class="jr-s">' + stops + '</div></div></li>';
    }).join('');
    var strip = rest.length ? '<div class="jr-val">' + rest.map(function (v) { return '<span>' + esc(v[0]) + ' <b>' + esc(v[1]) + '</b></span>'; }).join('') + '</div>' : '';
    return '<nav class="jr jr-' + mode + '" style="--jr-from:' + from + '" aria-label="Sales journey"><div class="jr-top"><div class="jr-who"><b>' + esc(c.name) + '</b><span>Sales journey · step ' + (idx + 1) + ' of ' + STEPS.length + ': ' + esc(STEPS[idx].label) + '</span></div>' + strip + (note ? '<span class="jr-note">' + esc(note) + '</span>' : '') + '</div><ol>' + steps + '</ol></nav>';
  }
  return { CUSTOMERS: CUSTOMERS, STEPS: STEPS, STOPS: STOPS, TAB_STEP: TAB_STEP, stop: stop, available: available, handoff: handoff, parse: parse, customerOfAccount: customerOfAccount, railHtml: railHtml, injectStyle: injectStyle };
}
