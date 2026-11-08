/**
 * The Customer 360 logic: one customer group (Nordlicht, fictional) as a graph of companies, people, contracts, deals, orders, invoices,
 * tickets and free-text signals; the key figures per company; the documents a knowledge engine (Cognee) reads; a small local retrieval
 * over the same documents; and the story the Space tells (four acts, ten beats, each beat is one retrieval).
 *
 * One source for three users: the Space page (embedded by `npm run sync:mockups`, the page cannot import), the Cognee corpus script
 * (`npm run cognee:corpus`) and the tests. The page and this file must never differ. Pure functions on plain data.
 *
 * Honest limits: the retrieval here is keyword ranking over the documents (BM25), not Cognee; the live path asks Cognee through the app.
 * The "heat" of a company is a stated rule of thumb, not a model. The "about" links of the free texts are curated in the sample data;
 * a live engine would find them itself.
 */
export function makeLogic(D) {
  var ASOF = D.asOf;
  var R = D.rules;
  function ms(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function daysBetween(a, b) { return Math.round((ms(b) - ms(a)) / 86400000); }
  function addDays(s, n) { return new Date(ms(s) + n * 86400000).toISOString().slice(0, 10); }
  function by(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function eur(n) { return Math.round(n).toLocaleString('en-US'); }
  function eurShort(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e4 ? Math.round(n / 1000) + ' k' : eur(n); }
  function ent(id) { return by(D.entities, id); }
  function contract(id) { return by(D.contracts, id); }
  function product(id) { return by(D.products, id); }
  function sum(list, f) { var t = 0; list.forEach(function (x) { t += f(x); }); return t; }

  // ---- payment, renewal, pipeline, order-to-cash ---------------------------------------------------------------------------------
  /** How an entity pays: only invoices that are for this entity. Days late is negative when paid early. */
  function paymentOf(entityId) {
    var inv = D.invoices.filter(function (i) { return i.entity === entityId; });
    var paid = inv.filter(function (i) { return i.status === 'Paid'; });
    var overdue = inv.filter(function (i) { return i.status === 'Overdue'; });
    var open = inv.filter(function (i) { return i.status === 'Open'; });
    var late = paid.filter(function (i) { return i.daysLate > 0; });
    var avg = paid.length ? sum(paid, function (i) { return i.daysLate; }) / paid.length : 0;
    var oldest = 0;
    overdue.forEach(function (i) { oldest = Math.max(oldest, daysBetween(i.dueOn, ASOF)); });
    var P = R.payment;
    var risk = !paid.length ? 'none' : (avg >= P.highAvgDaysLate || oldest >= P.highOverdueDays) ? 'high' : avg >= P.mediumAvgDaysLate ? 'medium' : 'low';
    return {
      entity: entityId, invoices: inv.length, paid: paid.length, lateCount: late.length, avgDaysLate: Math.round(avg * 10) / 10,
      maxDaysLate: paid.length ? Math.max.apply(null, paid.map(function (i) { return i.daysLate; })) : 0,
      overdue: overdue, open: open, oldestOverdueDays: oldest,
      exposureGross: sum(overdue.concat(open), function (i) { return i.grossEur; }),
      overdueGross: sum(overdue, function (i) { return i.grossEur; }), risk: risk,
    };
  }
  /** Contract end, decision date (end minus notice) and how urgent it is. */
  function renewalOf(c) {
    var decision = addDays(c.end, -c.noticeDays);
    var toDecision = daysBetween(ASOF, decision), toEnd = daysBetween(ASOF, c.end);
    var U = R.urgencyDays, status;
    if (c.status === 'Lapsed' || toEnd < 0) status = 'lapsed';
    else if (c.autoRenew && toDecision < 0) status = 'auto-renews';
    else if (toDecision < 0) status = 'decision-passed';
    else if (toDecision <= U.near) status = 'near';
    else if (toDecision <= U.soon) status = 'soon';
    else status = 'later';
    return { contract: c.id, decisionDate: decision, daysToDecision: toDecision, daysToEnd: toEnd, status: status };
  }
  function prob(o) { return o.probability != null ? o.probability : R.stageProbability[o.stage]; }
  function weighted(o) { return o.acvEur * prob(o) / 100; }
  function pipeline(entityId) {
    var l = D.opportunities.filter(function (o) { return !entityId || o.entity === entityId; });
    return { count: l.length, acv: sum(l, function (o) { return o.acvEur; }), weighted: Math.round(sum(l, weighted)) };
  }
  function needsDealDesk(o) { return (o.discountPct || 0) > R.discountThresholdPct; }
  /** Order-to-cash gaps: delivered but not invoiced, invoice rejected, not yet provisioned. */
  function o2c() {
    var out = [];
    D.orders.forEach(function (o) {
      var inv = o.billed ? by(D.invoices, o.billed) : null;
      var c = contract(o.contract);
      if (o.provisioned && !o.billed) out.push({ order: o.id, entity: o.entity, kind: 'delivered-not-invoiced', netEur: o.netEur, text: o.title + ' is delivered and not invoiced.' });
      else if (inv && inv.status === 'Overdue' && c && inv.billTo !== c.billTo) out.push({ order: o.id, entity: o.entity, kind: 'bill-to-mismatch', netEur: o.netEur, invoice: inv.id, text: inv.id + ' is addressed to ' + ent(inv.billTo).short + ', the contract names ' + ent(c.billTo).short + '.' });
      else if (!o.provisioned) out.push({ order: o.id, entity: o.entity, kind: 'not-provisioned', netEur: o.netEur, text: o.title + ' is signed and not yet provisioned.' });
    });
    return out;
  }
  function entityTickets(entityId) { return D.tickets.filter(function (t) { return t.entity === entityId && t.status !== 'Resolved'; }); }

  /** Per company: value, pipeline, money owed, renewal, tickets and the "heat" (stated rule, see data.rules.heat). */
  function summary(entityId) {
    var H = R.heat;
    var e = ent(entityId);
    var cs = D.contracts.filter(function (c) { return c.entity === entityId; });
    var active = cs.filter(function (c) { return c.status === 'Active'; });
    var pay = paymentOf(entityId);
    var ren = cs.map(renewalOf);
    var tickets = entityTickets(entityId);
    var gaps = o2c().filter(function (g) { return g.entity === entityId; });
    var parts = [], heat = 0;
    function add(points, reason) { if (points > 0) { heat += points; parts.push({ points: points, reason: reason }); } }
    if (pay.risk === 'high') add(H.paymentHigh, 'pays late: on average ' + pay.avgDaysLate + ' days'); else if (pay.risk === 'medium') add(H.paymentMedium, 'pays a little late: on average ' + pay.avgDaysLate + ' days');
    if (pay.oldestOverdueDays >= R.payment.highOverdueDays) add(H.overdueOld, 'an invoice is ' + pay.oldestOverdueDays + ' days overdue');
    var near = ren.filter(function (r) { return r.status === 'near'; }), soon = ren.filter(function (r) { return r.status === 'soon'; }), lapsed = ren.filter(function (r) { return r.status === 'lapsed'; });
    if (near.length) add(H.renewalNear, 'renewal decision in ' + near[0].daysToDecision + ' days'); else if (soon.length) add(H.renewalSoon, 'renewal decision in ' + soon[0].daysToDecision + ' days');
    if (lapsed.length) add(H.lapsed, 'a contract has lapsed');
    var tp = sum(tickets, function (t) { return t.severity === 'P1' || t.severity === 'P2' ? H.ticketP2 : t.severity === 'P3' ? H.ticketP3 : 0; });
    add(Math.min(tp, H.ticketMax), tickets.length + ' open ticket' + (tickets.length === 1 ? '' : 's'));
    if (gaps.length) add(H.o2cGap, gaps.length === 1 ? gaps[0].text.replace(/\.$/, '') : gaps.length + ' order-to-cash gaps');
    heat = Math.min(100, heat);
    return {
      entity: entityId, name: e.name, short: e.short, arr: sum(active, function (c) { return c.annualEur; }), lapsedArr: sum(cs.filter(function (c) { return c.status === 'Lapsed'; }), function (c) { return c.annualEur; }),
      pipeline: pipeline(entityId), payment: pay, renewals: ren, openTickets: tickets.length, gaps: gaps, heat: heat, heatParts: parts,
      level: heat >= 50 ? 'high' : heat >= 25 ? 'medium' : 'low',
    };
  }
  function group() {
    var subs = D.entities.map(function (e) { return summary(e.id); });
    var nextDecision = null;
    D.contracts.forEach(function (c) { var r = renewalOf(c); if (r.daysToDecision >= 0 && (!nextDecision || r.daysToDecision < nextDecision.daysToDecision)) nextDecision = r; });
    var unpaid = D.invoices.filter(function (i) { return i.status !== 'Paid'; });
    return {
      entities: D.entities.length, employees: sum(D.entities, function (e) { return e.employees; }), arr: sum(subs, function (s) { return s.arr; }), lapsedArr: sum(subs, function (s) { return s.lapsedArr; }),
      pipeline: pipeline(), exposureGross: sum(unpaid, function (i) { return i.grossEur; }), unpaidCount: unpaid.length, nextDecision: nextDecision,
      hot: subs.filter(function (s) { return s.level === 'high'; }).map(function (s) { return s.entity; }), summaries: subs,
    };
  }

  // ---- graph ----------------------------------------------------------------------------------------------------------------------
  var TYPES = {
    group: { label: 'Customer group', noun: 'customer group', act: 1, color: 'purple', size: 15 }, entity: { label: 'Company', noun: 'company', act: 1, color: 'blue', size: 9 },
    contact: { label: 'Person', noun: 'person', act: 1, color: 'teal', size: 3.6 }, contract: { label: 'Contract', noun: 'contract', act: 2, color: 'purple', size: 5.4 },
    product: { label: 'Product', noun: 'product', act: 2, color: 'ink', size: 5 }, opportunity: { label: 'Deal', noun: 'deal', act: 2, color: 'green', size: 5 },
    order: { label: 'Order', noun: 'order', act: 3, color: 'amber', size: 4.2 }, invoice: { label: 'Open invoice', noun: 'open invoice', act: 3, color: 'red', size: 4.6 },
    payments: { label: 'Payment history', noun: 'payment history', act: 3, color: 'amber', size: 4.6 }, ticket: { label: 'Ticket', noun: 'support ticket', act: 3, color: 'amber', size: 3.4 },
    signal: { label: 'E-mail, call or chat', noun: 'message', act: 3, color: 'teal', size: 3.8 }, rec: { label: 'Recommendation', noun: 'recommendation', act: 4, color: 'purple', size: 7 },
  };
  var EDGES = {
    OWNS: ['owns', 'is owned by'], PAYS_FOR: ['pays the invoices of', 'has its invoices paid by'], WORKS_AT: ['works at', 'employs'], HOLDS: ['holds', 'is held by'],
    COVERS: ['covers', 'is covered by'], PURSUES: ['pursues the deal', 'is pursued by'], TARGETS: ['targets', 'is targeted by'], RENEWS: ['renews or extends', 'is renewed or extended by'],
    ORDERED: ['placed the order', 'was placed by'], UNDER: ['is placed under', 'has'], BILLED_AS: ['is billed with', 'bills'], BILL_TO: ['is addressed to', 'receives'],
    PAID: ['has the payment history', 'is the payment history of'], RAISED_BY: ['was raised by', 'raised'], MENTIONS: ['mentions', 'is mentioned in'],
    WRITTEN_BY: ['comes from', 'wrote'], EVIDENCE: ['is based on', 'supports'],
  };
  function idOf(kind, id) { return kind + ':' + id; }
  /** Resolve a plain id from the sample data ("O-7102", "brandt", "nl-ma") to its node id. */
  function resolve(id) {
    if (by(D.entities, id)) return id === D.group.id ? idOf('group', id) : idOf('entity', id);
    if (by(D.contacts, id)) return idOf('contact', id);
    if (by(D.contracts, id)) return idOf('contract', id);
    if (by(D.opportunities, id)) return idOf('opportunity', id);
    if (by(D.orders, id)) return idOf('order', id);
    if (by(D.tickets, id)) return idOf('ticket', id);
    var inv = by(D.invoices, id);
    if (inv) return inv.status === 'Paid' ? null : idOf('invoice', id);
    if (by(D.signals, id)) return idOf('signal', id);
    return null;
  }
  function recommendations() {
    var gm = summary('nl-ma');
    var U = R.urgencyDays, F = R.urgencyFactor;
    function urgency(days) { return days <= U.near ? 'near' : days <= U.soon ? 'soon' : 'later'; }
    var en = renewalOf(contract('C-2023-0517')), jp = renewalOf(contract('C-2026-0044'));
    var gaps = o2c();
    var gapNet = sum(gaps.filter(function (g) { return g.entity === 'nl-en' || g.kind === 'bill-to-mismatch'; }), function (g) { return g.netEur; });
    var recs = [
      { id: 'R-1', title: 'Close the Energietechnik renewal with the Group CFO before the decision date', kind: 'revenue', atStakeEur: by(D.opportunities, 'O-7102').acvEur, dueDate: en.decisionDate, days: en.daysToDecision,
        owner: 'Sven Albrecht', evidence: ['O-7102', 'C-2023-0517', 'S-02', 'T-30502', 'ostertag', 'petersen'],
        why: 'The decision date is ' + en.decisionDate + ' (' + en.daysToDecision + ' days). The CFO wants consolidated terms, the Joule agent cannot read service orders yet (ticket open), and the discount of ' + by(D.opportunities, 'O-7102').discountPct + ' % is below the deal desk threshold of ' + R.discountThresholdPct + ' %.',
        steps: ['Agree consolidated terms with the Group CFO before the decision date', 'Get the open authorization ticket T-30502 fixed so the Joule agent can read service orders', 'Send the renewal quote with 20 % more users'], approval: 'Account executive; price is inside the deal desk threshold' },
      { id: 'R-2', title: 'Bring a group view into the Joule pilot decision', kind: 'revenue', atStakeEur: by(D.opportunities, 'O-7101').acvEur, dueDate: jp.decisionDate, days: jp.daysToDecision,
        owner: 'Sven Albrecht', evidence: ['O-7101', 'C-2026-0044', 'S-05', 'voss', 'ostertag'],
        why: 'The pilot decision date is ' + jp.decisionDate + ' (' + jp.daysToDecision + ' days). The Group CIO asked for adoption per company, cost and number of invoices; a single framework is possible if payment terms stay simple.',
        steps: ['Prepare adoption per company from the Joule usage data', 'Offer one framework with one bill-to party', 'Agree the roll-out in two waves with the CIO'], approval: 'Account executive; framework terms to the deal desk' },
      { id: 'R-3', title: 'Fix the PO reference and agree a payment day with Maschinenbau before offering more users', kind: 'cash', atStakeEur: gm.payment.exposureGross, dueDate: gm.payment.open.length ? gm.payment.open[0].dueOn : ASOF, days: gm.payment.open.length ? daysBetween(ASOF, gm.payment.open[0].dueOn) : 0,
        owner: 'Sven Albrecht', evidence: ['INV-2026-N0009', 'INV-2026-N0010', 'pay:nl-ma', 'S-01', 'O-7107', 'brandt'],
        why: 'Eight of eight paid invoices were late (on average ' + gm.payment.avgDaysLate + ' days) and ' + gm.payment.overdue.length + ' is ' + gm.payment.oldestOverdueDays + ' days overdue. The accounts payable mail names the payment run and an old PO number. The expansion (O-7107) should wait for a clean record.',
        steps: ['Correct the PO number on the open invoices and re-send them', 'Agree a payment day or direct debit with accounts payable', 'Hold the 60-user expansion until the overdue invoice is paid'], approval: 'Credit manager approves any payment arrangement' },
      { id: 'R-4', title: 'Re-issue the rejected Logistik invoice to Business Services and bill the delivered workshops', kind: 'cash', atStakeEur: gapNet, dueDate: ASOF, days: 0,
        owner: 'Sales operations', evidence: ['INV-2026-L0099', 'SO-81355', 'SO-81307', 'S-03', 'reuter'],
        why: 'Invoice INV-2026-L0099 is addressed to Logistik, the contract names Business Services, so it was rejected. The Energietechnik workshops (48,000 net) are delivered and blocked for billing.',
        steps: ['Cancel and re-issue INV-2026-L0099 to Business Services', 'Release billing block 01 and invoice the workshops', 'Check the bill-to party on all open orders'], approval: 'Team lead approves the re-bill (above the clerk limit of ' + eur(R.limits.clerk.rebill) + ' EUR)' },
      { id: 'R-5', title: 'Win back Polska with an executive call', kind: 'revenue', atStakeEur: by(D.opportunities, 'O-7104').acvEur, dueDate: by(D.opportunities, 'O-7104').closeDate, days: daysBetween(ASOF, by(D.opportunities, 'O-7104').closeDate),
        owner: 'Mara Weber', evidence: ['O-7104', 'C-2023-0102', 'S-04', 'wrona', 'T-30511'],
        why: 'The Employee Central contract lapsed on 31 May and the tenant is read-only. The Head of IT looks at a local partner and has agreed to talk to an executive.',
        steps: ['Ask the Group CIO for an executive call with the Head of IT', 'Offer a read-write extension while the decision is open'], approval: 'Account executive' },
    ];
    recs.forEach(function (r) {
      r.urgency = urgency(r.days);
      r.score = Math.round(r.atStakeEur * F[r.urgency]);
      r.evidence = r.evidence.map(function (e) { return e.indexOf(':') > 0 ? e : (resolve(e) || e); });
    });
    recs.sort(function (a, b) { return b.score - a.score; });
    recs.forEach(function (r, i) { r.rank = i + 1; });
    return recs;
  }

  function nodeList() {
    var nodes = [], edges = [], seen = {}, G = D.group;
    function node(type, id, label, sub, extra) {
      var n = { id: idOf(type, id), type: type, label: label, sub: sub || '', act: TYPES[type].act, facts: [], entity: null, value: 0 };
      for (var k in (extra || {})) n[k] = extra[k];
      nodes.push(n); seen[n.id] = n; return n;
    }
    function edge(type, from, to) {
      if (!seen[from] || !seen[to]) return;
      var key = type + '|' + from + '|' + to; if (seen[key]) return; seen[key] = true;
      edges.push({ id: key, source: from, target: to, type: type });
    }
    D.entities.forEach(function (e) {
      var s = summary(e.id), isG = e.id === G.id;
      var n = node(isG ? 'group' : 'entity', e.id, isG ? e.name : e.short, isG ? e.city + ' · parent' : e.city + ' · ' + e.role, { entity: e.id, value: s.arr, heat: s.heat, level: s.level });
      n.facts = [['Legal name', e.name], ['Country', e.country], ['Role', e.role], ['Ownership', e.ownershipPct + ' %'], ['Employees', eur(e.employees)], ['Industry', e.industry], ['SAP customer id', e.sapCustomerId],
        ['Active contract value per year', eur(s.arr) + ' EUR'], ['Weighted pipeline', eur(s.pipeline.weighted) + ' EUR'], ['Heat', s.heat + ' of 100 (' + s.level + ')']];
      if (e.note) n.facts.push(['Note', e.note]);
      s.heatParts.forEach(function (p) { n.facts.push(['Heat +' + p.points, p.reason]); });
    });
    D.contacts.forEach(function (c) { var n = node('contact', c.id, c.name, c.role + ' · ' + ent(c.entity).short, { entity: c.entity }); n.facts = [['Role', c.role], ['Company', ent(c.entity).name], ['Stance', c.stance], ['Note', c.note]]; });
    D.products.forEach(function (p) { var n = node('product', p.id, p.name, 'product'); n.facts = [['Product', p.name]]; });
    D.contracts.forEach(function (c) {
      var r = renewalOf(c);
      var n = node('contract', c.id, c.id, product(c.product).name + ' · ' + ent(c.entity).short, { entity: c.entity, value: c.annualEur, status: c.status, renewal: r.status });
      n.facts = [['Product', product(c.product).name], ['Company', ent(c.entity).name], ['Scope', c.scope], ['Value per year', eur(c.annualEur) + ' EUR'], ['Term', c.start + ' to ' + c.end], ['Status', c.status],
        ['Notice period', c.noticeDays + ' days'], ['Renewal decision date', r.decisionDate + (r.daysToDecision >= 0 ? ' (' + r.daysToDecision + ' days left)' : ' (passed)')], ['Renewal status', r.status === 'near' || r.status === 'soon' ? 'renewal decision is due soon, in ' + r.daysToDecision + ' days' : r.status === 'auto-renews' ? 'renews by itself, the notice date has passed' : r.status === 'lapsed' ? 'the contract has lapsed' : 'renewal decision is not due yet'], ['Auto-renew', c.autoRenew ? 'yes' : 'no'], ['Billing', c.billing + ', ' + c.paymentTerms], ['Bill-to party', ent(c.billTo).name]];
    });
    D.opportunities.forEach(function (o) {
      var n = node('opportunity', o.id, o.id, o.title, { entity: o.entity, value: o.acvEur, stage: o.stage });
      n.facts = [['Deal', o.title], ['Company', ent(o.entity).name], ['Stage', o.stage], ['Value (ACV)', eur(o.acvEur) + ' EUR'], ['Probability', prob(o) + ' %'], ['Weighted', eur(weighted(o)) + ' EUR'], ['Close date', o.closeDate], ['Owner', o.owner], ['Next step', o.nextStep]];
      if (o.discountPct != null) n.facts.push(['Discount asked', o.discountPct + ' %' + (needsDealDesk(o) ? ' (above the ' + R.discountThresholdPct + ' % threshold: deal desk)' : '')]);
    });
    D.orders.forEach(function (o) {
      var n = node('order', o.id, o.id, o.title, { entity: o.entity, value: o.netEur });
      n.facts = [['Order', o.title], ['Company', ent(o.entity).name], ['Net value', eur(o.netEur) + ' EUR'], ['Ordered on', o.orderedOn], ['Provisioned', o.provisioned ? 'yes' : 'no'], ['Invoice', o.billed || 'none yet'], ['Note', o.note]];
    });
    D.invoices.forEach(function (i) {
      if (i.status === 'Paid') return;
      var overdueDays = i.status === 'Overdue' ? daysBetween(i.dueOn, ASOF) : 0;
      var n = node('invoice', i.id, i.id, i.status + (overdueDays ? ' · ' + overdueDays + ' days' : '') + ' · ' + ent(i.entity).short, { entity: i.entity, value: i.grossEur, status: i.status, overdueDays: overdueDays });
      n.facts = [['Customer company', ent(i.entity).name], ['Bill-to party', ent(i.billTo).name], ['Contract', i.contract], ['Issue date', i.issuedOn], ['Due date', i.dueOn], ['Net amount', eur(i.netEur) + ' EUR'], ['Gross amount', eur(i.grossEur) + ' EUR'], ['Status', i.status + (overdueDays ? ', ' + overdueDays + ' days overdue' : '')]];
      if (i.note) n.facts.push(['Note', i.note]);
    });
    D.entities.forEach(function (e) {
      var p = paymentOf(e.id); if (!p.paid) return;
      var n = node('payments', e.id, 'Payments · ' + e.short, p.paid + ' paid · avg ' + (p.avgDaysLate > 0 ? '+' : '') + p.avgDaysLate + ' days', { entity: e.id, value: p.paid, risk: p.risk, avgDaysLate: p.avgDaysLate });
      n.id = 'pay:' + e.id; seen[n.id] = n; delete seen['payments:' + e.id];
      n.facts = [['Company', e.name], ['Invoices paid', String(p.paid)], ['Pattern', p.risk === 'low' ? 'pays on time: ' + p.lateCount + ' of ' + p.paid + ' invoices were paid after the due date' : 'pays late: ' + p.lateCount + ' of ' + p.paid + ' invoices were paid after the due date, on average ' + p.avgDaysLate + ' days'], ['Average days after the due date', (p.avgDaysLate > 0 ? '+' : '') + p.avgDaysLate], ['Longest wait after the due date', String(p.maxDaysLate) + ' days'], ['Payment risk', p.risk]];
    });
    D.tickets.forEach(function (t) { var n = node('ticket', t.id, t.id, t.title, { entity: t.entity }); n.facts = [['Ticket', t.title], ['Company', ent(t.entity).name], ['Product', product(t.product).name], ['Severity', t.severity], ['Opened', t.openedOn], ['Status', t.status]]; });
    D.signals.forEach(function (s) {
      var n = node('signal', s.id, s.kind + ' ' + s.date.slice(5), ent(s.entity).short + ' · ' + (by(D.contacts, s.contact) || { name: '' }).name, { entity: s.entity });
      n.facts = [['Kind', s.kind], ['Date', s.date], ['From', (by(D.contacts, s.contact) || { name: 'n/a' }).name], ['Text', s.text]];
    });
    recommendations().forEach(function (r) {
      var n = node('rec', r.id, r.id, r.title, { value: r.atStakeEur, rank: r.rank, urgency: r.urgency, days: r.days });
      n.facts = [['Recommendation', r.title], ['Priority', '#' + r.rank], ['At stake', eur(r.atStakeEur) + ' EUR (' + r.kind + ')'], ['Due', r.dueDate + (r.days >= 0 ? ' (' + r.days + ' days)' : '')], ['Owner', r.owner], ['Why', r.why], ['Approval', r.approval]];
      r.steps.forEach(function (s, i) { n.facts.push(['Step ' + (i + 1), s]); });
      n.evidence = r.evidence;
    });

    // edges
    var G0 = idOf('group', G.id);
    D.entities.forEach(function (e) { if (e.id !== G.id) edge('OWNS', G0, idOf('entity', e.id)); });
    D.contracts.forEach(function (c) { if (c.billTo !== c.entity && c.billTo === 'nl-ssc') edge('PAYS_FOR', idOf('entity', 'nl-ssc'), idOf('entity', c.entity)); });
    D.contacts.forEach(function (c) { edge('WORKS_AT', idOf('contact', c.id), resolve(c.entity)); });
    D.contracts.forEach(function (c) { edge('HOLDS', resolve(c.entity), idOf('contract', c.id)); edge('COVERS', idOf('contract', c.id), idOf('product', c.product)); });
    D.opportunities.forEach(function (o) {
      edge('PURSUES', resolve(o.entity), idOf('opportunity', o.id)); edge('TARGETS', idOf('opportunity', o.id), idOf('product', o.product));
      if (o.renews) edge('RENEWS', idOf('opportunity', o.id), idOf('contract', o.renews)); if (o.extends) edge('RENEWS', idOf('opportunity', o.id), idOf('contract', o.extends));
    });
    D.orders.forEach(function (o) {
      edge('ORDERED', resolve(o.entity), idOf('order', o.id)); edge('UNDER', idOf('order', o.id), idOf('contract', o.contract));
      if (o.billed) edge('BILLED_AS', idOf('order', o.id), idOf('invoice', o.billed));
    });
    D.invoices.forEach(function (i) { if (i.status === 'Paid') return; edge('BILL_TO', idOf('invoice', i.id), resolve(i.billTo)); edge('UNDER', idOf('invoice', i.id), idOf('contract', i.contract)); });
    D.entities.forEach(function (e) { edge('PAID', resolve(e.id), 'pay:' + e.id); });
    D.tickets.forEach(function (t) { edge('RAISED_BY', idOf('ticket', t.id), resolve(t.entity)); });
    D.signals.forEach(function (s) {
      edge('WRITTEN_BY', idOf('signal', s.id), resolve(s.contact));
      s.about.forEach(function (a) { var to = resolve(a); if (to && to !== resolve(s.contact)) edge('MENTIONS', idOf('signal', s.id), to); });
    });
    nodes.filter(function (n) { return n.type === 'rec'; }).forEach(function (n) { n.evidence.forEach(function (e) { edge('EVIDENCE', n.id, e); }); });
    return { nodes: nodes, edges: edges };
  }

  var GRAPH = nodeList();
  var NODE = {}; GRAPH.nodes.forEach(function (n) { NODE[n.id] = n; });
  var ADJ = {}; GRAPH.nodes.forEach(function (n) { ADJ[n.id] = []; });
  GRAPH.edges.forEach(function (e) { ADJ[e.source].push({ id: e.target, edge: e, out: true }); ADJ[e.target].push({ id: e.source, edge: e, out: false }); });
  function node(id) { return NODE[id] || null; }
  function neighbours(id) { return (ADJ[id] || []).map(function (a) { return a.id; }); }

  // ---- documents for Cognee -------------------------------------------------------------------------------------------------------
  function sentence(t) { return String(t).replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '') + '.'; }
  /** One short text per node: its facts and its connections as sentences. The id stays in brackets so an answer can be traced back to a node. */
  function documents() {
    return GRAPH.nodes.map(function (n) {
      var noun = TYPES[n.type].noun, art = /^[aeiou]/.test(noun) ? 'an ' : 'a ';
      var lines = [sentence(n.label + ' is ' + art + noun + ' (' + n.id + ')')];
      if (n.type !== 'signal') lines.push(sentence(n.label + ': ' + n.sub));
      n.facts.forEach(function (f) { lines.push(f[0] === 'Text' ? f[1] : sentence(n.label + ': ' + f[0].toLowerCase() + ' is ' + f[1])); });
      (ADJ[n.id] || []).forEach(function (a) {
        var o = NODE[a.id], verb = EDGES[a.edge.type][a.out ? 0 : 1];
        lines.push(sentence(n.label + ' ' + verb + ' ' + o.label + ' (' + o.id + ')'));
      });
      return { id: n.id, name: n.label, text: lines.join('\n') };
    });
  }
  var DOCS = documents(), DOC = {}; DOCS.forEach(function (d) { DOC[d.id] = d; });

  // ---- local retrieval: BM25 over the same documents --------------------------------------------------------------------------------
  var STOP = {}; 'a an and are as at be by do does for from has have how in is it its of on or that the their there this to was what which who whom why will with we our should before after about'.split(' ').forEach(function (w) { STOP[w] = 1; });
  var SYN = { likely: ['probability'], soon: ['due'], late: ['overdue', 'delay'], pay: ['payment', 'paid'], decide: ['decision'], decision: ['decide'], renew: ['renewal', 'decision'], end: ['renewal', 'decision'], worth: ['value'], money: ['invoice', 'overdue'], owe: ['overdue', 'open'], deliver: ['provisioned', 'billing'], billed: ['invoice'], rejected: ['bill-to', 'addressed'], priority: ['recommendation'], first: ['priority'], champion: ['stance'], decider: ['decision'] };
  function stem(w) { if (w.length > 4 && w.slice(-3) === 'ies') return w.slice(0, -3) + 'y'; if (w.length > 3 && w.slice(-1) === 's' && w.slice(-2) !== 'ss') return w.slice(0, -1); return w; }
  function tokens(text) {
    var low = String(text).toLowerCase(), out = [];
    (low.match(/[a-z]{1,4}-[0-9a-z-]{3,}/g) || []).forEach(function (t) { out.push(t); });
    (low.match(/[a-zà-ÿ0-9]+/g) || []).forEach(function (w) { if (w.length > 1 && !STOP[w]) out.push(stem(w)); });
    return out;
  }
  var INDEX = (function () {
    var df = {}, tf = {}, len = {}, total = 0;
    DOCS.forEach(function (d) {
      var t = tokens(d.name + ' ' + d.name + ' ' + d.text), m = {};
      t.forEach(function (w) { m[w] = (m[w] || 0) + 1; });
      tf[d.id] = m; len[d.id] = t.length; total += t.length;
      for (var w in m) df[w] = (df[w] || 0) + 1;
    });
    return { df: df, tf: tf, len: len, avg: total / DOCS.length, n: DOCS.length };
  })();
  var ENT_WORDS = (function () { var m = []; D.entities.forEach(function (e) { m.push({ id: e.id, words: e.id === D.group.id ? ['holding', 'parent', 'gruppe'] : [e.short.toLowerCase()] }); }); return m; })();
  /** What kind of thing a question asks for: documents of those types get a boost. Stated, not hidden: it is a hint on top of the keyword score. */
  var INTENTS = [
    { re: /compan|subsidiar|owned|belong|legal entit|structure/, types: ['entity', 'group'] },
    { re: /who |person|people|decision maker|champion|blocker|decide|contact|sponsor/, types: ['contact'] },
    { re: /contract|renew|ends?\b|expire|lapse|worth per year|annual/, types: ['contract'] },
    { re: /deal|pipeline|opportunit|forecast|likely|probab/, types: ['opportunity'] },
    { re: /invoice|pays?\b|paid|payment|late|overdue|outstanding|owe/, types: ['payments', 'invoice'] },
    { re: /deliver|not invoiced|not billed|billing|order|rejected/, types: ['order', 'invoice'] },
    { re: /\bwhy\b|said|mail|call|chat|wrote|told/, types: ['signal'], boost: 6 },
    { re: /ticket|incident|issue|support/, types: ['ticket'] },
    { re: /do first|priorit|recommend|proposal|should we|next step|approval|approve/, types: ['rec'] },
  ];
  var NEIGHBOUR_ORDER = ['entity', 'group', 'invoice', 'contract', 'opportunity', 'order', 'signal', 'ticket', 'payments', 'contact', 'product', 'rec'];
  function expand(question) {
    var t = tokens(question), seenT = {}, out = [];
    t.forEach(function (w) { if (!seenT[w]) { seenT[w] = 1; out.push(w); (SYN[w] || []).forEach(function (s) { if (!seenT[s]) { seenT[s] = 1; out.push(s); } }); } });
    return out;
  }
  /**
   * Ask the documents a question. Returns the best documents with the lines that matched (the proof), and the sub-graph around them
   * (hits first, then their neighbours) so the graph can light up exactly what was retrieved.
   */
  function retrieve(question, opts) {
    var k = (opts && opts.k) || 8, low = String(question).toLowerCase();
    var terms = expand(question), want = [];
    ENT_WORDS.forEach(function (e) { if (e.words.some(function (w) { return low.indexOf(w) >= 0; })) want.push(e.id); });
    var scored = DOCS.map(function (d) {
      var s = 0, m = INDEX.tf[d.id], norm = 1 - 0.6 + 0.6 * INDEX.len[d.id] / INDEX.avg;
      terms.forEach(function (w) {
        var f = m[w]; if (!f) return;
        var idf = Math.log(1 + (INDEX.n - INDEX.df[w] + 0.5) / (INDEX.df[w] + 0.5));
        s += idf * (f * 2.2) / (f + 1.2 * norm);
      });
      var nd = NODE[d.id];
      if (s > 0 && want.length && want.indexOf(nd.entity) >= 0) s += 2.5;
      INTENTS.forEach(function (it) { if (it.re.test(low) && it.types.indexOf(nd.type) >= 0) s += it.boost || 3; });
      if (nd.type === 'rec' && s > 0) s += (6 - nd.rank) * 0.5;
      if (nd.type === 'group' && /compan|subsidiar|belong|owned|structure/.test(low)) s += 1.5;
      if (nd.type === 'payments' && /late|overdue|slow/.test(low)) s += Math.max(0, nd.avgDaysLate) / 8;
      return { id: d.id, score: s };
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score || (a.id < b.id ? -1 : 1); }).slice(0, k);
    var qset = {}; terms.forEach(function (w) { qset[w] = 1; });
    var hits = scored.map(function (h) {
      var lines = DOC[h.id].text.split('\n').map(function (l) {
        var c = 0; tokens(l).forEach(function (w) { if (qset[w]) c++; }); return { l: l, c: c };
      }).filter(function (x) { return x.c > 0; }).sort(function (a, b) { return b.c - a.c; }).slice(0, 2).map(function (x) { return x.l; });
      return { id: h.id, score: Math.round(h.score * 100) / 100, lines: lines.length ? lines : [DOC[h.id].text.split('\n')[0]] };
    });
    var ids = hits.map(function (h) { return h.id; }), role = {}; ids.forEach(function (i) { role[i] = 'hit'; });
    hits.slice(0, 3).forEach(function (h) {
      var ns = neighbours(h.id).filter(function (i) { return !role[i]; });
      ns.sort(function (a, b) { return NEIGHBOUR_ORDER.indexOf(NODE[a].type) - NEIGHBOUR_ORDER.indexOf(NODE[b].type); });
      ns.slice(0, 5).forEach(function (i) { role[i] = 'context'; ids.push(i); });
    });
    return { question: question, mode: 'local', hits: hits, ids: ids, role: role, terms: terms };
  }

  // ---- story: four acts, ten beats, each beat is one retrieval ---------------------------------------------------------------------
  var ACTS = [
    { n: 1, title: 'Who is Nordlicht?', hook: 'One customer on paper, ' + D.entities.length + ' companies in reality.' },
    { n: 2, title: 'What runs there?', hook: 'Contracts, products and the deals on the table.' },
    { n: 3, title: 'What is open?', hook: 'Who pays, what was delivered and not billed, and what people said.' },
    { n: 4, title: 'What do we do?', hook: 'Five proposals, ranked. A person decides.' },
  ];
  function beats() {
    var g = group(), S = {}; g.summaries.forEach(function (s) { S[s.entity] = s; });
    var subs = D.entities.filter(function (e) { return e.id !== D.group.id; });
    var ssc = ent('nl-ssc'), se = ent('nl-se');
    var ma = S['nl-ma'], en = S['nl-en'];
    var champs = D.contacts.filter(function (c) { return c.stance === 'champion'; }), blockers = D.contacts.filter(function (c) { return c.stance === 'blocker'; });
    var cs = D.contracts.map(function (c) { return { c: c, r: renewalOf(c) }; });
    var near = cs.filter(function (x) { return x.r.status === 'near' || x.r.status === 'soon'; }).sort(function (a, b) { return a.r.daysToDecision - b.r.daysToDecision; });
    var opp = D.opportunities.slice().sort(function (a, b) { return b.acvEur - a.acvEur; });
    var desk = D.opportunities.filter(needsDealDesk);
    var gaps = o2c(), notBilled = gaps.filter(function (x) { return x.kind === 'delivered-not-invoiced'; }), mism = gaps.filter(function (x) { return x.kind === 'bill-to-mismatch'; });
    var recs = recommendations(), top = recs[0];
    var lastLate = ma.payment.overdue[0];
    var med = g.summaries.filter(function (s) { return s.payment.risk === 'medium'; });
    return [
      { id: '1.1', act: 1, title: 'One customer, ' + D.entities.length + ' companies', question: 'Which companies belong to the Nordlicht group and how are they owned?',
        text: D.group.name + ' is one customer on paper: a parent and ' + subs.length + ' subsidiaries with ' + eur(g.employees) + ' people in ' + subs.map(function (e) { return e.city; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).length + ' cities. ' + ssc.short + ' pays the invoices of ' + GRAPH.edges.filter(function (e) { return e.type === 'PAYS_FOR'; }).length + ' of them, and ' + se.short + ' is only ' + se.ownershipPct + ' % owned, so one signature does not cover everybody.',
        metrics: [{ k: 'Companies', v: String(D.entities.length) }, { k: 'People', v: eur(g.employees) }, { k: 'Customer since', v: String(D.group.customerSince) }], expect: ['group:nl-holding', 'entity:nl-ma', 'entity:nl-ssc'] },
      { id: '1.2', act: 1, title: 'Who decides', question: 'Who are the decision makers, champions and blockers at Nordlicht?',
        text: champs.map(function (c) { return c.name + ' (' + c.role + ', ' + ent(c.entity).short + ')'; }).join(', ') + ' are champions. ' + blockers.map(function (c) { return c.name + ' at ' + ent(c.entity).short; }).join(', ') + ' is the one to win over. The Group CFO, ' + by(D.contacts, 'ostertag').name + ', decides on consolidated terms.',
        metrics: [{ k: 'People mapped', v: String(D.contacts.length) }, { k: 'Champions', v: String(champs.length) }, { k: 'Blockers', v: String(blockers.length) }], expect: ['contact:voss', 'contact:wrona'] },
      { id: '2.1', act: 2, title: 'Contracts and products', question: 'Which contracts does Nordlicht hold and what are they worth per year?',
        text: 'Active contracts are worth ' + eur(g.arr) + ' EUR a year across ' + D.contracts.filter(function (c) { return c.status === 'Active'; }).length + ' contracts. S/4HANA runs in two companies on two separate contracts; ' + eur(g.lapsedArr) + ' EUR has already lapsed (Polska).',
        metrics: [{ k: 'Active per year', v: eurShort(g.arr) + ' EUR' }, { k: 'Lapsed per year', v: eurShort(g.lapsedArr) + ' EUR' }, { k: 'Products', v: String(D.products.length) }], expect: ['contract:C-2024-0820', 'contract:C-2023-0517'] },
      { id: '2.2', act: 2, title: 'Renewals that decide the quarter', question: 'Which contracts end or need a renewal decision soon?',
        text: near.map(function (x) { return ent(x.c.entity).short + ': decision on ' + x.r.decisionDate + ' (' + x.r.daysToDecision + ' days), ' + eur(x.c.annualEur) + ' EUR a year'; }).join('. ') + '. ' + ent('nl-ssc').short + ' renews by itself; Polska has lapsed.',
        metrics: [{ k: 'Next decision', v: g.nextDecision ? g.nextDecision.daysToDecision + ' days' : 'none' }, { k: 'Decisions within 60 days', v: String(near.length) }, { k: 'Lapsed', v: String(cs.filter(function (x) { return x.r.status === 'lapsed'; }).length) }], expect: ['contract:C-2023-0517', 'contract:C-2026-0044'] },
      { id: '2.3', act: 2, title: 'The deals on the table', question: 'Which open deals does Nordlicht have and how likely are they?',
        text: g.pipeline.count + ' open deals worth ' + eur(g.pipeline.acv) + ' EUR, weighted ' + eur(g.pipeline.weighted) + ' EUR. The biggest is ' + opp[0].id + ' (' + eur(opp[0].acvEur) + ' EUR at ' + prob(opp[0]) + ' %). ' + desk.map(function (o) { return o.id + ' asks ' + o.discountPct + ' % and needs the deal desk'; }).join('; ') + '.',
        metrics: [{ k: 'Open deals', v: String(g.pipeline.count) }, { k: 'Weighted', v: eurShort(g.pipeline.weighted) + ' EUR' }, { k: 'Deal desk', v: String(desk.length) }], expect: ['opportunity:O-7102', 'opportunity:O-7101'] },
      { id: '3.1', act: 3, title: 'Who pays late?', question: 'Which Nordlicht company pays its invoices late?',
        text: ma.short + ' paid ' + ma.payment.lateCount + ' of ' + ma.payment.paid + ' invoices late, on average ' + ma.payment.avgDaysLate + ' days. ' + lastLate.id + ' is ' + ma.payment.oldestOverdueDays + ' days overdue; with the next invoice ' + eur(ma.payment.exposureGross) + ' EUR gross is outstanding. ' + (med.length ? med.map(function (s) { return s.short + ' is a little late (on average ' + s.payment.avgDaysLate + ' days)'; }).join(', ') + ', the rest pay on time.' : 'The other companies pay on time.'),
        metrics: [{ k: 'Paid late', v: ma.payment.lateCount + ' of ' + ma.payment.paid }, { k: 'Average', v: '+' + ma.payment.avgDaysLate + ' days' }, { k: 'Outstanding', v: eur(ma.payment.exposureGross) + ' EUR' }], expect: ['entity:nl-ma', 'invoice:INV-2026-N0009', 'pay:nl-ma'] },
      { id: '3.2', act: 3, title: 'What people said', question: 'Why are Maschinenbau invoices paid late?',
        text: by(D.contacts, 'brandt').name + ' wrote on ' + by(D.signals, 'S-01').date + ': accounts payable pays twice a month and blocks invoices whose PO reference does not match. That fits a delay of 9 to 35 days. It is an inference from one mail, not a proof for every invoice.',
        metrics: [{ k: 'Source', v: 'E-mail ' + by(D.signals, 'S-01').date.slice(5) }, { k: 'Spread', v: '9 to 35 days' }, { k: 'Marked as', v: 'Inference' }], expect: ['signal:S-01'], inference: true },
      { id: '3.3', act: 3, title: 'Delivered, not billed', question: 'Which deliveries are not invoiced or have invoices that were rejected?',
        text: notBilled.map(function (x) { return x.text; }).join(' ') + ' ' + mism.map(function (x) { return x.text + ' It was rejected.'; }).join(' ') + ' Together ' + eur(sum(notBilled.concat(mism), function (x) { return x.netEur; })) + ' EUR net is held back.',
        metrics: [{ k: 'Not invoiced', v: eur(sum(notBilled, function (x) { return x.netEur; })) + ' EUR' }, { k: 'Rejected invoice', v: eur(sum(mism, function (x) { return x.netEur; })) + ' EUR' }, { k: 'Gaps', v: String(gaps.length) }], expect: ['order:SO-81307', 'invoice:INV-2026-L0099', 'signal:S-03'] },
      { id: '4.1', act: 4, title: 'The priorities', question: 'What should we do first for Nordlicht?',
        text: 'Five proposals, ranked by the amount at stake times urgency: the first is "' + top.title + '" (' + eur(top.atStakeEur) + ' EUR, ' + (top.days >= 0 ? top.days + ' days' : 'due') + '). Ranking only orders the list; it does not predict an outcome.',
        metrics: [{ k: 'Proposals', v: String(recs.length) }, { k: 'First', v: top.id }, { k: 'At stake', v: eurShort(sum(recs, function (r) { return r.atStakeEur; })) + ' EUR' }], expect: ['rec:' + top.id] },
      { id: '4.2', act: 4, title: 'A person decides', question: 'Which proposals need an approval before anything is changed?',
        text: 'Joule drafts, a person decides. Nothing here is written to a system: the re-bill needs a team lead (above the clerk limit of ' + eur(R.limits.clerk.rebill) + ' EUR), payment arrangements go to the credit manager, price terms stay below the deal desk threshold of ' + R.discountThresholdPct + ' %.',
        metrics: [{ k: 'Written to systems', v: '0' }, { k: 'Need approval', v: String(recs.length) }, { k: 'Drafted by Joule', v: 'on request' }], expect: ['rec:R-4'] },
    ];
  }

  // ---- 3D layout: seeded force simulation ---------------------------------------------------------------------------------------------
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  /** Positions in an arbitrary 3D space, deterministic. Companies sit on a ring around the group, everything else settles around its company. */
  function layout(iterations) {
    var rand = rng(360), pos = {}, vel = {}, ids = GRAPH.nodes.map(function (n) { return n.id; });
    var subs = D.entities.filter(function (e) { return e.id !== D.group.id; }), ring = {};
    subs.forEach(function (e, i) { var a = i / subs.length * Math.PI * 2; ring[idOf('entity', e.id)] = [Math.cos(a) * 300, (i % 2 ? 40 : -40), Math.sin(a) * 300]; });
    GRAPH.nodes.forEach(function (n) {
      if (n.type === 'group') pos[n.id] = [0, 0, 0];
      else if (n.type === 'entity') pos[n.id] = ring[n.id].slice();
      else {
        var home = n.entity ? (ring[idOf('entity', n.entity)] || [0, 0, 0]) : [0, 0, 0];
        var r = n.type === 'rec' ? 190 : 90;
        pos[n.id] = [home[0] + (rand() - .5) * r * 2, home[1] + (rand() - .5) * r * 2, home[2] + (rand() - .5) * r * 2];
      }
      vel[n.id] = [0, 0, 0];
    });
    var SPRING = { OWNS: 300, PAYS_FOR: 230, WORKS_AT: 70, HOLDS: 85, COVERS: 110, PURSUES: 90, TARGETS: 110, RENEWS: 55, ORDERED: 80, UNDER: 60, BILLED_AS: 50, BILL_TO: 90, PAID: 70, RAISED_BY: 70, MENTIONS: 85, WRITTEN_BY: 60, EVIDENCE: 150 };
    for (var it = 0; it < (iterations || 260); it++) {
      var cool = 1 - it / (iterations || 260) * 0.85;
      for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
        var a = pos[ids[i]], b = pos[ids[j]], dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2], d2 = dx * dx + dy * dy + dz * dz + 40, d = Math.sqrt(d2);
        var f = 2600 / d2 * cool; dx /= d; dy /= d; dz /= d;
        vel[ids[i]][0] += dx * f; vel[ids[i]][1] += dy * f; vel[ids[i]][2] += dz * f; vel[ids[j]][0] -= dx * f; vel[ids[j]][1] -= dy * f; vel[ids[j]][2] -= dz * f;
      }
      GRAPH.edges.forEach(function (e) {
        var a = pos[e.source], b = pos[e.target], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
        var f = (d - (SPRING[e.type] || 90)) * 0.012 * cool; dx /= d; dy /= d; dz /= d;
        vel[e.source][0] += dx * f; vel[e.source][1] += dy * f; vel[e.source][2] += dz * f; vel[e.target][0] -= dx * f; vel[e.target][1] -= dy * f; vel[e.target][2] -= dz * f;
      });
      GRAPH.nodes.forEach(function (n) {
        var p = pos[n.id], v = vel[n.id];
        if (n.type === 'group') { v[0] = v[1] = v[2] = 0; return; }
        if (n.type === 'entity') { var h = ring[n.id]; v[0] += (h[0] - p[0]) * 0.05; v[1] += (h[1] - p[1]) * 0.05; v[2] += (h[2] - p[2]) * 0.05; }
        else { v[0] -= p[0] * 0.0006; v[1] -= p[1] * 0.0012; v[2] -= p[2] * 0.0006; }
        p[0] += v[0] * 0.5; p[1] += v[1] * 0.5; p[2] += v[2] * 0.5; v[0] *= 0.82; v[1] *= 0.82; v[2] *= 0.82;
      });
    }
    return pos;
  }

  return {
    ASOF: ASOF, TYPES: TYPES, EDGES: EDGES, ACTS: ACTS, graph: GRAPH, node: node, neighbours: neighbours, docs: DOCS, doc: function (id) { return DOC[id] || null; },
    paymentOf: paymentOf, renewalOf: renewalOf, pipeline: pipeline, weighted: weighted, o2c: o2c, summary: summary, group: group, recommendations: recommendations,
    retrieve: retrieve, beats: beats, layout: layout, tokens: tokens, eur: eur, eurShort: eurShort, daysBetween: daysBetween, resolve: resolve, ent: ent, contract: contract, by: by,
  };
}

/** The documents of the sample as a Cognee corpus: [{ id, name, text }], one per node, ids in brackets (see scripts/cognee-seed.py). */
export function customer360Documents(data) { return makeLogic(data).docs; }
