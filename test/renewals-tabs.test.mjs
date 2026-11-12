import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/renewals/index.html'), 'utf8');
const data = JSON.parse(/<script type="application\/json" id="renewal-data">\s*([\s\S]*?)<\/script>/.exec(html)[1]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollIntoView/.test(m)) errors.push(m); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/', beforeParse(w) { w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; w.HTMLElement.prototype.scrollIntoView = () => {}; } });
  await wait(120);
  const w = dom.window, d = w.document;
  return { w, d, q: (s) => d.querySelector(s), qa: (s) => [...d.querySelectorAll(s)], errors, visible: () => [...d.querySelectorAll('.pg')].filter((p) => !p.hidden).map((p) => p.id) };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

test('renewals: five tabs, the overview is the start page, only one panel is shown', async () => {
  const p = await open();
  assert.deepEqual(p.qa('#tabs [role=tab]').map((b) => b.textContent), ['Today', 'Renewal process', 'Next best action', 'Renewal radar', 'By decision date']);
  assert.deepEqual(p.visible(), ['pg-overview']);
  for (const [id, pg] of [['nba', 'pg-nba'], ['radar', 'pg-radar'], ['list', 'pg-list'], ['process', 'pg-process'], ['overview', 'pg-overview']]) { click(p.w, p.q('#tab-' + id)); assert.deepEqual(p.visible(), [pg], id); assert.equal(p.q('#tab-' + id).getAttribute('aria-selected'), 'true'); }
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals today: the time line shows the late and the upcoming decisions of the next six weeks and nothing else; the list is gone', async () => {
  const p = await open();
  const model = p.w.__renewals(), asOf = Date.UTC(2026, 9, 19);
  const days = (c) => Math.round((Date.UTC(+c.decisionDate.slice(0, 4), +c.decisionDate.slice(5, 7) - 1, +c.decisionDate.slice(8, 10)) - asOf) / 864e5);
  const expected = Array.from(model.filter((c) => c.status !== 'Lapsed' && c.stage < 4 && days(c) <= 42), (c) => c.id).sort();
  assert.ok(expected.length >= 4, 'the sample has renewals in the window');
  assert.equal(p.qa('#six .srow').length, 0, 'no list of rows any more');
  assert.deepEqual(p.qa('#six .rdot').map((b) => b.dataset.id).sort(), expected, 'one dot per renewal in the window');
  assert.equal(p.qa('#six .rpast .rdot').length, model.filter((c) => c.status !== 'Lapsed' && days(c) < 0).length, 'late renewals sit in the passed lane');
  // the customer context narrows the time line
  const sel = p.q('#customer'); sel.value = 'lindenau'; sel.dispatchEvent(new p.w.Event('change'));
  assert.deepEqual(p.qa('#six .rdot').map((b) => b.dataset.id).sort(), Array.from(model.filter((c) => c.customerId === 'lindenau' && expected.includes(c.id)), (c) => c.id).sort());
  p.w.close();
});

test('renewals today: three numbers first, the other four compact, then time line, grouped cards and the landscape', async () => {
  const p = await open();
  const model = p.w.__renewals(), live = model.filter((c) => c.status !== 'Lapsed' && c.stage < 4);
  const eur = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const sum = (l) => l.reduce((a, c) => a + c.annualEur, 0), val = (k) => p.q(`.kpi[data-k="${k}"] .v`).textContent;
  assert.deepEqual(p.qa('#kpis .kpis.primary .kpi').map((b) => b.dataset.k), ['need', 'due', 'red']);
  assert.deepEqual(p.qa('#kpis .kpis.second .kpi').map((b) => b.dataset.k), ['ret', 'clv', 'auto', 'signed']);
  const need = live.filter((c) => !c.autoRun && (c.health === 'red' || c.sig.days <= 14));
  assert.equal(val('need'), String(need.length));
  assert.equal(val('due'), eur(sum(live.filter((c) => c.sig.days <= 14))));
  assert.equal(val('red'), eur(sum(live.filter((c) => c.health === 'red'))));
  assert.ok(need.length > 0 && need.length < live.length, 'the number says something');
  // the cards are the grouped queue
  const keys = [...new Set(live.filter((c) => !c.autoRun).map((c) => c.actionKeys[0]))];
  assert.equal(p.qa('#today-groups .qgrp').length, keys.length);
  assert.equal(p.qa('#today-groups .qrow').length, live.filter((c) => !c.autoRun).length);
  // order on the page: numbers, time line, cards, landscape
  const order = ['#kpis', '#six', '#today-groups', '#land'].map((s) => p.q(s));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1].compareDocumentPosition(order[i]) & p.w.Node.DOCUMENT_POSITION_FOLLOWING, `${i}`);
  // double-click on a number opens the renewals behind it
  p.q('.kpi[data-k="need"]').dispatchEvent(new p.w.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(p.qa('#kpi-detail tbody tr').length, need.length);
  // a card opened here is the same card in the action queue tab (shared state)
  const head = p.qa('#today-groups .qhead')[1]; click(p.w, head);
  click(p.w, p.q('#tab-nba'));
  assert.equal(p.qa('#queue .qhead')[1].getAttribute('aria-expanded'), 'true');
  assert.ok(new Set(p.qa('[id]').map((e) => e.id)).size === p.qa('[id]').length, 'no element id twice');
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals overview: every customer is a planet and every contract a dot; a click opens the customer or the renewal', async () => {
  const p = await open();
  assert.equal(p.qa('#land .planet').length, data.customers.length);
  assert.equal(p.qa('#land .moon').length, data.cases.length);
  click(p.w, p.qa('#land .moon')[0]);
  assert.deepEqual(p.visible(), ['pg-list']);
  assert.ok(p.w.__state.sel);
  click(p.w, p.q('#tab-overview'));
  click(p.w, p.qa('#land .planet')[1]);
  assert.deepEqual(p.visible(), ['pg-process']);
  assert.equal(p.w.__state.customer, data.customers[1].id);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals process: the customer map, the four standing tiles and the details with the e-mails belong to the chosen customer', async () => {
  const p = await open();
  click(p.w, p.q('#tab-process'));
  assert.equal(p.qa('#cust-cards .ccard').length, data.customers.length, 'without a customer the three customers can be chosen');
  assert.equal(p.q('#cmap-wrap').hidden, true);
  for (const cu of data.customers) {
    const sel = p.q('#customer'); sel.value = cu.id; sel.dispatchEvent(new p.w.Event('change'));
    const mine = data.cases.filter((c) => c.customerId === cu.id);
    assert.equal(p.q('#cmap-wrap').hidden, false);
    assert.equal(p.qa('#cmap .cnode').length, mine.length, `${cu.id}: one node per contract`);
    assert.equal(p.qa('#stand .stile').length, 4, 'tickets, invoices, usage, growth');
    assert.deepEqual(p.qa('#stand .stile').map((b) => b.dataset.focus), ['ticket', 'invoice', 'usage', 'growth']);
    assert.match(p.q('#cust-panel h2').textContent, new RegExp(cu.name.split(' ')[0]));
    assert.ok(p.q('#cust-panel .mtl, #cust-panel .sub'), 'e-mail communication in the details');
    assert.equal(p.q('#cmap h2').textContent.includes(cu.name), true);
  }
  // a contract is picked: its details and its phase come up, the full details open on request
  const node = p.qa('#cmap .cnode')[0]; click(p.w, node);
  assert.equal(p.w.__state.csel, node.dataset.id);
  assert.ok(p.q('#cust-panel .cmini'));
  assert.equal(p.qa('#process .ph.here').length, 1, 'the phase of the picked contract is marked');
  p.q('#stand .stile[data-focus=ticket]').click();
  assert.equal(p.w.__state.focus, 'ticket');
  p.q('#cm-open').click();
  assert.deepEqual(p.visible(), ['pg-list']);
  assert.equal(p.w.__state.sel, node.dataset.id);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals: next best action queue, radar and list follow the customer; the demo opens the right tab at every step', async () => {
  const p = await open();
  const model = p.w.__renewals();
  click(p.w, p.q('#tab-nba'));
  const all = p.qa('#queue .qrow').length;
  assert.equal(all, model.filter((c) => c.status !== 'Lapsed' && c.stage < 4 && !c.autoRun).length);
  const sel = p.q('#customer'); sel.value = 'hanse'; sel.dispatchEvent(new p.w.Event('change'));
  assert.equal(p.qa('#queue .qrow').length, model.filter((c) => c.customerId === 'hanse' && c.status !== 'Lapsed' && c.stage < 4 && !c.autoRun).length);
  click(p.w, p.q('#tab-list'));
  assert.ok(p.qa('#rows tr').every((tr) => /Hanse/.test(tr.textContent)));
  p.q('#reset').click();
  assert.deepEqual(p.visible(), ['pg-overview'], 'reset starts at the overview');
  p.q('#g-start').click();
  const seen = [];
  for (let i = 0; i < 10; i++) { seen.push(p.visible()[0]); assert.ok(p.q('.spot'), `step ${i + 1} outlines its place`); const next = p.q('#g-next'); if (i < 9) next.click(); }
  assert.deepEqual(seen, ['pg-overview', 'pg-process', 'pg-process', 'pg-radar', 'pg-list', 'pg-list', 'pg-list', 'pg-list', 'pg-overview', 'pg-list']);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals motion: entrance runs once per picture, with reduced motion nothing animates, colours are tokens, no network', () => {
  assert.match(html, /const enter = \(key\) => \{ if \(REDUCED \|\| played\[key\]\) return ''; played\[key\] = true; return ' enter'; \};/);
  assert.match(html, /prefers-reduced-motion:reduce\)\{\.pg:not\(\[hidden\]\)\{animation:none\}/);
  const css = html.slice(html.indexOf('/* ---- Tabs and customer context'), html.indexOf('</style>', html.indexOf('/* ---- Tabs and customer context')));
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b|rgba?\(/, 'only tokens in the new styles');
  assert.doesNotMatch(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});

test('renewals journey: the rail names the customer, a hand-over from Sales opens the renewal of the contract, stops in other Spaces hand over with the deal', async () => {
  const p = await open();
  const sent = [];
  Object.defineProperty(p.w, 'parent', { value: { postMessage: (m) => sent.push(m) } });
  assert.equal(p.q('.jr-who b').textContent, 'Lindenau Pharma AG');
  assert.equal(p.q('.jr button[aria-current=true]').textContent, 'Renewals due');
  p.w.dispatchEvent(new p.w.MessageEvent('message', { data: { type: 'wb:restore', state: null, handoffs: [{ from: 'sales', payload: { journey: { customer: 'lindenau', step: 'decide', deal: 'C-2026-0051' } } }, { payload: { journey: { customer: 'evil', deal: 'C-2026-0051' } } }, { payload: { journey: { customer: 'nordlicht', step: 'decide' } } }] }, source: p.w.parent }));
  assert.deepEqual(p.visible(), ['pg-list']);
  assert.equal(p.w.__state.customer, 'lindenau');
  assert.equal(p.w.__state.sel, 'R-C-2026-0051', 'the renewal of the contract (deal id) opens');
  click(p.w, p.q('.jr button[data-jr-stop=renewal-actions]'));
  assert.deepEqual(p.visible(), ['pg-nba']);
  click(p.w, p.q('.jr button[data-jr-stop=pipeline]'));
  click(p.w, p.q('.jr button[data-jr-stop=mails]'));
  assert.deepEqual(sent.filter((m) => m.type === 'wb:handoff').map((m) => [m.to, m.payload.journey.customer, m.payload.journey.deal]), [['sales', 'lindenau', 'C-2026-0051'], ['customer-emails', 'lindenau', 'C-2026-0051']]);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals: Joule does not mark a renewal as prepared, the person does; the lifetime value is marked as an assumption', async () => {
  const p = await open();
  const id = p.w.__renewals().find((c) => c.stage === 0 && c.status !== 'Lapsed').id;
  click(p.w, p.q('#tab-list'));
  const row = p.q('#rows tr[data-id="' + id + '"]'); click(p.w, row);
  assert.equal(p.q('#detail [data-act="prep"]').textContent, 'Ask Joule to prepare');
  click(p.w, p.q('#detail [data-act="prep"]'));
  assert.equal(p.w.__renewals().find((c) => c.id === id).stage, 0, 'asking Joule changes nothing');
  assert.ok(p.q('#detail [data-act="prepared"]'), 'the person can mark it');
  click(p.w, p.q('#detail [data-act="prepared"]'));
  assert.equal(p.w.__renewals().find((c) => c.id === id).stage, 1);
  click(p.w, p.q('#tab-overview'));
  const clv = p.q('.kpi[data-k="clv"]');
  assert.ok(clv.classList.contains('assumed') && /assumption/i.test(clv.textContent) && /not a forecast/.test(clv.textContent));
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals: the journey strip follows the chosen scope, All customers shows the totals', async () => {
  const p = await open();
  const live = p.w.__renewals().filter((c) => c.status !== 'Lapsed' && c.stage < 4);
  const eur = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  assert.equal(p.w.__state.customer, 'all');
  const strip = p.q('#jr').textContent;
  assert.match(strip, /All customers: renewals at stake/);
  assert.ok(strip.includes(eur(live.reduce((a, c) => a + c.annualEur, 0))));
  p.w.close();
});

test('renewals: the manager view hands over to the Renewal Analytics Space', async () => {
  const p = await open();
  const sent = [];
  Object.defineProperty(p.w, 'parent', { value: { postMessage: (m) => sent.push(m) }, configurable: true });
  click(p.w, p.q('#to-analytics'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'wb:handoff');
  assert.equal(sent[0].to, 'renewals-analytics');
  p.w.close();
});

test('renewals state: the page reports its working state to the host and takes it back after a Space switch', async () => {
  const hosted = async () => { const p = await open(); const sent = []; Object.defineProperty(p.w, 'parent', { value: { postMessage: (m) => sent.push(m) } }); return { p, sent }; };
  const restore = (p, state, handoffs = []) => p.w.dispatchEvent(new p.w.MessageEvent('message', { data: { type: 'wb:restore', state, handoffs }, source: p.w.parent }));

  // outside the app nothing is sent
  const alone = await open();
  click(alone.w, alone.q('#tab-list'));
  assert.equal(alone.w.parent, alone.w, 'a page outside the app is its own parent');
  alone.w.close();

  const a = await hosted();
  const id = a.p.w.__renewals().find((c) => c.stage === 0 && c.status !== 'Lapsed' && c.customerId === 'hanse').id;
  a.p.w.__state.customer = 'hanse'; click(a.p.w, a.p.q('#tab-list'));
  click(a.p.w, a.p.q(`#rows tr[data-id="${id}"]`));
  click(a.p.w, a.p.q('#detail [data-act="prep"]'));
  click(a.p.w, a.p.q('#detail [data-act="prepared"]'));
  const states = a.sent.filter((m) => m.type === 'wb:state');
  assert.ok(states.length > 0, 'the page reports its state');
  const saved = JSON.parse(JSON.stringify(states.at(-1).state));
  assert.ok(JSON.stringify(saved).length < 20_000, 'small enough for the host');
  assert.equal(saved.tab, 'list'); assert.equal(saved.sel, id); assert.equal(saved.stage[id], 1);
  assert.equal(saved.customer, 'hanse');
  a.p.w.close();

  // a fresh page (the Space was left and opened again) takes the state back
  const b = await hosted();
  assert.equal(b.p.w.__state.tab, 'overview');
  restore(b.p, saved);
  assert.deepEqual(b.p.visible(), ['pg-list']);
  assert.equal(b.p.w.__state.customer, 'hanse'); assert.equal(b.p.q('#customer').value, 'hanse');
  assert.equal(b.p.w.__state.sel, id);
  assert.equal(b.p.w.__renewals().find((c) => c.id === id).stage, 1, 'the stage "prepared by you" is back');
  assert.deepEqual(b.p.errors, []);
  b.p.w.close();

  // a hand-over that comes with the state wins for tab, customer and deal
  const c = await hosted();
  restore(c.p, saved, [{ from: 'renewals-analytics', payload: { journey: { customer: 'muster', step: 'decide', tab: 'nba' } } }]);
  assert.equal(c.p.w.__state.customer, 'muster'); assert.deepEqual(c.p.visible(), ['pg-nba']);
  assert.equal(c.p.w.__renewals().find((x) => x.id === id).stage, 1, 'the stage still comes from the saved state');
  c.p.w.close();

  // a damaged state is not trusted
  const d = await hosted();
  restore(d.p, { tab: 'secret', customer: 'evil', status: 'x', phase: 'nope', sel: 'R-none', stage: { [id]: 99, 'R-none': 1 }, option: { [id]: '<script>' }, asked: { [id]: 'yes' }, auto: 'true', jr: 'nordlicht' });
  assert.equal(d.p.w.__state.tab, 'overview'); assert.equal(d.p.w.__state.customer, 'all'); assert.equal(d.p.w.__state.sel, null);
  assert.deepEqual({ ...d.p.w.__state.stage }, {}); assert.deepEqual({ ...d.p.w.__state.option }, {}); assert.deepEqual({ ...d.p.w.__state.asked }, {});
  assert.equal(d.p.w.__state.auto, false);
  assert.deepEqual(d.p.errors, []);
  d.p.w.close();
});

test('renewals action queue: one card per first action, most urgent first, the renewals behind it, one Joule prompt per group', async () => {
  const hosted = async () => { const p = await open(); const sent = []; Object.defineProperty(p.w, 'parent', { value: { postMessage: (m) => sent.push(m) } }); return { p, sent }; };
  const { p, sent } = await hosted();
  const model = p.w.__renewals(), open_ = model.filter((c) => c.status !== 'Lapsed' && c.stage < 4 && !c.autoRun);
  click(p.w, p.q('#tab-nba'));
  const cards = p.qa('#queue .qgrp');
  const keys = [...new Set(open_.map((c) => c.actionKeys[0]))];
  assert.equal(cards.length, keys.length, 'one card per first action');
  assert.ok(cards.length < open_.length, 'grouping shortens the list');
  assert.equal(p.qa('#queue .qrow').length, open_.length, 'every renewal is behind exactly one card');
  const order = cards.map((c) => c.className.match(/\b(red|yellow|green)\b/)[1]), rank = { red: 0, yellow: 1, green: 2 };
  assert.deepEqual(order, [...order].sort((a, b) => rank[a] - rank[b]), 'red before yellow before green');
  // the first card is open, the others are closed and their rows hidden
  assert.equal(p.qa('#queue .qhead')[0].getAttribute('aria-expanded'), 'true');
  assert.equal(p.qa('#queue .qhead')[1].getAttribute('aria-expanded'), 'false');
  assert.equal(p.q('#queue .qbody[hidden]') !== null, true);
  click(p.w, p.qa('#queue .qhead')[1]);
  assert.equal(p.qa('#queue .qhead')[1].getAttribute('aria-expanded'), 'true');
  assert.ok(sent.filter((m) => m.type === 'wb:state').at(-1).state.groups, 'the open cards are part of the saved state');
  // each row names up to two reasons, not only the action
  const row = p.q('#queue .qrow'), small = row.querySelector('small').textContent;
  assert.ok(small.length > 10 && small.split(' · ').length <= 3, small);
  // the prompt: for the whole group, within the bridge limit, nothing is sent by the page
  const btn = p.qa('#queue [data-gask]')[0], group = open_.filter((c) => c.actionKeys[0] === btn.dataset.gask);
  click(p.w, btn);
  const ask = sent.filter((m) => m.type === 'wb:ask').at(-1).prompt;
  assert.ok(ask.length <= 600 && /customer-call-prep/.test(ask) && new RegExp(`${group.length} renewals`).test(ask));
  assert.match(btn.textContent, new RegExp(`all ${group.length}$`));
  assert.ok(!sent.some((m) => m.type === 'wb:handoff'), 'asking Joule hands nothing over');
  // a row still opens its renewal
  click(p.w, p.q('#queue .qrow'));
  assert.ok(p.w.__state.sel, 'a click on a row opens the renewal');
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test('renewals action queue: a long group prompt ends with "and N more" and stays within 600 characters', async () => {
  const p = await open();
  const sent = []; Object.defineProperty(p.w, 'parent', { value: { postMessage: (m) => sent.push(m) } });
  click(p.w, p.q('#tab-nba'));
  const biggest = p.qa('#queue [data-gask]')[0];
  const model = p.w.__renewals();
  const first = model.find((c) => c.actionKeys[0] === biggest.dataset.gask);
  // use the real page function with a made-up group of 30 renewals
  const g = { text: 'Create the renewal offer now and send it to the deal desk', items: Array.from({ length: 30 }, (_, i) => ({ ...first, id: 'x' + i })) };
  const prompt = p.w.__groupPrompt(g);
  assert.ok(prompt.length <= 600, String(prompt.length));
  assert.match(prompt, /and \d+ more\. Use the skill/);
  assert.match(prompt, /30 renewals/);
  p.w.close();
});
