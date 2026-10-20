/**
 * What-if model: "What happens if we cut the AI credits by X %?"
 * One rule set, used by the chat tool (simulate_credit_cut) and, embedded by scripts/sync-what-if.mjs, by the
 * What-if Space, so slider and chat always give the same answer. Pure functions over the Control Tower data; read-only.
 *
 * Rules (also listed in the result as `assumptions`):
 *  - A cut of X % lowers every team's AI credit budget and the overall ceiling by X %.
 *  - Demand stays as it is. The overall ceiling is the hard limit; single teams may exceed their budget (as Engineering
 *    does today). If the reduced ceiling no longer covers the spend, the missing amount is spread over the teams that are
 *    above their reduced budget, in proportion to how far they are above it; their production agents run evenly less.
 *  - Agents are assigned to teams by their business unit (UNIT_TO_GROUP), an illustrative mapping.
 *  - Risk effects are rules of thumb, not a forecast.
 */

// BEGIN-MODEL
const UNIT_TO_GROUP = {
  Engineering: 'Engineering',
  Security: 'Engineering',
  Operations: 'Operations',
  Support: 'Operations',
  Sales: 'Sales & Presales',
  Finance: 'Finance',
  HR: 'HR / L&D',
  Legal: 'Legal & Compliance',
};

const ASSUMPTIONS = [
  'Eine Kürzung senkt das Budget jedes Teams und die Gesamt-Obergrenze um denselben Prozentsatz.',
  'Die Nachfrage bleibt gleich. Die Gesamt-Obergrenze ist die harte Grenze; einzelne Teams dürfen über ihrem Budget liegen (wie heute Engineering mit 107 %).',
  'Reicht die gekürzte Obergrenze nicht für den Verbrauch, wird der fehlende Betrag auf die Teams verteilt, die über ihrem gekürzten Budget liegen, im Verhältnis ihrer Überschreitung. Deren produktive Agenten führen gleichmäßig weniger Aufrufe aus, die Kosten sinken im selben Verhältnis.',
  'Agenten werden über ihre Business Unit einem Budget-Team zugeordnet (Support zu Operations, Security zu Engineering); das ist eine Annahme für die Demo.',
  'Die Risiko-Effekte sind Faustregeln, keine Prognose. Beispieldaten, keine Live-Messung.',
];

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/** Control Tower data -> the small model the simulation needs. */
function prepareWhatIf(tower) {
  const production = tower.agents.registry.filter((agent) => agent.lifecycle === 'production');
  const rows = new Map();
  for (const agent of production) {
    const group = UNIT_TO_GROUP[agent.businessUnit] ?? agent.businessUnit;
    const key = `${agent.family}|${group}`;
    const row = rows.get(key) ?? { family: agent.family, group, agents: 0, runsPerDay: 0, costPerWeekEur: 0, overprivileged: 0, euHighRisk: 0 };
    row.agents += 1;
    row.runsPerDay += agent.runsPerDay;
    row.costPerWeekEur += agent.costPerWeekEur;
    row.overprivileged += agent.overprivileged ? 1 : 0;
    row.euHighRisk += agent.euRisk === 'high' ? 1 : 0;
    rows.set(key, row);
  }
  return {
    ceilingM: tower.budget.ceilingM,
    actualM: tower.budget.totalActualM,
    thresholdPct: tower.meta?.riskThresholdPct ?? 40,
    groups: tower.budget.groups.map((g) => ({ name: g.name, budgetK: g.budgetK, utilisationPct: g.utilisationPct })),
    agents: [...rows.values()].sort((a, b) => b.runsPerDay - a.runsPerDay || a.family.localeCompare(b.family)),
    risks: tower.risks.map((r) => ({ id: r.id, title: r.title, severity: r.severity, owner: r.owner, progressPct: r.progressPct })),
  };
}

function riskEffects(model, throttledGroups) {
  const over = new Set(throttledGroups);
  const rules = [
    { test: /shadow/i, when: () => over.size > 0, reason: 'Wird offizielle KI-Kapazität gedrosselt, weichen Teams auf nicht freigegebene Tools aus.' },
    { test: /instability|failed deploy/i, when: () => over.has('Engineering'), reason: 'Engineering-Agenten werden gedrosselt, darunter Test- und Release-Automatisierung; weniger Prüfläufe vor dem Deploy.' },
    { test: /financial|hallucination/i, when: () => over.has('Finance'), reason: 'Finance-Agenten werden gedrosselt; mehr manuelle Zahlen und Nacharbeit erhöhen die Fehlerchance in Finanzausgaben.' },
  ];
  return model.risks.map((risk) => {
    const hit = rules.find((rule) => rule.test.test(risk.title) && rule.when());
    return { ...risk, belowThreshold: risk.progressPct < model.thresholdPct, effect: hit ? 'steigt' : 'unverändert', reason: hit ? hit.reason : 'Die Kürzung ändert diese Ursache nicht.' };
  });
}

/** `cutPct`: 0 to 100 (percent of the AI credits taken away). */
function simulateCreditCut(model, cutPct) {
  const cut = Math.min(100, Math.max(0, Number(cutPct) || 0));
  const factor = 1 - cut / 100;
  const ceilingAfter = model.ceilingM * factor;

  const rows = model.groups.map((group) => {
    const actualK = (group.budgetK * group.utilisationPct) / 100;
    return { group, actualK, budgetAfter: group.budgetK * factor };
  });
  const actualTotalK = rows.reduce((n, row) => n + row.actualK, 0);
  // Spend that no longer fits under the reduced ceiling, spread over the teams above their reduced budget.
  const missingK = Math.max(0, actualTotalK - model.ceilingM * 1000 * factor);
  const overshootTotal = rows.reduce((n, row) => n + Math.max(0, row.actualK - row.budgetAfter), 0);
  const groups = rows.map(({ group, actualK, budgetAfter }) => {
    const utilAfter = budgetAfter > 0 ? (actualK / budgetAfter) * 100 : Infinity;
    const reduceK = overshootTotal > 0 ? (missingK * Math.max(0, actualK - budgetAfter)) / overshootTotal : 0;
    return {
      name: group.name,
      budgetKBefore: group.budgetK,
      budgetKAfter: round1(budgetAfter),
      actualK: round1(actualK),
      utilBeforePct: group.utilisationPct,
      utilAfterPct: Number.isFinite(utilAfter) ? round1(utilAfter) : null,
      status: utilAfter > 100 ? 'over' : utilAfter >= 90 ? 'tight' : 'ok',
      mustReducePct: actualK > 0 ? round1((reduceK / actualK) * 100) : 0,
    };
  });
  const reduceBy = new Map(groups.map((g) => [g.name, g.mustReducePct / 100]));

  const processes = model.agents
    .map((row) => {
      const share = reduceBy.get(row.group) ?? 0;
      return { family: row.family, group: row.group, agents: row.agents, runsPerDayBefore: row.runsPerDay, runsLostPerDay: Math.round(row.runsPerDay * share), lostPct: round1(share * 100), costSavedPerWeekEur: Math.round(row.costPerWeekEur * share), overprivileged: row.overprivileged, euHighRisk: row.euHighRisk };
    })
    .filter((row) => row.runsLostPerDay > 0)
    .sort((a, b) => b.runsLostPerDay - a.runsLostPerDay);

  const runsBefore = model.agents.reduce((n, row) => n + row.runsPerDay, 0);
  const runsLost = processes.reduce((n, row) => n + row.runsLostPerDay, 0);
  const throttledGroups = groups.filter((g) => g.mustReducePct > 0).map((g) => g.name);
  const overBy = round2(Math.max(0, model.actualM - ceilingAfter));

  return {
    cutPct: round1(cut),
    ceiling: {
      beforeM: model.ceilingM,
      afterM: round2(ceilingAfter),
      actualM: model.actualM,
      headroomM: round2(Math.max(0, ceilingAfter - model.actualM)),
      overByM: overBy,
      status: overBy > 0 ? 'over' : model.actualM / ceilingAfter >= 0.9 ? 'tight' : 'ok',
    },
    breakEvenCutPct: round1((1 - model.actualM / model.ceilingM) * 100),
    groups,
    agents: {
      production: model.agents.reduce((n, row) => n + row.agents, 0),
      affected: processes.reduce((n, row) => n + row.agents, 0),
      runsPerDayBefore: runsBefore,
      runsLostPerDay: runsLost,
      runsLostPct: runsBefore ? round1((runsLost / runsBefore) * 100) : 0,
      costSavedPerWeekEur: processes.reduce((n, row) => n + row.costSavedPerWeekEur, 0),
    },
    processes: processes.slice(0, 10),
    risks: riskEffects(model, throttledGroups),
    assumptions: ASSUMPTIONS,
  };
}
// END-MODEL

export { UNIT_TO_GROUP, ASSUMPTIONS, prepareWhatIf, simulateCreditCut };

export const WHAT_IF_TOOL_DEFINITIONS = [
  {
    name: 'simulate_credit_cut',
    description:
      'What-if: what happens if the AI credits are cut by a given percentage? Returns the new overall ceiling and headroom, each team\'s new utilisation, how many agent runs per day and which processes (agent families) would have to be throttled, which risks rise, and the break-even cut at which the ceiling is reached. Read-only; the model is a transparent rule set over sample data (see assumptions in the result), not a forecast. Use it for questions such as "Was passiert, wenn wir die AI-Credits um 30 % kürzen?".',
    inputSchema: {
      type: 'object',
      properties: { cut_percent: { type: 'number', minimum: 0, maximum: 90, description: 'Share of the AI credits that is taken away, for example 30.' } },
      required: ['cut_percent'],
      additionalProperties: false,
    },
  },
];

/** `loadTower` returns { data, source } like the connector's loadData. */
export function createWhatIfHandlers({ loadTower, ToolError }) {
  return {
    async simulate_credit_cut(args) {
      const cut = args.cut_percent;
      if (typeof cut !== 'number' || !Number.isFinite(cut) || cut < 0 || cut > 90) throw new ToolError('cut_percent must be a number between 0 and 90');
      const { data, source } = await loadTower();
      return { ...simulateCreditCut(prepareWhatIf(data), cut), view: { space: 'what-if', tab: 'overview' }, dataSource: source };
    },
  };
}
