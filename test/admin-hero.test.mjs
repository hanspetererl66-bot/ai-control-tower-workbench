import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('Skill Health Monitor and Solution register wear the same hero as the Ontology Manager: one component, the om-hero styles, a crumb with the screen name', () => {
  const hero = read('src/ui/AdminHero.tsx');
  assert.match(hero, /<header className=\{`om-hero\$\{onBack \? '' : ' om-hero-noback'\}\$\{children \? ' om-hero-extra' : ''\}`\}>/);
  assert.match(hero, /<p className="om-crumb">Admin console · \{screen\}<\/p>/);
  assert.match(hero, /<h1>\{lead\} <span>\{accent\}<\/span><\/h1>/, 'the second half of the headline is highlighted, like in the Ontology Manager');
  const sh = read('src/ui/SkillHealthView.tsx');
  assert.match(sh, /<AdminHero screen="Skill Health Monitor" lead="See which skills earn their place," accent="and which should go\."/);
  assert.match(sh, /import AdminHero from '\.\/AdminHero'/);
  assert.doesNotMatch(sh, /<header className="sh-head">/, 'the old plain header is gone');
  assert.match(sh, /<Ring share=\{m\.total \? m\.live \/ m\.total : 0\} \/>\s*<\/AdminHero>/, 'the ring stays, at the right of the hero');
  const rg = read('src/ui/RegistryView.tsx');
  assert.match(rg, /<AdminHero screen="Solution register" lead="Know what was built," accent="and where it stands\." onBack=\{onBack\}/);
  assert.doesNotMatch(rg, /<header className="sh-head">/);
  assert.match(rg, /\{api && !showExample && <button className="rg-refresh" onClick=\{\(\) => void load\(\)\}>Refresh<\/button>\}\s*<\/AdminHero>/);
  const om = read('src/ui/OntologyManagerView.tsx');
  assert.match(om, /<header className="om-hero" data-guide="hero">/, 'the Ontology Manager keeps its own header (with its tips button)');
});

test('the hero styles: the tokens of the Ontology Manager reach the two screens, the back button and the ring look right on black, no hero without a back button breaks the grid', () => {
  const css = read('src/theme.css');
  assert.match(css, /\.sh \{ --om-hero: #000000; --om-hero-ink: #ffffff; --om-hero-soft: #cfcddb; --om-hero-hl: #dcafff; \}/);
  assert.match(css, /\.sh > \.om-hero \{ margin: -24px -32px 4px; \}/, 'flush with the top and the sides of the padded page');
  assert.match(css, /\.sh \.om-hero \.om-back \{ background: transparent;/, 'the generic .sh button style must not turn the arrow white on white');
  assert.match(css, /\.om-hero \.sh-ring-prog \{ stroke: var\(--om-hero-hl\); \}/);
  assert.match(css, /\.om-hero-noback \{ grid-template-columns: 1fr; \}/);
});
