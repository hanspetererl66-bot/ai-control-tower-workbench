import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildBriefing, daysUntil } from '../src/briefing.ts';
import { wantsSpace } from '../src/space-intent.ts';

const data = JSON.parse(readFileSync(new URL('../examples/control-tower/data.json', import.meta.url), 'utf8'));
const today = new Date(2026, 9, 20); // 20 Oct 2026

test('counts the days to the EU AI Act audit', () => {
  assert.equal(daysUntil('2026-12-12', today), 53);
  assert.equal(daysUntil('2026-10-20', today), 0);
  assert.equal(daysUntil('2026-10-19', today), -1);
});

test('builds the cards from the real Control Tower data, board briefing last', () => {
  const cards = buildBriefing(data, today);
  assert.deepEqual(cards.map((c) => c.id), ['risks', 'budget', 'audit', 'agents', 'board']);
  const [risks, budget, audit, agents] = cards;
  assert.match(risks.title, /^3 High-Risiken unter 40 % mitigiert$/);
  assert.match(risks.detail, /AI-driven instability spike \(20 %/);
  assert.match(budget.title, /^2 Teams liegen über dem KI-Budget$/);
  assert.match(budget.detail, /Engineering 107 %, Finance 104 %/);
  assert.equal(audit.title, 'EU-AI-Act-Audit in 53 Tagen');
  assert.equal(audit.tone, 'amber');
  assert.match(audit.detail, /8 von 18 .* 10 offen/);
  assert.match(agents.title, /^47 unregistrierte .* 31 überprivilegierte/);
});

test('every card is actionable and mail drafts never send', () => {
  for (const card of buildBriefing(data, today)) {
    assert.ok(card.actions.length > 0, card.id);
    for (const action of card.actions) {
      if (action.kind === 'open') assert.ok(['ai-control-tower', 'infra-ops', 'it-fleet'].includes(action.space));
      if (action.kind === 'ask' && /Gmail/.test(action.prompt)) assert.match(action.prompt, /nichts senden/);
    }
  }
});

test('the board briefing asks the skill, as a chat answer or as a Space, and never invents numbers', () => {
  const board = buildBriefing(data, today).at(-1);
  assert.deepEqual(board.actions.map((a) => a.label), ['Im Chat erstellen', 'Als Space anlegen']);
  for (const action of board.actions) assert.match(action.prompt, /board-briefing/);
  assert.equal(wantsSpace(board.actions[0].prompt), false, 'chat answer must not create a Space');
  assert.equal(wantsSpace(board.actions[1].prompt), true, 'Space action must create a Space');
  assert.match(board.actions[1].prompt, /Space/);
  assert.match(board.actions[1].prompt, /Nur Zahlen aus den Werkzeugantworten/);
});

test('only the board briefing remains when nothing needs attention', () => {
  const calm = structuredClone(data);
  calm.risks.forEach((r) => (r.progressPct = 90));
  calm.budget.groups.forEach((g) => (g.utilisationPct = 50));
  calm.agents.unregistered = 0;
  calm.agents.overprivileged = 0;
  calm.compliance.euAiAct.auditDate = '2025-01-01';
  assert.deepEqual(buildBriefing(calm, today).map((c) => c.id), ['board']);
});

const ops = { certs: JSON.parse(readFileSync(new URL('../examples/infra-ops/data.json', import.meta.url), 'utf8')).certs, fleet: JSON.parse(readFileSync(new URL('../examples/it-fleet/fleet.json', import.meta.url), 'utf8')) };

test('each card names its area; the AI cards are labelled AI', () => {
  const cards = buildBriefing(data, today, ops);
  assert.deepEqual(cards.filter((c) => c.area.startsWith('AI-')).map((c) => c.area), ['AI-Risiken', 'AI-Budget', 'AI-Compliance', 'AI-Agenten-Status']);
  assert.ok(cards.every((c) => c.area));
});

test('two infrastructure cards come from the certificates and the fleet, before the board card', () => {
  const cards = buildBriefing(data, new Date(2026, 9, 25), ops);
  assert.deepEqual(cards.map((c) => c.id), ['risks', 'budget', 'audit', 'agents', 'certs', 'fleet', 'board']);
  const certs = cards.find((c) => c.id === 'certs');
  assert.match(certs.title, /^5 Zertifikate laufen in unter 30 Tagen ab, 1 abgelaufen$/);
  assert.equal(certs.tone, 'red');
  assert.match(certs.actions.find((a) => a.kind === 'ask').prompt, /nichts ausführen/);
  const fleet = cards.find((c) => c.id === 'fleet');
  assert.equal(fleet.title, '7 Kunden sind im Fleet rot');
  assert.deepEqual(fleet.actions.map((a) => a.space), ['it-fleet']);
  assert.equal(buildBriefing(data, today).some((c) => c.id === 'certs' || c.id === 'fleet'), false);
});
