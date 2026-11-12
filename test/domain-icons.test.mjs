import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { domainIconKey } from '../src/domain-icons.ts';

test('every domain of the bundled examples gets the icon that fits its name', () => {
  const expected = { 'Autonomous Operations': 'operations', Sales: 'sales', Governance: 'governance', HR: 'people', Finance: 'finance', Marketplace: 'marketplace', Service: 'service', Development: 'development', Automation: 'automation' };
  for (const [name, key] of Object.entries(expected)) assert.equal(domainIconKey(name), key, name);
});

test('German names and unknown names are handled; unknown gets the neutral icon', () => {
  assert.equal(domainIconKey('Vertrieb'), 'sales');
  assert.equal(domainIconKey('Personal'), 'people');
  assert.equal(domainIconKey('Finanzen'), 'finance');
  assert.equal(domainIconKey('Entwicklung'), 'development');
  assert.equal(domainIconKey('Quokka'), 'generic');
  assert.equal(domainIconKey(''), 'generic');
});

test('the Spaces overview no longer draws the dots, and the domain tile carries an icon with tokens only', () => {
  const tsx = readFileSync(join(import.meta.dirname, '../src/ui/SpacesOverview.tsx'), 'utf8');
  const css = readFileSync(join(import.meta.dirname, '../src/theme.css'), 'utf8');
  assert.doesNotMatch(tsx, /Constellation|sov-dot|sov-const/);
  assert.match(tsx, /<DomainIcon name=\{d\.name\} \/>/);
  assert.doesNotMatch(css, /\.sov-dot|\.sov-const/);
  const icon = css.slice(css.indexOf('/* Domain tile icon'));
  assert.doesNotMatch(icon, /#[0-9a-f]{3,6}\b/i, 'icon styles use tokens');
});
