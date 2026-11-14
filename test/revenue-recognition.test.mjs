import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rr = fs.readFileSync('examples/revenue-recognition/index.html', 'utf8');
const o2c = fs.readFileSync('examples/order-to-cash-software/index.html', 'utf8');
const data = JSON.parse(fs.readFileSync('examples/revenue-recognition/data.json', 'utf8'));
const core = (h) => h.slice(h.indexOf('// @core-start'), h.indexOf('// @core-end'));
const L = new Function(rr.slice(rr.indexOf('// @logic-start'), rr.indexOf('// @logic-end')) + '; return makeLogic;')()(data);

test('the page embeds its data, has no intro box, and is registered', () => {
  const m = rr.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  assert.deepEqual(JSON.parse(m[1]), data);
  assert.doesNotMatch(rr, /<details class="intro"/);
  assert.equal(data.title, 'Revenue Recognition');
  const space = JSON.parse(fs.readFileSync('examples/revenue-recognition/space.json', 'utf8'));
  assert.equal(space.domain, 'Finance');
  assert.match(fs.readFileSync('scripts/install-example-space.mjs', 'utf8'), /'revenue-recognition'/);
  assert.match(fs.readFileSync('package.json', 'utf8'), /install:revenue-recognition/);
});

test('the shared calculation core is identical to the Order-to-Cash page', () => {
  assert.ok(core(rr).length > 1000);
  assert.equal(core(rr), core(o2c));
});

test('allocation shares the discount by stand-alone price and the residual approach moves it to the licence', () => {
  const A = L.allocate();
  assert.equal(A.price, 388000); assert.equal(A.ssp, 416700); assert.equal(A.discount, 28700);
  assert.equal(Math.round(Object.values(A.byLine).reduce((a, b) => a + b, 0) * 100) / 100, 388000);
  const R = L.residual();
  assert.equal(R.byLine.L10, 35300);
  assert.equal(Math.round(Object.values(R.byLine).reduce((a, b) => a + b, 0) * 100) / 100, 388000);
});

test('position at 2026-12-31 and the entries balance', () => {
  const P = L.position('2026-12-31');
  assert.equal(P.total.billed, 78800); assert.equal(P.total.recognized, 96052.64); assert.equal(P.total.collected, 73400);
  assert.equal(P.contractAsset, 17252.64);
  const J = L.journal('2026-12'), acc = L.accounts(J);
  const dr = acc.reduce((s, a) => s + a.dr, 0), cr = acc.reduce((s, a) => s + a.cr, 0);
  assert.equal(Math.round(dr * 100), Math.round(cr * 100));
});

test('remaining performance obligations add up and leave out usage', () => {
  const R = L.rpo('2026-12');
  assert.equal(R.total, L.position('2026-12-31').remaining);
  assert.equal(Math.round(R.bands.reduce((s, b) => s + b.amount, 0) * 100), Math.round(R.total * 100));
  assert.equal(R.bands[3].amount, 0);
});

test('service credit, rebate and contract costs', () => {
  assert.deepEqual(L.sla(100), { pct: 0, credit: 0, net: 7000 });
  assert.equal(L.sla(99.7).credit, 350);
  assert.equal(L.sla(98.4).credit, 1750);
  const R = L.rebate();
  assert.equal(R.expectedRebate, 490); assert.equal(R.likelyRebate, 620); assert.equal(R.pRebate, 0.75);
  const c = L.costs('2027-02');
  assert.equal(c.total, 23280); assert.equal(c.monthly, 388); assert.equal(c.amortised, 1164); assert.equal(c.balance, 22116);
});

test('contract change: A is a separate contract, B is prospective with licences recognised at once', () => {
  const a = L.modification('A'), b = L.modification('B');
  assert.equal(a.separate, true); assert.equal(a.add, 44800); assert.equal(a.after.monthly, 9547.35);
  assert.equal(b.separate, false);
  const sum = b.after.items.reduce((s, x) => s + x.amount, 0);
  assert.equal(Math.round(sum * 100), Math.round(b.after.pool * 100));
  assert.equal(b.after.atOnce, 14172.8);
});

test('content: 14 treatments, 12 judgements, 5 steps, every treatment fully described', () => {
  assert.equal(data.steps.length, 5); assert.equal(data.treatments.length, 14); assert.equal(data.judgements.length, 12);
  data.treatments.forEach((t) => ['name', 'pattern', 'why', 'watch', 'refs', 'je'].forEach((k) => assert.ok(t[k], t.id + ' ' + k)));
  assert.doesNotMatch(rr, /localStorage|fetch\(|XMLHttpRequest/);
});

// ---- the overhaul: a clear process, colour per step, motion on opening a page, tips ----
import { JSDOM } from 'jsdom';
const page = () => { const dom = new JSDOM(rr, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' }); return { dom, d: dom.window.document, w: dom.window }; };
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const PATH = ['steps', 'treat', 'var', 'alloc', 'sched', 'bal', 'chg', 'disc', 'judge'];

test('the process: five steps in the order of the standard, three pages after signing, every page on one path', () => {
  assert.deepEqual(/var PATH = \[([^\]]+)\]/.exec(rr)[1].match(/'(\w+)'/g).map((x) => x.slice(1, -1)), PATH);
  const { d } = page();
  assert.equal(d.querySelectorAll('#tabs .rn:not(.mini)').length, 5, 'five steps');
  assert.deepEqual([...d.querySelectorAll('#tabs .rn:not(.mini) b')].map(text), ['Contract', 'Obligations', 'Price', 'Allocation', 'Revenue']);
  assert.deepEqual([...d.querySelectorAll('#tabs .rn.mini')].map(text), ['Changes and costs', 'Disclosures', 'Judgements and system']);
  assert.equal(d.querySelectorAll('#tabs .rn.on').length, 1);
  assert.match(text(d.querySelector('.banner')), /Step 1 of 5\s*Contract/);
  const seen = [];
  for (let i = 0; i < PATH.length; i++) {
    seen.push(text(d.querySelector('.banner .bn-t')));
    const next = d.querySelector('.banner .btn.go');
    if (i < PATH.length - 1) { assert.ok(!next.disabled); next.click(); } else { assert.ok(next.disabled); assert.match(text(next), /End of the path/); }
  }
  assert.deepEqual(seen, ['Contract', 'Obligations', 'Price', 'Allocation', 'Revenue · Schedule', 'Revenue · Balances and entries', 'Changes and costs', 'Disclosures', 'Judgements and system']);
  assert.match(text(d.querySelector('.banner')), /After signing/);
  assert.equal(d.querySelectorAll('#tabs .rn.done').length, 5, 'after signing, all five steps are done');
});

test('the first page shows the whole deal as five coloured cards, and the next page follows from the card', () => {
  const { d } = page();
  const cards = [...d.querySelectorAll('.flowmap .fm')];
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map((c) => c.className.match(/ph\d/)[0]), ['ph1', 'ph2', 'ph3', 'ph4', 'ph5'], 'one colour per step');
  assert.equal(cards[2].querySelector('.fv').getAttribute('data-n'), '388000');
  assert.equal(cards[3].querySelector('.fv').getAttribute('data-n'), '28700');
  cards[3].click();
  assert.match(text(d.querySelector('.banner .bn-t')), /Allocation/);
});

test('price allocation is drawn as bars in the colour of each position, discount hatched', () => {
  const { d } = page();
  d.querySelector('[data-act=tab][data-id=alloc]').click();
  const bars = [...d.querySelectorAll('.albars .albar')];
  assert.equal(bars.length, 3);
  assert.equal(bars[0].querySelectorAll('i').length, 5, 'five committed obligations, no discount on top of the stand-alone prices');
  assert.equal(bars[1].querySelectorAll('i.disc').length, 1);
  const widths = (b) => [...b.querySelectorAll('i')].reduce((s, i) => s + parseFloat(/--w:([\d.]+)%/.exec(i.getAttribute('style'))[1]), 0);
  for (const b of bars) assert.ok(Math.abs(widths(b) - (b === bars[0] ? 100 - 0 : 100)) < 0.2, 'each bar is as long as the stand-alone prices');
  assert.match(bars[0].querySelector('i').className, /pos0/);
});

test('the month player moves the cursor and shows billed, recognised, collected and the gap for that month', () => {
  const { d, w } = page();
  d.querySelector('[data-act=tab][data-id=sched]').click();
  const sr = L.series(), sc = d.querySelector('#scrub');
  assert.equal(+sc.max, sr.length - 1);
  assert.match(text(d.querySelector('#pm')), /Dec 2029/, 'it opens on the last month');
  sc.value = '1'; sc.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(text(d.querySelector('#pm')), /Dec 2026/);
  const ro = [...d.querySelectorAll('#readout .ro b')].map(text);
  assert.equal(ro[0], L.money(sr[1].billed)); assert.equal(ro[1], L.money(sr[1].recognized)); assert.equal(ro[2], L.money(sr[1].collected));
  assert.equal(ro[3], L.money(Math.abs(Math.round((sr[1].billed - sr[1].recognized) * 100) / 100)));
  assert.match(text(d.querySelector('#readout .ro.rg span')), /Contract (asset|liability)/);
  assert.equal(d.querySelectorAll('svg.chart .st').length, 7, 'the stacked chart has one layer per position');
});

test('the journal entries and balances use one colour per position and one per account', () => {
  const { d } = page();
  d.querySelector('[data-act=tab][data-id=sched]').click();
  d.querySelector('.banner .seg [data-id=bal]').click();
  const rows = [...d.querySelectorAll('.jt tbody tr.posr')];
  assert.ok(rows.length >= 8);
  for (const k of ['ac-recv', 'ac-bank', 'ac-def', 'ac-rev']) assert.ok(d.querySelector(`.jt .acct.${k}`), k);
  assert.equal(d.querySelector('.kpis .kpi.k-b b').getAttribute('data-n'), String(L.position('2026-12-31').total.billed));
});

test('only tokens are used for colour in the new styles, and motion is limited to opening a page', () => {
  const css = rr.slice(rr.indexOf('/* ---- the process: five coloured steps'), rr.indexOf('</style>', rr.indexOf('/* ---- the process: five coloured steps')));
  assert.ok(css.length > 4000);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'no colour values, only tokens');
  for (const c of ['ph1', 'ph2', 'ph3', 'ph4', 'ph5', 'ph6', 'ph7', 'ph8', 'pos0', 'pos6', 'ac-recv', 'ac-bank', 'ac-def', 'ac-rev', 'ac-oth']) assert.ok(css.includes(`.${c}{`), c);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*\.enter>\*[^@]*animation:none!important/, 'reduced motion switches the page animations off');
  assert.match(rr, /main\.className = S\.enter \? 'enter' : ''/);
  assert.match(rr, /if \(act === 'tab'\) \{[^}]*S\.enter = true/);
  assert.doesNotMatch(rr, /S\.enter = true[^;]*;[^}]*act === 'set'/, 'pressing a button on a page does not replay the animation');
  assert.doesNotMatch(rr, /localStorage|sessionStorage|fetch\(|XMLHttpRequest/, 'a Space has no storage and no network');
});

test('tips: every page has some, their targets exist, the bubble walks through them and can be switched off', () => {
  const { d, w } = page();
  const tips = /var TIPS = \{([\s\S]*?)\n  \};\n  var T = /.exec(rr)[1];
  const keys = [...tips.matchAll(/^    '?(\w+)'?: \[/gm)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), [...PATH].sort());
  // the first page opens with the tour
  assert.ok(d.querySelector('#tipb'), 'tips are on by default');
  assert.match(text(d.querySelector('#tipb')), /Tip 1 of 3\s*Five steps, one path/);
  d.querySelector('#tp-next').click(); d.querySelector('#tp-next').click();
  assert.equal(text(d.querySelector('#tp-next')), 'Done');
  d.querySelector('#tp-next').click();
  assert.equal(d.querySelector('#tipb'), null, 'done closes it');
  d.querySelector('#tips-btn').click();
  assert.ok(d.querySelector('#tipb'), 'the Tips button shows them again');
  d.querySelector('#tp-off').click();
  assert.equal(d.querySelector('#tipb'), null); assert.equal(text(d.querySelector('#tips-btn')), 'Tips off');
  d.querySelector('[data-act=tab][data-id=alloc]').click();
  assert.equal(d.querySelector('#tipb'), null, 'off stays off on the next page');
  // the app switches them on again (Settings, Skin, Tips) with a message from its window
  const ask = (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w }));
  ask({ type: 'ct:tips', enabled: true, size: 16, textColor: '', bubbleColor: '#ffeeaa', highlightColor: '' });
  assert.ok(d.querySelector('#tipb')); assert.equal(text(d.querySelector('#tips-btn')), 'Tips');
  assert.equal(d.documentElement.style.getPropertyValue('--tip-size'), '16px'); assert.equal(d.documentElement.style.getPropertyValue('--tip-bg'), '#ffeeaa');
  ask({ type: 'ct:tips', enabled: false, size: null, textColor: '', bubbleColor: '', highlightColor: '' });
  assert.equal(d.querySelector('#tipb'), null); assert.equal(d.documentElement.style.getPropertyValue('--tip-size'), '');
  // targets of the tips exist on their page
  d.querySelector('[data-act=tab][data-id=steps]').click();
  for (const k of PATH) {
    for (const m of [...new RegExp(`^    '?${k}'?: \\[([\\s\\S]*?)\\n    \\]`, 'm').exec(tips)[1].matchAll(/sel: '([^']+)'/g)]) assert.ok(d.querySelector(m[1]), `${k}: ${m[1]}`);
    if (k !== 'judge') d.querySelector('.banner .btn.go').click();
  }
  d.defaultView.close();
});

test('the page tells the app to switch the tips off, and reads the app setting at the start', () => {
  assert.match(rr, /window\.parent\.postMessage\(\{ type: 'wb:tips', enabled: on \}, '\*'\)/);
  assert.match(rr, /getPropertyValue\('--wb-tips'\)\.trim\(\) !== 'off'/);
  assert.match(rr, /e\.source !== window\.parent \|\| !d \|\| d\.type !== 'ct:tips'/);
  assert.match(rr, /Switch the tips off\. You can switch them on again in Settings, Skin, Tips\./);
});
