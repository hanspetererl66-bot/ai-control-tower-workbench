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
