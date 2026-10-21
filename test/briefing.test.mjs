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
      if (action.kind === 'open') assert.equal(action.space, 'ai-control-tower');
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
