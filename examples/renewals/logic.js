const DAY = 86400000;
const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const daysBetween = (from, to) => Math.round((toDay(to) - toDay(from)) / DAY);
const eur = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const upliftPct = (c) => (c.offer && c.offer.currentAnnualEur ? Math.round(((c.offer.annualEur / c.offer.currentAnnualEur - 1) * 1000)) / 10 : null);
const usagePct = (c) => (c.licensed ? Math.round((c.used / c.licensed) * 100) : null);
/** Health signals of one renewal. level: red, yellow or plus (positive). The worst level wins. */
function signals(c, asOf) {
  const out = [], add = (level, key, text) => out.push({ level, key, text });
  const days = daysBetween(asOf, c.decisionDate);
  if (c.status === 'Lapsed') add('yellow', 'lapsed', c.offer ? `Lapsed on ${c.end}; a reactivation offer (${c.offer.id}) is open until ${c.offer.validUntil}` : `Lapsed on ${c.end}; no offer yet, decide whether to win the customer back`);
  else {
    if (days < 0) add('red', 'timing', `Decision date ${c.decisionDate} passed ${-days} days ago: agree the renewal or a written extension now`);
    else if (days <= 30) add(c.autoRenew ? 'yellow' : 'red', 'timing', `Decision date ${c.decisionDate} is in ${days} days${c.autoRenew ? ' (renews automatically unless changed)' : ''}`);
    else if (days <= 90) add('yellow', 'timing', `Decision date ${c.decisionDate} is in ${days} days`);
    if (!c.offer && !c.autoRenew) { if (days <= 30) add('red', 'no-offer', 'No renewal offer yet'); else if (days <= 120) add('yellow', 'no-offer', 'No renewal offer yet'); }
  }
  if (c.offer) {
    const left = daysBetween(asOf, c.offer.validUntil);
    if (c.status !== 'Lapsed' && left <= 14) add('yellow', 'validity', `Offer ${c.offer.id} is valid for ${left} more days`);
    const up = upliftPct(c);
    if (up !== null && up > c.upliftCapPct) add('yellow', 'uplift', `Price rise of ${up} % is above the contract cap of ${c.upliftCapPct} %`);
    if (c.offer.competitor && c.offer.competitor !== 'None') add('yellow', 'competitor', `Competitor in play: ${c.offer.competitor}`);
    if (c.offer.probabilityPct >= 70) add('plus', 'probability', `Offer probability ${c.offer.probabilityPct} %`);
  }
  const use = usagePct(c);
  if (use !== null && c.status !== 'Lapsed') {
    if (use < 60) add('red', 'usage', `Only ${use} % of the ${c.unit} are used: expect a smaller renewal`);
    else if (use < 80) add('yellow', 'usage', `${use} % of the ${c.unit} are used: be ready to right-size`);
    else if (use >= 95) add('plus', 'growth', `${use} % of the ${c.unit} are used: room to sell more`);
  }
  // The trend over the last months: a fall that the snapshot hides, or a fast rise that asks for an expansion.
  const tr = c.usageTrend;
  if (tr && tr.length >= 4 && c.status !== 'Lapsed') {
    const first = tr[0], last = tr[tr.length - 1], months = tr.length - 1;
    if (first - last >= 20) add('yellow', 'trend', `Usage fell from ${first} % to ${last} % in ${months} months${last >= 80 ? ', although it still looks fine today' : ''}`);
    else if (last - first >= 20) add('plus', 'trend-up', `Usage rose from ${first} % to ${last} % in ${months} months: room for an expansion`);
  }
  for (const t of c.tickets) {
    if (t.priority === 'Very high' && t.status !== 'Waiting for customer') add('red', 'ticket', `Very high ticket ${t.id} is open: ${t.title}`);
    else if (t.priority === 'Very high' || t.priority === 'High') add('yellow', 'ticket', `${t.priority} ticket ${t.id} is open (${t.status.toLowerCase()})`);
  }
  for (const i of c.invoices) if (i.status === 'Overdue') add('red', 'invoice', `Invoice ${i.id} is overdue (${eur(i.grossEur)}, due ${i.due})`);
  const order = { red: 0, yellow: 1, plus: 2 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  const health = out.some((s) => s.level === 'red') ? 'red' : out.some((s) => s.level === 'yellow') ? 'yellow' : 'green';
  return { health, signals: out, days };
}
/** The renewal process of the renewal team, in order. `days` are before the decision date (contract end minus notice period). */
const PHASES = [
  { id: 'watch', name: 'Watch', when: 'more than 180 days before the decision date', who: 'Renewal owner, customer success manager', what: 'The contract is on the renewal list and both people are named. Usage, tickets and invoices stay in view; nothing is offered yet.' },
  { id: 'prepare', name: 'Prepare', when: '180 to 120 days before', who: 'Renewal owner with the customer success manager', what: 'Health review: usage against the licence, open tickets, overdue invoices, escalation, competitor. A first talk with the customer about budget, scope changes and who decides.' },
  { id: 'offer', name: 'Offer', when: '120 days before until the offer is sent', who: 'Renewal owner, deal desk', what: 'The renewal offer is built: as it is, hold the contract cap, 3-year commitment, right-sized, or growth. The price is checked against the cap; the deal desk approves discounts; a person approves the offer.' },
  { id: 'negotiate', name: 'Negotiate', when: 'offer sent, before the decision date', who: 'Account executive, customer procurement', what: 'The offer is with the customer: procurement, price benchmark, a competitor, legal terms. Weekly status; the offer validity is watched.' },
  { id: 'decide', name: 'Decide and sign', when: 'on or after the decision date', who: 'Customer, account executive', what: 'The customer signs, or both sides agree an extension in writing, or the contract is allowed to end. After the decision date the renewal is overdue.' },
  { id: 'order', name: 'Order and invoice', when: 'after signing', who: 'Order management, billing', what: 'Renewal order, new term and price, entitlements and invoice. From here the Order-to-Cash process takes over.' },
  { id: 'winback', name: 'Win-back', when: 'the contract has ended', who: 'Account team', what: 'Lapsed contracts: talk to the technical contact, offer an entry price, send a reactivation offer, or close the case.' },
];
/** Which phase a renewal is in. `late` = the offer should already exist but does not. */
function phaseOf(c, asOf, stage) {
  if (c.status === 'Lapsed') return { phase: 'winback', late: false };
  if (stage === 4) return { phase: 'order', late: false };
  const days = daysBetween(asOf, c.decisionDate);
  if (c.offer || stage >= 3) return { phase: days <= 0 ? 'decide' : 'negotiate', late: false };
  if (days > 180) return { phase: 'watch', late: false };
  if (days > 120 && stage < 1) return { phase: 'prepare', late: false };
  return { phase: 'offer', late: days <= 90 };
}
/** Retention probability of a renewal: from its health, or the lapsed value. */
const retention = (c, health, rules) => (c.status === 'Lapsed' ? rules.retention.lapsed : rules.retention[health]);
const lifetimeYears = (p, rules) => Math.min(rules.lifetimeCapYears, Math.round((1 / (1 - Math.min(p, 0.99))) * 10) / 10);
/** Expected customer lifetime value of a product relationship: annual value x margin x expected lifetime in years. */
const clv = (annual, p, rules) => Math.round((annual * (rules.marginPct / 100) * lifetimeYears(p, rules)) / 1000) * 1000;
const roundK = (n) => Math.round(n / 1000) * 1000;
/** Alternative offers for one renewal. Each has an annual value, a term, the price change against today, a retention probability and the expected CLV. */
function options(c, sig, rules) {
  const p0 = retention(c, sig.health, rules), cap = c.upliftCapPct, cur = c.offer ? c.offer.currentAnnualEur : c.annualEur, use = usagePct(c), lapsed = c.status === 'Lapsed';
  const term = c.offer && c.offer.termMonths ? c.offer.termMonths : 12;
  const list = [];
  const add = (key, name, annual, termMonths, dp, why, scope = 1) => { const p = Math.min(0.97, Math.round((p0 + dp) * 100) / 100); list.push({ key, name, annualEur: annual, termMonths, changePct: Math.round((annual / cur - 1) * 1000) / 10, withinCap: (annual / (cur * scope) - 1) * 100 <= cap + 0.5, retentionPct: Math.round(p * 100), clvEur: clv(annual, p, rules), why }); };
  add('standard', c.offer ? 'Renewal as offered' : 'Renewal at the contract cap', c.offer ? c.offer.annualEur : roundK(cur * (1 + cap / 100)), term, 0, c.offer ? 'The offer on the table.' : 'Same scope, price rise limited to the cap.');
  if (c.offer && upliftPct(c) > cap) add('cap', 'Hold the contract cap', roundK(cur * (1 + cap / 100)), term, 0.05, 'Removes the price argument; the rise stays within what the contract allows.');
  add('multi', '3-year commitment with price guarantee', roundK(cur * (1 + Math.min(cap, 2) / 100) * 0.96), 36, 0.05, 'A 4 % discount and a lower rise for a longer term; the customer gets planning security.');
  if (!lapsed && use !== null && use < 85) add('right', 'Right-sized to real usage', roundK(cur * Math.max(0.7, use / 100 + 0.1)), term, 0.1, `Scope follows the ${use} % usage; less value now, a much safer renewal.`, Math.max(0.7, use / 100 + 0.1));
  if (!lapsed && use !== null && use >= 90) add('growth', 'Growth bundle: 10 % more scope', roundK(cur * 1.1), term, 0.03, 'Usage is near the limit; 10 % more scope at the same unit price.', 1.1);
  if (lapsed) add('winback', 'Win-back entry price', roundK(cur * 0.85), 12, 0.2, 'A 12-month entry price to restart the relationship.');
  const best = list.filter((o) => o.withinCap).sort((a, b) => b.clvEur - a.clvEur)[0];
  if (best) best.recommended = true;
  return list;
}
/** Automatic renewal: allowed below the annual value threshold when nothing needs a person. A missing offer and the approaching date are what the automation fixes, so they do not block. */
function autoCheck(c, sig, opts, rules) {
  const blockers = [];
  if (c.annualEur >= rules.autoThresholdEur) blockers.push(`Annual value ${eur(c.annualEur)} is not below ${eur(rules.autoThresholdEur)}`);
  if (c.status === 'Lapsed') blockers.push('Lapsed contract: a person decides about a win-back');
  for (const x of sig.signals) if (x.level !== 'plus' && x.key !== 'timing' && x.key !== 'no-offer') blockers.push(x.text);
  const pick = opts.filter((o) => o.withinCap).sort((a, b) => b.clvEur - a.clvEur)[0];
  if (!pick) blockers.push('No offer stays within the contract cap');
  return { eligible: blockers.length === 0, blockers, pick: pick || null };
}
/** The simulated e-mail the automation sends. */
function autoEmail(c, o) {
  return { to: `${c.csm.toLowerCase().replace(/[^a-z]+/g, '.')}@${c.customerId}.example`, subject: `Your renewal of ${c.product} (${c.contractId})`, body: `Dear ${c.customer} team, your contract ${c.contractId} for ${c.product} ends on ${c.end}. Offer: ${eur(o.annualEur)} a year for ${o.termMonths} months (${o.changePct > 0 ? '+' : ''}${o.changePct} % against today, within the contract cap of ${c.upliftCapPct} %). Reply to this e-mail or contact your account team to confirm.` };
}
/** Customer situation from the contracts of one customer: the use cases escalation, payment, usage and growth. Most serious first. */
function customerSituation(cust, cases) {
  const mine = cases.filter((c) => c.customerId === cust.id), live = mine.filter((c) => c.status !== 'Lapsed');
  const tickets = mine.flatMap((c) => c.tickets.map((t) => ({ ...t, product: c.product })));
  const byPrio = { 'Very high': 0, High: 0, Medium: 0, Low: 0 };
  for (const t of tickets) if (t.priority in byPrio) byPrio[t.priority] += 1;
  const invoices = mine.flatMap((c) => c.invoices.map((i) => ({ ...i, product: c.product })));
  const overdue = invoices.filter((i) => i.status === 'Overdue'), open = invoices.filter((i) => i.status === 'Open');
  const usage = live.filter((c) => usagePct(c) !== null).map((c) => ({ product: c.product, pct: usagePct(c), annualEur: c.annualEur })).sort((a, b) => a.pct - b.pct);
  const low = usage.filter((u) => u.pct < 75), growth = usage.filter((u) => u.pct >= 95);
  const hot = tickets.filter((t) => t.priority === 'Very high');
  const list = [];
  if (cust.escalation || hot.length) list.push({ key: 'escalation', level: 'red', label: 'Escalation', text: cust.escalation ? cust.escalation.topic : `Very high ticket ${hot[0].id} is open` });
  if (overdue.length) list.push({ key: 'payment', level: 'yellow', label: 'Payment issue', text: `${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}, ${overdue.reduce((a, i) => a + i.grossEur, 0)} EUR gross` });
  if (low.length) list.push({ key: 'usage', level: 'yellow', label: 'Low usage', text: `${low.map((u) => u.product + ' ' + u.pct + ' %').join(', ')} used` });
  if (growth.length) list.push({ key: 'growth', level: 'green', label: 'Growth', text: `${growth.length} contract${growth.length === 1 ? '' : 's'} at 95 % use or more` });
  if (!list.length) list.push({ key: 'stable', level: 'green', label: 'Stable', text: 'No escalation, no overdue invoice, usage in range' });
  const talk = list.some((s) => s.key === 'escalation') ? 'Resolve or acknowledge the escalation before any price talk; bring the owner of the open ticket.'
    : list.some((s) => s.key === 'payment') ? 'Clear the overdue invoices with the customer finance team first, then talk about the renewal.'
    : list.some((s) => s.key === 'usage') ? 'Right-size the offer to real usage; a smaller renewal beats a lost one.'
    : list.some((s) => s.key === 'growth') ? 'Use the high usage to offer more volume with the renewal.' : 'Keep the cadence: confirm the renewal dates at the next meeting.';
  return { primary: list[0], list, tickets, byPrio, invoices, overdue, open, usage, low, growth, renewalEur: live.reduce((a, c) => a + c.annualEur, 0), contracts: live.length, talk };
}
/** Retention levers: what to do to keep the customer, taken from the signals. */
function levers(sig, rules) { return [...new Set(sig.signals.filter((s) => s.level !== 'plus').map((s) => rules.levers[s.key]).concat(sig.signals.some((s) => s.key === 'growth') ? [rules.levers.growth] : []).filter(Boolean))].slice(0, 4); }
/** Next actions, most important first (at most three). */
/** The next actions of one renewal as { key, text }. The key is stable (the text may change); the order is the order of importance. */
function actionList(c, sig) {
  const has = (k) => sig.signals.some((s) => s.key === k), list = [], add = (key, text) => list.push({ key, text });
  if (has('invoice')) add('invoice', 'Clear the overdue invoice with finance before the renewal talk');
  if (has('timing') && c.offer && c.status !== 'Lapsed') { if (sig.days < 0) add('extension', 'Agree a written extension and the signing date with the customer'); else add('signing-date', 'Fix the signing date with the customer this week'); }
  if (c.status === 'Lapsed') { if (c.offer) add('winback-follow-up', 'Follow up the reactivation offer with the technical contact'); else add('winback-decide', 'Decide with the account team whether a win-back offer is worth it'); }
  if (has('no-offer')) add('create-offer', 'Create the renewal offer now and send it to the deal desk');
  if (has('competitor')) add('competitor', 'Prepare the answer to the competitor (battlecard) before the next meeting');
  if (has('uplift')) add('uplift', 'Check the price rise against the cap (pricing guard) and explain it with scope or volume');
  if (has('ticket')) add('ticket', 'Get the open ticket solved or give the customer a date');
  if (has('trend')) add('trend', 'Find out why usage is falling: call the business owner and check who the champion is');
  if (has('trend-up') && !has('growth')) add('expand', 'Propose an expansion with the renewal: usage has risen fast');
  if (has('growth')) add('growth', 'Offer more volume in the renewal: usage is close to the limit');
  if (has('usage')) add('right-size', 'Right-size the offer to real usage instead of losing the renewal');
  if (has('validity')) add('validity', 'Extend the offer validity or close before it expires');
  if (!list.length) add('keep-on-track', 'Keep on track: confirm the renewal date at the next customer meeting');
  return list.slice(0, 3);
}
/** The texts of the next actions (what the page shows). */
const actions = (c, sig) => actionList(c, sig).map((a) => a.text);
/** The stable keys of the same actions, in the same order (what the page groups by). */
const actionKeys = (c, sig) => actionList(c, sig).map((a) => a.key);
/* ---------- Autopilot: the whole renewal as steps; the machine does the routine, a person decides at fixed gates ----------
   Pure state machine. A case state is plain data: { mode, step, status, pick, log[], gate }. Nothing here sends, signs or books:
   the page shows what the autopilot did and what waits for a person; the real mail and the order are handed over by the page. */
const AP_STEPS = [
  { id: 'watch', name: 'Watch', by: 'Autopilot' }, { id: 'brief', name: 'Brief', by: 'Autopilot' }, { id: 'offer', name: 'Offer', by: 'Autopilot' },
  { id: 'check', name: 'Policy check', by: 'Autopilot' }, { id: 'approve', name: 'Deal desk', by: 'Person' }, { id: 'send', name: 'Send', by: 'Person' },
  { id: 'negotiate', name: 'Customer', by: 'Customer' }, { id: 'order', name: 'Order', by: 'Autopilot' },
];
const AP_STEP_INDEX = Object.fromEntries(AP_STEPS.map((s, i) => [s.id, i]));
/** What the policy asks a person to look at (empty = within policy). Same rules as autoCheck, but listed as reasons, plus the escalation of the customer. */
function apPolicy(c, sig, opts, rules, pick) {
  const reasons = [];
  if (c.annualEur >= rules.autoThresholdEur) reasons.push(`Annual value ${eur(c.annualEur)} is not below ${eur(rules.autoThresholdEur)}`);
  if (c.status === 'Lapsed') reasons.push('Lapsed contract: a person decides about a win-back');
  for (const x of sig.signals) if (x.level !== 'plus' && x.key !== 'timing' && x.key !== 'no-offer') reasons.push(x.text);
  if (!pick) reasons.push('No offer stays within the contract cap');
  else if (!pick.withinCap) reasons.push(`The chosen offer is above the contract cap (${pick.changePct} %)`);
  return reasons;
}
const apLog = (st, actor, step, text) => ({ ...st, log: [...st.log, { n: st.log.length + 1, actor, step, text }] });
/** Runs the automatic steps from the current one until something waits for a person or for the customer. */
function apRun(st, ctx) {
  const { c, sig, opts, rules, mode } = ctx;
  let s = { ...st };
  for (let guard = 0; guard < 20; guard++) {
    if (s.status !== 'running') return s;
    const id = AP_STEPS[s.step].id;
    if (id === 'watch') { s = apLog(s, 'Autopilot', id, `Decision date ${c.decisionDate} (${sig.days < 0 ? -sig.days + ' days ago' : 'in ' + sig.days + ' days'}), health ${sig.health}, ${sig.signals.filter((x) => x.level !== 'plus').length} warning signal(s).`); s.step++; }
    else if (id === 'brief') { s = apLog(s, 'Autopilot', id, 'Briefing from the signals: ' + (levers(sig, rules).slice(0, 2).join('; ') || 'nothing special, keep the cadence') + '.'); s.step++; }
    else if (id === 'offer') {
      const pick = (s.pick && opts.find((o) => o.key === s.pick)) || opts.filter((o) => o.withinCap).sort((a, b) => b.clvEur - a.clvEur)[0] || opts.find((o) => o.recommended) || opts[0] || null;
      s.pick = pick ? pick.key : null;
      s = apLog(s, 'Autopilot', id, pick ? `Offer built: ${pick.name}, ${eur(pick.annualEur)} a year for ${pick.termMonths} months (${pick.changePct > 0 ? '+' : ''}${pick.changePct} % against today).` : 'No offer could be built.'); s.step++;
    } else if (id === 'check') {
      const pick = opts.find((o) => o.key === s.pick) || null, reasons = apPolicy(c, sig, opts, rules, pick);
      s.reasons = reasons;
      s = apLog(s, 'Autopilot', id, reasons.length ? `Policy check: ${reasons.length} point(s) for a person.` : 'Policy check: within policy, nothing for a person.'); s.step++;
    } else if (id === 'approve') {
      if (s.reasons.length === 0 && mode === 'autopilot') { s = apLog(s, 'Autopilot', id, 'Approved by rule: below the threshold, no warning signal, within the contract cap.'); s.step++; }
      else { s.status = 'waiting-person'; s.gate = 'approve'; return apLog(s, 'Autopilot', id, 'Waiting for the deal desk: ' + (s.reasons.length ? s.reasons[0] : 'supervised mode, every offer is checked') + '.'); }
    } else if (id === 'send') {
      if (s.reasons.length === 0 && mode === 'autopilot') { s = apLog(s, 'Autopilot', id, 'Offer e-mail sent to the customer (simulated).'); s.sent = true; s.step++; }
      else { s.status = 'waiting-person'; s.gate = 'send'; return apLog(s, 'Autopilot', id, 'E-mail to the customer is ready as a draft. Waiting for a person to send it.'); }
    } else if (id === 'negotiate') { s.status = 'waiting-customer'; s.gate = null; return apLog(s, 'Autopilot', id, 'Waiting for the answer of the customer. A reminder follows before the offer expires.'); }
    else if (id === 'order') {
      const pick = opts.find((o) => o.key === s.pick);
      s = apLog(s, 'Autopilot', id, `Signed. The renewal order for Order-to-Cash is prepared: new term ${pick ? pick.termMonths : 12} months, entitlements, invoice.`); s.step++; s.status = 'done'; s.gate = null;
    } else s.step++;
  }
  return s;
}
/** Starts the autopilot for one renewal. mode: 'autopilot' (a person only at exceptions) or 'supervised' (a person approves and sends every offer). */
function apStart(ctx) {
  return apRun({ mode: ctx.mode, step: 0, status: 'running', pick: null, gate: null, reasons: [], sent: false, log: [] }, ctx);
}
/** A person or the customer acts. actions: approve, reject, send, signed, changes, declined, takeover. Returns the new state; an action that does not fit the state changes nothing. */
function apAct(st, action, who, ctx, arg) {
  const person = who || 'A person';
  if (st.status === 'waiting-person' && st.gate === 'approve') {
    if (action === 'approve') return apRun(apLog({ ...st, status: 'running', gate: null, step: AP_STEP_INDEX.send }, person, 'approve', 'Offer approved.'), { ...ctx, mode: st.mode });
    if (action === 'reject') return apLog({ ...st, status: 'stopped', gate: null }, person, 'approve', 'Offer rejected: the case stays with the account executive.');
    if (action === 'change' && arg && ctx.opts.some((o) => o.key === arg)) {
      const o = ctx.opts.find((x) => x.key === arg), pick = o.key;
      const reasons = apPolicy(ctx.c, ctx.sig, ctx.opts, ctx.rules, o);
      return apLog({ ...st, pick, reasons }, person, 'approve', `Offer changed to "${o.name}" (${eur(o.annualEur)}, ${o.changePct > 0 ? '+' : ''}${o.changePct} %). It still needs the approval.`);
    }
  }
  if (st.status === 'waiting-person' && st.gate === 'send') {
    if (action === 'send') return apRun(apLog({ ...st, status: 'running', gate: null, sent: true, step: AP_STEP_INDEX.negotiate }, person, 'send', 'Offer e-mail sent to the customer (simulated).'), { ...ctx, mode: st.mode });
    if (action === 'reject') return apLog({ ...st, status: 'stopped', gate: null }, person, 'send', 'Not sent: the case stays with the account executive.');
  }
  if (st.status === 'waiting-customer') {
    if (action === 'signed') return apRun(apLog({ ...st, status: 'running', step: AP_STEP_INDEX.order }, 'Customer', 'negotiate', 'The customer signed the offer.'), { ...ctx, mode: st.mode });
    if (action === 'changes') return apRun(apLog({ ...st, status: 'running', gate: null, pick: null, step: AP_STEP_INDEX.offer, reasons: [] }, 'Customer', 'negotiate', 'The customer asks for changes. The autopilot prepares the offer again from the options and a person checks it at the deal desk.'), { ...ctx, mode: 'supervised' });
    if (action === 'declined') { const reason = typeof arg === 'string' && WB_REASONS[arg] ? arg : 'unknown'; return apLog({ ...st, status: 'lost', gate: null, reason }, 'Customer', 'negotiate', `The customer declined${reason === 'unknown' ? '' : ' (' + WB_REASONS[reason].toLowerCase() + ')'}. A win-back case is opened for the account team.`); }
  }
  if (action === 'takeover' && (st.status === 'running' || st.status.startsWith('waiting'))) return apLog({ ...st, status: 'stopped', gate: null }, person, AP_STEPS[Math.min(st.step, AP_STEPS.length - 1)].id, 'Taken over by a person: the autopilot stops.');
  return st;
}
/** Counts for the page: how much the autopilot did alone and how much needed a person. */
function apSummary(states) {
  const list = Object.values(states || {}), logs = list.flatMap((s) => s.log);
  const auto = logs.filter((e) => e.actor === 'Autopilot').length, human = logs.filter((e) => e.actor !== 'Autopilot' && e.actor !== 'Customer').length;
  const by = (k) => list.filter((s) => s.status === k).length;
  return { cases: list.length, done: by('done'), person: by('waiting-person'), customer: by('waiting-customer'), stopped: by('stopped'), lost: by('lost'), auto, human, touchless: list.length ? Math.round((list.filter((s) => s.status === 'done' && !s.log.some((e) => e.actor !== 'Autopilot' && e.actor !== 'Customer')).length / list.length) * 100) : 0 };
}
/* ---------- Win-back: a case of its own for a lapsed contract or a declined renewal ----------
   Always with a person: the plan and the first contact need a decision. Same shape as the autopilot state (plain data, a log). */
const WB_STEPS = [
  { id: 'analyse', name: 'Analyse', by: 'Autopilot' }, { id: 'plan', name: 'Plan', by: 'Autopilot' }, { id: 'approve', name: 'Plan approval', by: 'Person' },
  { id: 'reach', name: 'Reach out', by: 'Person' }, { id: 'wait', name: 'Customer', by: 'Customer' }, { id: 'order', name: 'Order', by: 'Autopilot' },
];
const WB_REASONS = { price: 'The price', competitor: 'A competitor', scope: 'The scope does not fit', budget: 'No budget', unknown: 'Not known' };
const WB_INDEX = Object.fromEntries(WB_STEPS.map((s, i) => [s.id, i]));
/** The win-back offer: the entry price of the options if there is one, otherwise 15 % below today for 12 months (shorter and cheaper than a normal renewal). */
function wbOffer(c, opts) {
  const o = opts.find((x) => x.key === 'winback');
  if (o) return o;
  const cur = c.offer ? c.offer.currentAnnualEur : c.annualEur;
  return { key: 'winback', name: 'Win-back entry price', annualEur: roundK(cur * 0.85), termMonths: 12, changePct: -15, withinCap: true };
}
/** What to try, from the reason the customer gave (or the state of the contract). */
function wbPlan(reason) {
  return ({
    price: 'Lead with the entry price and show the value used so far; no further discount without the deal desk.',
    competitor: 'Executive call first, then the battlecard; offer the entry price only as a bridge.',
    scope: 'Offer a smaller scope that matches real usage, then grow it with usage.',
    budget: 'Offer a 12-month entry term and invoice in two parts; revisit the budget in the next planning round.',
  })[reason] || 'Ask the technical contact why the contract ended, then offer the entry price.';
}
const wbLog = (st, actor, step, text) => ({ ...st, log: [...st.log, { n: st.log.length + 1, actor, step, text }] });
function wbRun(st, ctx) {
  const { c, opts } = ctx;
  let s = { ...st };
  for (let guard = 0; guard < 10 && s.status === 'running'; guard++) {
    const id = WB_STEPS[s.step].id;
    if (id === 'analyse') {
      const why = s.reason === 'unknown' ? (c.status === 'Lapsed' ? `The contract ended on ${c.end} without a renewal.` : 'The customer declined without a reason.') : `The customer named a reason: ${WB_REASONS[s.reason]}.`;
      s = wbLog(s, 'Autopilot', id, `${why} Value at stake: ${eur(c.annualEur)} a year.`); s.step++;
    } else if (id === 'plan') {
      const o = wbOffer(c, opts);
      s.offer = { name: o.name, annualEur: o.annualEur, termMonths: o.termMonths, changePct: o.changePct };
      s = wbLog(s, 'Autopilot', id, `Plan: ${wbPlan(s.reason)} Offer: ${o.name}, ${eur(o.annualEur)} a year for ${o.termMonths} months (${o.changePct > 0 ? '+' : ''}${o.changePct} % against today).`); s.step++;
    } else if (id === 'approve') { s.status = 'waiting-person'; s.gate = 'approve'; return wbLog(s, 'Autopilot', id, 'A win-back needs a person: approve the plan and the owner.'); }
    else if (id === 'reach') { s.status = 'waiting-person'; s.gate = 'send'; return wbLog(s, 'Autopilot', id, 'The first message to the customer is ready as a draft. Waiting for a person to send it.'); }
    else if (id === 'wait') { s.status = 'waiting-customer'; s.gate = null; return wbLog(s, 'Autopilot', id, 'Waiting for the answer of the customer. Follow up after 14 days.'); }
    else if (id === 'order') { s = wbLog(s, 'Autopilot', id, `Won back. The renewal order for Order-to-Cash is prepared: ${s.offer.termMonths} months, entitlements, invoice.`); s.step++; s.status = 'done'; s.gate = null; }
    else s.step++;
  }
  return s;
}
/** Starts a win-back. reason: one of WB_REASONS (the customer's reason; unknown for a lapsed contract). */
function wbStart(ctx, reason, owner) {
  return wbRun({ step: 0, status: 'running', gate: null, reason: WB_REASONS[reason] ? reason : 'unknown', owner: owner || ctx.c.owner, offer: null, sent: false, log: [] }, ctx);
}
/** approve (with an owner as arg), reject, send, won, lost, takeover. An action that does not fit changes nothing. */
function wbAct(st, action, who, ctx, arg) {
  const person = who || 'A person';
  if (st.status === 'waiting-person' && st.gate === 'approve') {
    if (action === 'approve') { const owner = typeof arg === 'string' && arg ? arg.slice(0, 60) : st.owner; return wbRun(wbLog({ ...st, status: 'running', gate: null, step: WB_INDEX.reach, owner }, person, 'approve', `Plan approved. Owner of the win-back: ${owner}.`), ctx); }
    if (action === 'reject') return wbLog({ ...st, status: 'stopped', gate: null }, person, 'approve', 'Plan rejected: no win-back for now.');
  }
  if (st.status === 'waiting-person' && st.gate === 'send') {
    if (action === 'send') return wbRun(wbLog({ ...st, status: 'running', gate: null, sent: true, step: WB_INDEX.wait }, person, 'reach', 'Message to the customer sent (simulated).'), ctx);
    if (action === 'reject') return wbLog({ ...st, status: 'stopped', gate: null }, person, 'reach', 'Not sent: the case stays with the owner.');
  }
  if (st.status === 'waiting-customer') {
    if (action === 'won') return wbRun(wbLog({ ...st, status: 'running', step: WB_INDEX.order }, 'Customer', 'wait', 'The customer accepts the win-back offer.'), ctx);
    if (action === 'lost') return wbLog({ ...st, status: 'closed', gate: null }, 'Customer', 'wait', 'The customer stays away. The case is closed; look at it again in six months.');
  }
  if (action === 'takeover' && (st.status === 'running' || st.status.startsWith('waiting'))) return wbLog({ ...st, status: 'stopped', gate: null }, person, WB_STEPS[Math.min(st.step, WB_STEPS.length - 1)].id, 'Taken over by a person: the autopilot stops.');
  return st;
}

/* ---------- wow: what the app found, the rescue plan, the price impact, the weekly briefing ---------- */
const MONTHS_OF = (tr) => tr.length - 1;
const customerOf = (customers, id) => customers.find((x) => x.id === id) || {};
const mailAbout = (customers, c) => ((customerOf(customers, c.customerId).mails) || []).find((m) => m.contractId === c.contractId && m.snippet);
/**
 * What the app found: the few things nobody asked about, each with its evidence. A rule per kind, the same signals the colours use.
 * Three problems (a price trap, falling usage, a missing offer, a lost customer) and one chance (usage that keeps rising). At most two per customer.
 */
function findings(cases, customers, asOf) {
  const out = [];
  for (const c of cases) {
    const cu = customerOf(customers, c.customerId), base = { contractId: c.contractId, id: c.id, customerId: c.customerId, customer: c.customer, product: c.product, eur: c.annualEur };
    if (c.status === 'Lapsed') {
      if (c.offer && c.offer.competitor && c.offer.competitor !== 'None') {
        const m = mailAbout(customers, c);
        out.push({ ...base, key: 'winback', rank: 4, tone: 'amber', headline: 'A lost customer is looking at the way back', text: `${c.product} at ${c.customer} lapsed on ${c.end}. The reactivation offer ${c.offer.id} is open until ${c.offer.validUntil}.`, evidence: [`Competitor in play: ${c.offer.competitor}`, m ? `Customer mail: "${m.snippet}"` : `Offer stage: ${c.offer.stage} (${c.offer.probabilityPct} %)`, `${eur(c.annualEur)} a year if they come back`] });
      }
      continue;
    }
    const sig = signals(c, asOf), has = (k) => sig.signals.some((s) => s.key === k), days = sig.days, up = upliftPct(c), use = usagePct(c), tr = c.usageTrend;
    const trendText = (sig.signals.find((s) => s.key === 'trend' || s.key === 'trend-up') || {}).text;
    if (c.autoRenew && c.offer && up !== null && up > c.upliftCapPct && days >= 0 && days <= 30) {
      const hot = c.tickets.find((t) => t.priority === 'Very high' || t.priority === 'High');
      out.push({ ...base, key: 'trap', rank: 0, tone: 'red', headline: 'Automatic renewal with a price rise above the cap', text: `${c.product} at ${c.customer} renews on its own in ${days} days at +${up} %. The contract cap is ${c.upliftCapPct} %.`,
        evidence: [`Price rise ${up} % against a cap of ${c.upliftCapPct} %`, ...(c.offer.competitor && c.offer.competitor !== 'None' ? [`Competitor in play: ${c.offer.competitor}`] : []), ...(hot ? [`${hot.priority} ticket ${hot.id}: ${hot.title}`] : []), ...(cu.escalation ? [`${cu.escalation.level} escalation since ${cu.escalation.since}`] : [])] });
    } else if (has('trend') && cu.escalation) {
      out.push({ ...base, key: 'dots', rank: 3, tone: 'red', headline: 'Usage is falling while the customer is in escalation', text: `${c.product} at ${c.customer}: ${trendText}. The customer has an open ${cu.escalation.level.toLowerCase()} escalation.`, evidence: [trendText, cu.escalation.topic, `${eur(c.annualEur)} a year, decision ${c.decisionDate}`] });
    } else if (has('trend') && use !== null && use >= 80) {
      const people = (cu.topics || []).find((t) => t.kind === 'people') || (cu.topics || [])[0];
      out.push({ ...base, key: 'hidden', rank: 1, tone: 'amber', headline: 'Looks fine, but usage has been falling', text: `${c.product} at ${c.customer} shows ${use} % usage and no warning today. Over ${MONTHS_OF(tr)} months it fell from ${tr[0]} % to ${tr[tr.length - 1]} %.`, evidence: [trendText, ...(people ? [people.text] : []), 'No ticket and no overdue invoice: nobody would have reported it'] });
    } else if (!c.offer && !c.autoRenew && days >= 0 && days <= 21) {
      const m = mailAbout(customers, c);
      out.push({ ...base, key: 'clock', rank: 2, tone: 'red', headline: `${days} days left and no offer yet`, text: `${c.product} at ${c.customer} (${eur(c.annualEur)} a year) has its decision date on ${c.decisionDate}.`, evidence: ['Without an offer the customer decides without us', ...(m ? [`Customer mail: "${m.snippet}"`] : []), `Contract ends ${c.end}, notice period ${c.noticeDays} days`] });
    } else if (has('trend-up') && use !== null) {
      out.push({ ...base, key: 'expand', rank: 3, tone: 'green', headline: 'Ready for more: usage keeps rising', text: `${c.product} at ${c.customer}: usage rose from ${tr[0]} % to ${tr[tr.length - 1]} % in ${MONTHS_OF(tr)} months. An expansion of about ${eur(roundK(c.annualEur * 0.15))} a year is within reach.`, evidence: [trendText, `${use} % of the ${c.unit} are used`, ...(c.offer ? [`Offer ${c.offer.id}: ${c.offer.stage} (${c.offer.probabilityPct} %)`] : ['No renewal offer yet: put the expansion into it'])] });
    }
  }
  // One finding per kind first (the biggest of each), in the order of the ranks; at most two per customer.
  const sorted = out.filter((x) => x.key !== 'expand').sort((a, b) => a.rank - b.rank || b.eur - a.eur), problems = [], perCustomer = {}, kinds = new Set();
  for (const f of sorted) { if (kinds.has(f.key) || (perCustomer[f.customerId] || 0) >= 2) continue; kinds.add(f.key); perCustomer[f.customerId] = (perCustomer[f.customerId] || 0) + 1; problems.push(f); }
  const chance = out.filter((x) => x.key === 'expand').sort((a, b) => b.eur - a.eur)[0];
  return [...problems.slice(0, 3), ...(chance ? [chance] : [])];
}
/** Signals a plan can clear: a person can solve the ticket, clear the invoice, write the offer, hold the cap. The others (competitor, usage, trend) stay and are worked on. */
const PLAN_CLEARS = ['invoice', 'ticket', 'no-offer', 'uplift', 'validity'];
/**
 * The rescue plan of one renewal: the steps, the colour and the numbers before and after, and a mail draft. Nothing is sent.
 * After the plan the cleared signals are gone and a red date becomes yellow (the signing date is agreed); the rest stays as it is.
 */
function rescuePlan(c, customers, rules, asOf) {
  const sig = signals(c, asOf), keep = [], lapsed = c.status === 'Lapsed';
  // A lapsed contract is not rescued by a price: the offer on the table is a reactivation (often with more scope), the plan is the follow-up.
  for (const s of sig.signals) { if (!lapsed && PLAN_CLEARS.includes(s.key)) continue; keep.push(s.key === 'timing' && s.level === 'red' ? { ...s, level: 'yellow', text: `${s.text} (signing date agreed)` } : s); }
  const afterHealth = keep.some((s) => s.level === 'red') ? 'red' : keep.some((s) => s.level === 'yellow') ? 'yellow' : 'green';
  const cur = c.offer ? c.offer.currentAnnualEur : c.annualEur, cap = c.upliftCapPct, within = roundK(cur * (1 + cap / 100));
  const has = (k) => sig.signals.some((s) => s.key === k);
  // Only a plan that writes an offer changes the price on the table; a renewal with nothing to fix stays as it is.
  const writesOffer = !lapsed && !c.offer && (has('no-offer') || (!c.autoRenew && sig.days <= 60));
  const annualAfter = lapsed ? (c.offer ? c.offer.annualEur : c.annualEur) : c.offer ? (upliftPct(c) > cap ? within : c.offer.annualEur) : writesOffer ? within : c.annualEur;
  const steps = [];
  if (lapsed) steps.push({ key: 'winback', text: c.offer ? `Follow up the reactivation offer ${c.offer.id} with the technical contact before ${c.offer.validUntil}` : 'Decide with the account team whether a win-back offer is worth it' });
  if (has('invoice')) steps.push({ key: 'invoice', text: 'Clear the overdue invoice with the customer finance team (offer a payment plan)' });
  if (has('ticket')) { const t = c.tickets.find((x) => x.priority === 'Very high' || x.priority === 'High') || c.tickets[0]; steps.push({ key: 'ticket', text: `Name an engineer and a date for ticket ${t.id}` }); }
  if (has('uplift') && !lapsed) steps.push({ key: 'uplift', text: `Hold the contract cap: ${eur(annualAfter)} a year (+${cap} %) instead of ${eur(c.offer.annualEur)}` });
  if (writesOffer) steps.push({ key: 'no-offer', text: `Send an offer at the cap today: ${eur(within)} a year` });
  if (has('validity')) steps.push({ key: 'validity', text: 'Extend the offer validity in exchange for a signing date' });
  if (has('timing') && !lapsed) steps.push({ key: 'timing', text: sig.days < 0 ? 'Agree a written extension and the signing date' : 'Fix the signing date with the customer this week' });
  if (has('competitor')) steps.push({ key: 'competitor', text: 'Executive sponsor call with a competitive battlecard' });
  if (has('trend') || has('usage')) steps.push({ key: 'usage', text: 'Call the business owner: why is usage falling, and who is the champion now?' });
  if (!steps.length) steps.push({ key: 'keep', text: 'Keep on track: confirm the renewal date at the next customer meeting' });
  // The colour decides the retention; when the colour stays the same but signals were cleared, each cleared signal adds two points (an assumption, said on the page).
  const cleared = lapsed ? 0 : sig.signals.filter((x) => PLAN_CLEARS.includes(x.key)).length;
  const pBefore = retention(c, sig.health, rules), pAfter = lapsed ? pBefore : Math.min(0.97, retention(c, afterHealth, rules) + (afterHealth === sig.health ? 0.02 * cleared : 0));
  const make = (health, p, annual) => ({ health, retentionPct: Math.round(p * 100), expectedEur: Math.round(annual * p), clvEur: clv(annual, p, rules) });
  const before = make(sig.health, pBefore, c.offer ? c.offer.annualEur : c.annualEur), after = make(afterHealth, pAfter, annualAfter);
  const mail = rescueMail(c, steps, annualAfter, within, customers);
  return { steps, before, after, gainEur: after.expectedEur - before.expectedEur, remaining: keep.filter((s) => s.level !== 'plus').map((s) => s.text), mail };
}
/** The mail draft that goes with a plan (to the customer's owner, from the account executive). Never sent. */
function rescueMail(c, steps, annualAfter, within, customers) {
  const cu = customerOf(customers, c.customerId), keys = steps.map((s) => s.key), lines = [];
  lines.push(`Dear ${c.customerOwner},`, '', `about the renewal of ${c.product} (${c.contractId}), which ends on ${c.end}: here is what we do on our side, and what we ask of you.`, '');
  if (keys.includes('ticket')) { const t = c.tickets.find((x) => x.priority === 'Very high' || x.priority === 'High') || c.tickets[0]; lines.push(`- Ticket ${t.id} ("${t.title}"): a named engineer works on it, and you get a date from us by the end of this week.`); }
  if (keys.includes('invoice')) lines.push('- The open invoice: we are happy to agree a payment plan with your finance team, so that it does not stand in the way of the renewal.');
  if (keys.includes('uplift')) lines.push(`- Price: we hold the contract cap. The renewal is ${eur(annualAfter)} a year (+${c.upliftCapPct} % against today) and not more.`);
  if (keys.includes('no-offer')) lines.push(`- Offer: you receive our offer today, ${eur(within)} a year, within the contract cap of ${c.upliftCapPct} %.`);
  if (keys.includes('validity')) lines.push('- The offer stays valid until we have agreed a signing date.');
  if (keys.includes('usage')) lines.push('- Usage: let us look together at how your teams work with it today, and who owns it after the changes.');
  if (keys.includes('competitor')) lines.push('- We would like to show you in a short session why the renewal is the safer and cheaper way for you.');
  lines.push('', `Could we agree the signing date by ${c.decisionDate}?`, '', `Kind regards,`, c.owner);
  return { to: `${(c.customerOwner || 'customer').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.+|\.+$/g, '')}@${c.customerId}.example`, subject: `Your renewal of ${c.product} (${c.contractId}): our next steps`, body: lines.join('\n') };
}
/**
 * What a price rise does to the renewal: the retention probability falls a little with every percent, faster above the contract cap, and faster still with a competitor.
 * The base is the colour of the renewal without its price signal. An assumption, shown as such on the page.
 */
function priceImpact(c, rules, asOf, upliftPctValue) {
  const sig = signals(c, asOf), rest = sig.signals.filter((s) => s.key !== 'uplift');
  const health = rest.some((s) => s.level === 'red') ? 'red' : rest.some((s) => s.level === 'yellow') ? 'yellow' : 'green';
  const cur = c.offer ? c.offer.currentAnnualEur : c.annualEur, cap = c.upliftCapPct, u = Math.max(0, upliftPctValue);
  const competitor = !!(c.offer && c.offer.competitor && c.offer.competitor !== 'None');
  const over = Math.max(0, u - cap);
  const base = retention(c, health, rules);
  const p = Math.max(0.2, Math.min(0.97, base - 0.003 * u - (competitor ? 0.022 : 0.012) * over));
  const annual = roundK(cur * (1 + u / 100));
  return { upliftPct: u, annualEur: annual, retentionPct: Math.round(p * 100), expectedEur: Math.round(annual * p), clvEur: clv(annual, p, rules), withinCap: u <= cap + 0.05, overCap: Math.round(over * 10) / 10, deltaEur: Math.round(annual * p - cur * base) };
}
/** The rise (0 to 12 %, steps of half a percent) with the highest expected value a year. */
function bestPrice(c, rules, asOf) {
  let best = null;
  for (let u = 0; u <= 12; u += 0.5) { const r = priceImpact(c, rules, asOf, u); if (!best || r.expectedEur > best.expectedEur) best = r; }
  return best;
}
/** One sentence for the week and the mail for the sales manager. The numbers are those of the cases, nothing else. */
function weeklyBriefing(cases, customers, asOf, rules) {
  const live = cases.filter((c) => c.status !== 'Lapsed').map((c) => ({ c, sig: signals(c, asOf) }));
  const stake = live.reduce((a, x) => a + x.c.annualEur, 0), six = live.filter((x) => x.sig.days <= 42), red = live.filter((x) => x.sig.health === 'red'), now = live.filter((x) => x.sig.health === 'red' || x.sig.days <= 14);
  const atRisk = Math.round(live.reduce((a, x) => a + x.c.annualEur * (1 - retention(x.c, x.sig.health, rules)), 0));
  const found = findings(cases, customers, asOf);
  const headline = `${eur(stake)} a year are at stake. ${six.length} decisions fall within six weeks, ${red.length} are red, and ${now.length} need you now.`;
  const top = red.sort((a, b) => b.c.annualEur - a.c.annualEur).slice(0, 3).map((x) => `- ${x.c.customer}, ${x.c.product}: ${eur(x.c.annualEur)} a year, decision ${x.sig.days < 0 ? 'passed ' + -x.sig.days + ' days ago' : 'in ' + x.sig.days + ' days'}. First: ${actions(x.c, x.sig)[0]}`);
  const body = ['Hello,', '', `renewals this week: ${headline}`, `Expected loss over the next year at today's colours: ${eur(atRisk)} (assumption: retention by colour).`, '', 'The three biggest red renewals:', ...top, '', 'What the app found that nobody asked for:', ...found.map((f) => `- ${f.headline}: ${f.customer}, ${f.product}.`), '', 'Kind regards'].join('\n');
  return { headline, stakeEur: stake, sixWeeks: six.length, redCount: red.length, needNow: now.length, atRiskEur: atRisk, mail: { to: 'sales.manager@sap.example', subject: `Renewals this week: ${eur(stake)} at stake, ${red.length} red`, body } };
}

