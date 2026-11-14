import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'examples/order-to-cash-software/index.html'), 'utf8');
const data = JSON.parse(/id="data">([\s\S]*?)<\/script>/.exec(html)[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withPage(fn) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/scrollTo|scrollIntoView/.test(m)) errs.push(m); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, d = w.document;
  const page = { w, d, errs, $: (q) => d.querySelector(q), $$: (q) => [...d.querySelectorAll(q)], tab: (id) => d.querySelector(`#tabs [data-id=${id}]`).click() };
  try { await sleep(100); await fn(page); } finally { w.close(); }
}

test('Entitlement has two sub-tabs, "Entitlement per check" and "Entitlement per tenant", each showing only its own card; the choice survives running the process', async () => {
  await withPage(async (p) => {
    p.tab('ent');
    assert.deepEqual(p.$$('.subtab').map((b) => b.textContent.replace(/\s+/g, ' ').trim()), ['Entitlement per check open', 'Entitlement per tenant not yet granted']);
    assert.equal(p.$$('.subtab.on').length, 1);
    assert.equal(p.$('.subtab.on').dataset.id, 'check');
    assert.equal(p.$$('#main table').length, 1, 'the check table');
    assert.equal(p.$$('.tcard').length, 0);
    p.$('.subtab[data-id=tenant]').click();
    assert.equal(p.$('.subtab.on').dataset.id, 'tenant');
    assert.equal(p.$$('.tcard').length, data.tenants.length, 'one card per tenant');
    assert.equal(p.$$('#main table').length, 0, 'the check table is on the other sub-tab');
    const prod = p.$$('.tcard').find((c) => c.textContent.includes('kestrel-eu-central'));
    assert.match(prod.textContent, /250\s*users/);
    assert.match(prod.textContent, /Single sign-on connector/);
    assert.match(prod.textContent, /24x7 incident desk/);
    assert.match(p.$('.tenants').parentElement.textContent, /Production holds the 250 contracted users/);
    p.$('[data-act=next]').click();
    assert.equal(p.$('.subtab.on').dataset.id, 'tenant', 'running a step does not throw the person back');
    p.$('.subtab[data-id=check]').click();
    assert.equal(p.$$('#main table').length, 1);
    assert.deepEqual(p.errs, []);
  });
});

test('the bill of material is a tree: the order, four branches by delivery type, a card per item with its included services; a click shows its details and marks its table row', async () => {
  await withPage(async (p) => {
    p.tab('bom');
    assert.equal(p.$$('.bomtree .bt-col').length, 4);
    assert.deepEqual(p.$$('.bt-col .bt-h b').map((b) => b.textContent), ['Licence keys', 'Tenant', 'Meter', 'Services']);
    assert.equal(p.$$('.bt-item').length, data.lines.length, 'every position is a card');
    assert.match(p.$('.bt-root').textContent, new RegExp(data.contract.id));
    const sso = p.$$('.bt-item').find((b) => b.dataset.id === 'L20');
    assert.match(sso.textContent, /Single sign-on connector/);
    assert.match(sso.textContent, /Daily backup and restore/);
    assert.ok(p.$$('.bt-item.sw').length === 4 && p.$$('.bt-item.sv').length === 3, 'software and services told apart');
    assert.equal(p.$('.bomtree').className, 'card bomtree in', 'the entrance plays when the tab opens');
    assert.equal(p.$('.bt-det'), null);
    sso.click();
    assert.equal(p.$('.bomtree').className, 'card bomtree', 'a click inside does not play it again');
    assert.match(p.$('.bt-det').textContent, /Item 20 · Insight Cloud subscription/);
    assert.match(p.$('.bt-det').textContent, /SW-SUB-INSIGHT/);
    assert.equal(p.$$('tr.hi').length, 1);
    assert.match(p.$('tr.hi').textContent, /Insight Cloud subscription/);
    assert.equal(p.$$('.bt-item.sel').length, 1);
    p.$$('.bt-item').find((b) => b.dataset.id === 'L20').click();
    assert.equal(p.$('.bt-det'), null, 'a second click closes it');
    p.tab('proc');
    p.tab('bom');
    assert.equal(p.$('.bomtree').className, 'card bomtree in', 'opening the tab again plays it again');
    assert.deepEqual(p.errs, []);
  });
});

test('the styles: tokens only, the tree and the tenant cards move once, reduced motion stops it, a narrow screen shows one column; no clash with the design system classes', () => {
  const css = html.slice(html.indexOf('.subtabs{'), html.indexOf('</style>', html.indexOf('.subtabs{')));
  assert.ok(css.length > 2000);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'no colour outside the tokens');
  for (const f of ['o2c-rise', 'o2c-draw', 'o2c-down', 'o2c-fade']) assert.match(css, new RegExp(`@keyframes ${f}`));
  assert.match(css, /\.bomtree\.in \.bt-item\{animation:o2c-rise/);
  assert.match(css, /\.tenants\.in \.tcard\{animation:o2c-rise/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none!important/);
  assert.match(css, /@media \(max-width:900px\)\{\.bt-cols\{grid-template-columns:1fr/);
  assert.doesNotMatch(html, /class="card bt[ '"]/, 'the plain class "bt" is the design system bar track and must not be used for the card');
  assert.doesNotMatch(html.slice(html.indexOf('<body')), /fetch\(|localStorage|XMLHttpRequest/);
});
