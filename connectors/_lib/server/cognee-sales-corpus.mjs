/**
 * Turns the data of the Sales Space (examples/sales/pipeline.json) into plain-text documents for Cognee:
 * one document per deal, customer, competitor and skill, every fact a sentence, identifiers in brackets
 * (deal:OFF-2026-0324), the same convention as the other corpora. The links Cognee extracts are the ones the
 * Knowledge tab draws: deal to customer, contact, offer, call, mail thread, competitor, risk, next skill, meeting, ticket.
 * Pure; nothing here needs Cognee or the network.
 */
const sentence = (t) => `${String(t).replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '')}.`;
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ref = { deal: (id) => `deal:${id}`, account: (n) => `account:${slug(n)}`, rival: (n) => `competitor:${slug(n)}`, skill: (id) => `skill:${id}`, call: (id) => `call:${id}`, thread: (id) => `thread:${id}`, ticket: (id) => `ticket:${id}` };
const eur = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')} million EUR` : `${Math.round(n / 1000)} thousand EUR`);

/** @returns {{ id: string, name: string, text: string }[]} */
export function salesDocuments(data) {
  const docs = new Map();
  const doc = (id, name) => docs.get(id) ?? docs.set(id, { id, name, lines: [] }).get(id);
  const add = (id, name, text) => { if (text) doc(id, name).lines.push(sentence(text)); };
  const stages = Object.fromEntries((data.stages ?? []).map((s) => [s.id, s]));
  const custId = Object.fromEntries((data.sub4me?.customers ?? []).map((n) => [n, slug(n).split('-')[0]]));

  for (const d of data.deals ?? []) {
    const id = ref.deal(d.id), name = `Deal ${d.id}`, acc = ref.account(d.account), st = stages[d.stage];
    add(id, name, `${name} (${id}) is the sales deal "${d.title}" of ${d.account} (${acc}) in stage ${st?.label ?? d.stage}`);
    add(id, name, has(d.value) && `${name}: annual contract value is ${eur(d.value)}${has(d.score) ? ` and the win probability is ${d.score} percent` : ''}`);
    add(id, name, has(d.owner) && `${name}: owner is ${d.owner}`);
    add(id, name, has(d.contact) && `${name}: customer contact is ${d.contact}`);
    add(id, name, has(d.offerId) && `${name} is based on offer ${d.offerId}`);
    add(id, name, has(d.contractId) && `${name} concerns contract ${d.contractId}`);
    add(id, name, has(d.approval) && `${name}: approval status is ${d.approval}`);
    add(id, name, has(d.competitor) && `${name} competes with ${d.competitor.replace(/\s*\(.*\)$/, '')} (${ref.rival(d.competitor.replace(/\s*\(.*\)$/, ''))})${/\(/.test(d.competitor) ? ` - ${d.competitor.replace(/^.*\(|\)$/g, '')}` : ''}`);
    for (const c of d.links?.calls ?? []) add(id, name, `${name} is linked to call transcript ${c} (${ref.call(c)})`);
    for (const t of d.links?.threads ?? []) add(id, name, `${name} is linked to e-mail thread ${t} (${ref.thread(t)})`);
    (d.risks ?? []).forEach((r) => add(id, name, `${name} has a risk: ${r}`));
    if (d.next) add(id, name, `${name}: next step is "${d.next.text}", due ${d.next.due}, with skill ${d.next.skill} (${ref.skill(d.next.skill)})`);
    for (const m of (data.meetings ?? []).filter((x) => x.dealId === d.id)) add(id, name, `${name} has the meeting "${m.title}" on ${m.date}`);

    add(acc, d.account, `${d.account} (${acc}) is a customer`);
    add(acc, d.account, `${d.account} has ${name} (${id}), ${d.title}, in stage ${st?.label ?? d.stage}`);
    if (d.competitor) { const rn = d.competitor.replace(/\s*\(.*\)$/, ''); add(ref.rival(rn), rn, `${rn} (${ref.rival(rn)}) is a competitor`); add(ref.rival(rn), rn, `${rn} competes in ${name} (${id}) at ${d.account} (${acc})`); }
    if (d.next) { add(ref.skill(d.next.skill), d.next.skill, `${d.next.skill} (${ref.skill(d.next.skill)}) is a skill`); add(ref.skill(d.next.skill), d.next.skill, `${d.next.skill} is the next step of ${name} (${id})`); }
    const key = custId[d.account];
    for (const t of (data.sub4me?.tickets ?? []).filter((x) => x.customer === key)) {
      add(id, name, `${d.account} has the open ticket ${t.id} (${ref.ticket(t.id)}): ${t.title}, priority ${t.priority}`);
    }
  }
  return [...docs.values()].map((x) => ({ id: x.id, name: x.name, text: x.lines.join('\n') }));
}
