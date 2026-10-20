/**
 * Proactive briefing: Joule-style cards on the empty chat that tell the person what needs
 * attention before they ask. Built from the Control Tower data (examples/control-tower/data.json),
 * so the numbers match the Space and the connector. Pure, so test/briefing.test.mjs covers it.
 */

export type BriefingAction =
  | { kind: 'open'; label: string; space: string; tab?: string }
  | { kind: 'ask'; label: string; prompt: string; connector?: string };

export type BriefingCard = {
  id: string;
  tone: 'red' | 'amber' | 'neutral';
  title: string;
  detail: string;
  actions: BriefingAction[];
};

export type BriefingData = {
  meta: { riskThresholdPct: number };
  risks: { id: string; severity: string; title: string; owner: string; progressPct: number }[];
  agents: { total: number; production: number; unregistered: number; overprivileged: number };
  budget: { groups: { name: string; utilisationPct: number }[] };
  compliance: { euAiAct: { auditDate: string; auditLabel: string; total: number; complete: number; outstanding: number } };
};

const DAY_MS = 86_400_000;

/** Whole days from `today` to an ISO date (yyyy-mm-dd), both read as UTC midnight. */
export function daysUntil(isoDate: string, today: Date): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - start) / DAY_MS);
}

const CONNECTOR = 'ai-control-tower';

export function buildBriefing(data: BriefingData, today: Date = new Date()): BriefingCard[] {
  const cards: BriefingCard[] = [];

  const weakHigh = data.risks
    .filter((r) => r.severity === 'high' && r.progressPct < data.meta.riskThresholdPct)
    .sort((a, b) => a.progressPct - b.progressPct);
  if (weakHigh.length) {
    const worst = weakHigh[0];
    cards.push({
      id: 'risks',
      tone: 'red',
      title: `${weakHigh.length} High-Risiken unter ${data.meta.riskThresholdPct} % mitigiert`,
      detail: `Am weitesten hinten: ${worst.title} (${worst.progressPct} %, Owner: ${worst.owner}).`,
      actions: [
        { kind: 'open', label: 'Risiko-Register öffnen', space: 'ai-control-tower', tab: 'risk' },
        {
          kind: 'ask',
          label: 'Mail-Entwurf an Owner',
          connector: CONNECTOR,
          prompt: `Erstelle für jedes High-Risiko unter ${data.meta.riskThresholdPct} % Mitigation einen kurzen Gmail-Entwurf an den jeweiligen Owner mit Bitte um ein Statusupdate. Nur Entwürfe anlegen, nichts senden.`,
        },
      ],
    });
  }

  const over = data.budget.groups.filter((g) => g.utilisationPct > 100).sort((a, b) => b.utilisationPct - a.utilisationPct);
  if (over.length) {
    cards.push({
      id: 'budget',
      tone: 'amber',
      title: `${over.length} ${over.length === 1 ? 'Team liegt' : 'Teams liegen'} über dem KI-Budget`,
      detail: over.map((g) => `${g.name} ${g.utilisationPct} %`).join(', ') + '.',
      actions: [
        { kind: 'open', label: 'Model Governance öffnen', space: 'ai-control-tower', tab: 'gov' },
        { kind: 'ask', label: 'Ursachen erklären', connector: CONNECTOR, prompt: 'Welche Teams liegen über dem KI-Budget, und woran liegt das?' },
      ],
    });
  }

  const audit = data.compliance.euAiAct;
  const days = daysUntil(audit.auditDate, today);
  if (days >= 0) {
    cards.push({
      id: 'audit',
      tone: days <= 60 ? 'amber' : 'neutral',
      title: days === 0 ? 'EU-AI-Act-Audit ist heute' : `EU-AI-Act-Audit in ${days} ${days === 1 ? 'Tag' : 'Tagen'}`,
      detail: `${audit.auditLabel}: ${audit.complete} von ${audit.total} Nachweisen vollständig, ${audit.outstanding} offen.`,
      actions: [{ kind: 'open', label: 'Compliance öffnen', space: 'ai-control-tower', tab: 'risk' }],
    });
  }

  if (data.agents.unregistered > 0 || data.agents.overprivileged > 0) {
    cards.push({
      id: 'agents',
      tone: 'amber',
      title: `${data.agents.unregistered} unregistrierte KI-Assets, ${data.agents.overprivileged} überprivilegierte Agenten`,
      detail: `${data.agents.production} von ${data.agents.total} Agenten laufen in Produktion.`,
      actions: [
        { kind: 'open', label: 'Agent Repository öffnen', space: 'ai-control-tower', tab: 'repo' },
        { kind: 'ask', label: 'Fund-Liste anzeigen', connector: CONNECTOR, prompt: 'Welche unregistrierten KI-Assets hat der Discovery-Scan gefunden?' },
      ],
    });
  }

  return cards;
}
