import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const html = readFileSync(path.resolve(import.meta.dirname, '..', 'examples/sales/index.html'), 'utf8');
const ACCENTS = ['purple', 'blue', 'green', 'grey', 'orange'];

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const vars = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
/** The token block of one accent in one theme, exactly as written in the page. */
function block(accent, dark) {
  const attr = accent === 'purple' ? '' : `\\[data-accent="${accent}"\\]`;
  const sel = dark ? (accent === 'purple' ? ':root\\[data-theme="dark"\\]' : `:root\\[data-theme="dark"\\]${attr}`) : (accent === 'purple' ? ':root' : `:root${attr}`);
  const m = html.match(new RegExp(`(?:^|\\n)${sel}\\{([^}]*--s1:[^}]*)\\}`));
  assert.ok(m, `${accent} ${dark ? 'dark' : 'light'} tokens exist`);
  return vars(m[1]);
}

test('Sales stage views: Journey line is the default and the switch offers the other two', () => {
  assert.match(html, /const look = \{ view: 'journey'/);
  for (const v of ['journey', 'stairs', 'blueprint']) assert.match(html, new RegExp(`\\['${v}', '`));
  assert.match(html, /id="vseg"/);
  // the stage views replace both the funnel on the Pipeline tab and the process cards on the Workflow tab
  assert.match(html, /\$\('#funnel'\)\.innerHTML = V\[0\]\(\)/);
  assert.match(html, /\$\('#chain'\)\.innerHTML = V\[1\]\(\)/);
});

test('Sales stage views: five colour families, each with light and dark tokens in the page', () => {
  assert.deepEqual([...html.matchAll(/\['(purple|blue|green|grey|orange)', '[A-Z][a-z]+'\]/g)].map((m) => m[1]), ACCENTS);
  for (const accent of ACCENTS) {
    for (const dark of [false, true]) {
      const t = block(accent, dark);
      for (let i = 1; i <= 5; i++) { assert.ok(t[`s${i}`] && t[`o${i}`], `${accent} ${dark ? 'dark' : 'light'}: s${i}/o${i}`); }
      assert.ok(t.acc, `${accent} ${dark ? 'dark' : 'light'}: accent text colour`);
    }
  }
});

test('Sales stage views: the text on every stage colour and the accent text can be read in both themes', () => {
  for (const accent of ACCENTS) {
    for (const dark of [false, true]) {
      const t = block(accent, dark);
      const surfaces = dark ? ['#18171d', '#1d1c24'] : ['#ffffff', '#faf9fc'];
      for (let i = 1; i <= 5; i++) assert.ok(contrast(t[`s${i}`], t[`o${i}`]) >= 4, `${accent} ${dark ? 'dark' : 'light'} stage ${i}: ${contrast(t[`s${i}`], t[`o${i}`]).toFixed(1)}`);
      for (const s of surfaces) assert.ok(contrast(t.acc, s) >= 4.5, `${accent} ${dark ? 'dark' : 'light'}: accent text on ${s}`);
    }
  }
});

test('Sales stage views: the purple ramp runs from light to dark', () => {
  const t = block('purple', false);
  const l = [1, 2, 3, 4, 5].map((i) => lum(t[`s${i}`]));
  for (let i = 1; i < 5; i++) assert.ok(l[i] < l[i - 1], `stage ${i + 1} is darker than stage ${i}`);
});

test('Sales stage views: a Space keeps nothing in storage, and stage colours are tokens in the rules', () => {
  const body = html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
  assert.doesNotMatch(body, /localStorage|sessionStorage/);
  const rules = body.slice(body.indexOf('/* Stage views'), body.indexOf('</style>', body.indexOf('/* Stage views')));
  const rest = rules.split('\n').filter((l) => !/^(:root|@media|\}|\/\*)/.test(l) && !/^\s*--sw-/.test(l)).join('\n');
  assert.doesNotMatch(rest, /#[0-9a-fA-F]{3,6}\b/, 'no literal colour outside the token definitions');
});

test('Sales tabs: Governance, Workflow and Rules sit under one tab "Settings & info"', () => {
  const tabs = [...html.matchAll(/<button role="tab"[^>]*data-tab="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['pipeline', 'forecast', 'payments', 'meetings', 'knowledge', 'inbox', 'more']);
  for (const s of ['governance', 'workflow', 'rules']) {
    assert.match(html, new RegExp(`data-sub="${s}"`));
    assert.match(html, new RegExp(`id="sub-${s}"`));
  }
  // the journey and the hand-over still name the old tabs; openTab maps them to the panel
  assert.match(html, /function openTab\(t\)/);
});

test('Sales inbox: ranked by a visible rule and laid out as a wall of tiles', () => {
  assert.match(html, /function prio\(x\)/);
  assert.match(html, /\.wall\{display:grid;grid-template-columns:repeat\(auto-fill/);
  for (const lv of ['Do first', 'Next', 'When there is time']) assert.ok(html.includes(lv), lv);
  assert.match(html, /The reasons are shown on each tile/);
});

test('Sales meetings: both prompts get an "Execute in Chat Window" button that posts wb:ask', () => {
  assert.equal((html.match(/runBtn\('Prepare/g) || []).length, 2);
  assert.match(html, /type: 'wb:ask', prompt: String\(r\.dataset\.run\)\.slice\(0, 600\)/);
  assert.match(html, /Execute in Chat Window/);
});

test('Sales knowledge graph: node labels are 15 % larger than before (12 px to 13.8 px)', () => {
  assert.match(html, /\.kn-node text\.l\{[^}]*font-size:13\.8px/);
});
