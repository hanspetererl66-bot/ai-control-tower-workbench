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
  /** Small label above the title: which area the card is about. */
  area: string;
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

/** The infrastructure samples (Infrastructure Operations certificates, Infra-Operations-Fleet VMs). Optional: no cards without it. */
export type OpsBriefingData = {
  certs: { id: string; name: string; notAfter: string }[];
  fleet: {
    rules: Record<string, { yellow: number; red: number; appliesTo?: string }>;
    customers: { id: string; name: string; vms: [string, string, number, number, number, number, number, number, number][] }[];
  };
};

const DAY_MS = 86_400_000;

/** Whole days from `today` to an ISO date (yyyy-mm-dd), both read as UTC midnight. */
export function daysUntil(isoDate: string, today: Date): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - start) / DAY_MS);
}

const CONNECTOR = 'ai-control-tower';

/** Customers with at least one red production VM, by the same fixed rules as the Fleet Space. */
export function redCustomers(fleet: OpsBriefingData['fleet']): string[] {
  const { rules } = fleet;
  const red = (vm: OpsBriefingData['fleet']['customers'][number]['vms'][number]) => {
    const [, env, cpu, mem, disk, backup, patch, cert, reach] = vm;
    if (env !== 'prod') return false;
    if (!reach) return true;
    return cpu >= rules.cpuPct.red || mem >= rules.memPct.red || disk >= rules.diskPct.red || backup >= rules.backupAgeHours.red || patch >= rules.patchLagDays.red || cert <= rules.certExpiresInDays.red;
  };
  return fleet.customers.filter((c) => c.vms.some(red)).map((c) => c.name);
}

function opsCards(ops: OpsBriefingData, today: Date): BriefingCard[] {
  const cards: BriefingCard[] = [];
  const days = ops.certs.map((c) => ({ ...c, left: daysUntil(c.notAfter, today) }));
  const expired = days.filter((c) => c.left < 0);
  const soon = days.filter((c) => c.left >= 0 && c.left <= 30).sort((a, b) => a.left - b.left);
  if (expired.length || soon.length) {
    const first = soon[0] ?? expired[0];
    cards.push({
      id: 'certs',
      area: 'Infrastruktur',
      tone: expired.length || (soon[0] && soon[0].left <= 7) ? 'red' : 'amber',
      title: `${soon.length} ${soon.length === 1 ? 'Zertifikat läuft' : 'Zertifikate laufen'} in unter 30 Tagen ab${expired.length ? `, ${expired.length} abgelaufen` : ''}`,
      detail: `Als Nächstes: ${first.name} (${first.left < 0 ? `seit ${-first.left} ${-first.left === 1 ? 'Tag' : 'Tagen'} abgelaufen` : first.left === 0 ? 'läuft heute ab' : `noch ${first.left} ${first.left === 1 ? 'Tag' : 'Tagen'}`}).`,
      actions: [
        { kind: 'open', label: 'Infrastructure Operations öffnen', space: 'infra-ops' },
        { kind: 'ask', label: 'Erneuerung planen', connector: CONNECTOR, prompt: `Plane mit dem Tool plan_infra_change die Erneuerung des Zertifikats ${first.id}. Nur planen und die Prüfungen zeigen, nichts ausführen und nichts an n8n senden.` },
      ],
    });
  }
  const reds = redCustomers(ops.fleet);
  if (reds.length) {
    cards.push({
      id: 'fleet',
      area: 'Infrastruktur',
      tone: 'red',
      title: `${reds.length} ${reds.length === 1 ? 'Kunde ist' : 'Kunden sind'} im Fleet rot`,
      detail: `Mindestens eine Produktiv-VM ist rot, zum Beispiel bei ${reds.slice(0, 2).join(' und ')}. Von dort kannst du ein Ticket für den Operator öffnen.`,
      actions: [{ kind: 'open', label: 'Infra-Operations-Fleet öffnen', space: 'it-fleet' }],
    });
  }
  return cards;
}

export function buildBriefing(data: BriefingData, today: Date = new Date(), ops?: OpsBriefingData): BriefingCard[] {
  const cards: BriefingCard[] = [];

  const weakHigh = data.risks
    .filter((r) => r.severity === 'high' && r.progressPct < data.meta.riskThresholdPct)
    .sort((a, b) => a.progressPct - b.progressPct);
  if (weakHigh.length) {
    const worst = weakHigh[0];
    cards.push({
      id: 'risks',
      area: 'AI-Risiken',
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
      area: 'AI-Budget',
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
      area: 'AI-Compliance',
      tone: days <= 60 ? 'amber' : 'neutral',
      title: days === 0 ? 'EU-AI-Act-Audit ist heute' : `EU-AI-Act-Audit in ${days} ${days === 1 ? 'Tag' : 'Tagen'}`,
      detail: `${audit.auditLabel}: ${audit.complete} von ${audit.total} Nachweisen vollständig, ${audit.outstanding} offen.`,
      actions: [{ kind: 'open', label: 'Compliance öffnen', space: 'ai-control-tower', tab: 'risk' }],
    });
  }

  if (data.agents.unregistered > 0 || data.agents.overprivileged > 0) {
    cards.push({
      id: 'agents',
      area: 'AI-Agenten-Status',
      tone: 'amber',
      title: `${data.agents.unregistered} unregistrierte KI-Assets, ${data.agents.overprivileged} überprivilegierte Agenten`,
      detail: `${data.agents.production} von ${data.agents.total} Agenten laufen in Produktion.`,
      actions: [
        { kind: 'open', label: 'Agent Repository öffnen', space: 'ai-control-tower', tab: 'repo' },
        { kind: 'ask', label: 'Fund-Liste anzeigen', connector: CONNECTOR, prompt: 'Welche unregistrierten KI-Assets hat der Discovery-Scan gefunden?' },
      ],
    });
  }

  if (ops) cards.push(...opsCards(ops, today));

  // Always last: the one-page summary for whoever has to report upwards, on demand.
  cards.push({
    id: 'board',
    area: 'Board',
    tone: 'neutral',
    title: 'Board-Briefing auf Knopfdruck',
    detail: 'Eine Seite aus Risiken, Agenten, Budget und EU-AI-Act-Stand, direkt aus den Control-Tower-Daten.',
    actions: [
      {
        kind: 'ask',
        label: 'Im Chat erstellen',
        connector: CONNECTOR,
        prompt: 'Erstelle mit dem Skill board-briefing ein einseitiges Board-Briefing aus den AI-Control-Tower-Daten.',
      },
      {
        kind: 'ask',
        label: 'Als Space anlegen',
        connector: CONNECTOR,
        prompt:
          'Erstelle mit dem Skill board-briefing das einseitige Board-Briefing und lege es als Space „Board Briefing“ an. Nur Zahlen aus den Werkzeugantworten, Datenquelle und Stand auf der Seite nennen.',
      },
    ],
  });

  return cards;
}
