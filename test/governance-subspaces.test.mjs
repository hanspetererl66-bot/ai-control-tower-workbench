import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { SUBSPACES, buildSubspace } from '../scripts/sync-governance-subspaces.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const tower = read('examples/control-tower/index.html');

/** Run the page's scripts, hand the window to fn, and always close it (the pages start timers). */
function withDom(html, fn) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String(e.message ?? e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
  try { fn(dom.window.document, errors); } finally { dom.window.close(); }
}

for (const spec of SUBSPACES) {
  test(`${spec.dir} is up to date with the AI Control Tower page (run npm run sync:governance-subspaces)`, () => {
    assert.equal(read(`examples/${spec.dir}/index.html`), buildSubspace(tower, spec));
  });

  test(`${spec.dir} shows exactly its tabs, one page each, and runs without script errors`, () => {
    withDom(read(`examples/${spec.dir}/index.html`), (doc, errors) => {
      const buttons = [...doc.querySelectorAll('.tb')].map((b) => /go\('(\w+)'/.exec(b.getAttribute('onclick'))[1]);
      const pages = [...doc.querySelectorAll('section.pg')].map((p) => p.id.replace('page-', ''));
      assert.deepEqual(buttons, spec.tabs);
      assert.deepEqual(pages, spec.tabs);
      assert.equal(doc.querySelectorAll('section.pg.on').length, 1);
      assert.equal(doc.querySelector('.hdr-title').textContent, spec.title);
      assert.ok(doc.getElementById('hub-back'));
      assert.deepEqual(errors, []);
    });
  });

  test(`${spec.dir} has a way back to AI Governance`, () => {
    assert.match(read(`examples/${spec.dir}/index.html`), /type:'wb:handoff',to:'ai-control-tower',payload:\{\},open:true/);
  });
}

test('the AI Control Tower entry page itself runs without script errors', () => {
  withDom(tower, (doc, errors) => {
    assert.equal(doc.querySelectorAll('.hub-tile').length, 4);
    assert.deepEqual(errors, []);
  });
});

test('the lifecycle subspaces are children of the AI Control Tower', () => {
  for (const dir of ['agent-registry', 'agent-compliance', 'agent-observability']) {
    const space = JSON.parse(read(`examples/${dir}/space.json`));
    assert.equal(space.parent, 'ai-control-tower', dir);
    assert.equal(space.domain, 'Governance', dir);
  }
});
