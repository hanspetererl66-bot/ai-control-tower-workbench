import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildActivity, embedActivity, repoActivity } from '../scripts/sync-agent-activity.mjs';
import { parseAskMessage } from '../src/space-ask.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const tower = JSON.parse(read('examples/control-tower/data.json'));
const links = JSON.parse(read('examples/agent-activity/links.json'));

test('the page is in sync with the Control Tower data, links and design system', () => {
  const html = read('examples/agent-activity/index.html');
  assert.equal(embedActivity(html, repoActivity(), read('examples/shared/design-system.css')), html, 'run npm run sync:agent-activity');
});

test('totals match what the Control Tower itself states', () => {
  const { totals, families, platforms } = repoActivity();
  assert.equal(totals.productionAgents, tower.agents.production);
  assert.equal(totals.overprivileged, tower.agents.overprivileged);
  assert.equal(totals.euHighRisk, tower.compliance.euAiAct.total);
  assert.equal(totals.pendingReview, tower.agents.registry.filter((a) => a.lifecycle === 'pending_review').length);
  assert.equal(families.reduce((n, f) => n + f.agents, 0), totals.productionAgents);
  assert.equal(families.reduce((n, f) => n + f.runsPerDay, 0), totals.runsPerDay);
  assert.equal(platforms.reduce((n, p) => n + p.agents, 0), totals.productionAgents);
});

test('every family has at least one valid system link; bad links fail loudly', () => {
  for (const family of repoActivity().families) assert.ok(family.systems.length > 0, family.name);
  assert.throws(() => buildActivity(tower, { ...links, families: { ...links.families, 'ABAP Code Assistant': ['nowhere'] } }), /unknown system/);
  const { 'Master Data Deduplicator': _drop, ...fewer } = links.families;
  assert.throws(() => buildActivity(tower, { ...links, families: fewer }), /no systems for the agent family "Master Data Deduplicator"/);
  assert.throws(() => buildActivity(tower, { ...links, families: { ...links.families, Ghost: ['s4hana'] } }), /no production agents/);
});

test('the Space says it is simulated sample data, runs offline and has a card', () => {
  const html = read('examples/agent-activity/index.html');
  assert.match(html, /keine Live-Messung/);
  assert.match(html, /class="[^"]*\bcard\b/);
  assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|localStorage/);
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ''), /background:\s*#fff(?![0-9a-f])/i);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /prefers-reduced-motion/);
});

test('a Space can only ask a plain, short question', () => {
  assert.equal(parseAskMessage({ type: 'wb:ask', prompt: '  Erkläre L2C  ' }), 'Erkläre L2C');
  assert.equal(parseAskMessage({ type: 'wb:ask', prompt: '' }), null);
  assert.equal(parseAskMessage({ type: 'wb:ask', prompt: 'x'.repeat(601) }), null);
  assert.equal(parseAskMessage({ type: 'wb:ask', prompt: 5 }), null);
  assert.equal(parseAskMessage({ type: 'other', prompt: 'hi' }), null);
  assert.equal(parseAskMessage(null), null);
});
