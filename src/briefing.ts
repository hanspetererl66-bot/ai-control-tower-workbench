/**
 * Proactive briefing: Joule-style cards on the empty chat that tell the person what needs
 * attention before they ask. Built from the Control Tower data (examples/control-tower/data.json),
 * so the numbers match the Space and the connector. Pure, so test/briefing.test.mjs covers it.
 */

export type BriefingAction =
  | { kind: 'open'; label: string; space: string; tab?: string }
  | { kind: 'ask'; label: string; prompt: string; connector?: string };

export type BriefingCategoryId = 'ai' | 'sales' | 'renewals' | 'ops' | 'board';
/** The groups of cards under the chat, in the order they are shown. `cards` is every card a group can show (for the settings). */
export const BRIEFING_CATEGORIES: Array<{ id: BriefingCategoryId; title: string; cards: Array<{ id: string; label: string }> }> = [
  { id: 'ai', title: 'AI', cards: [{ id: 'risks', label: 'AI risks below the mitigation threshold' }, { id: 'budget', label: 'Teams over the AI budget' }, { id: 'audit', label: 'EU AI Act audit' }, { id: 'agents', label: 'Agent status' }] },
  { id: 'sales', title: 'Sales', cards: [{ id: 'sales-desk', label: 'Offers waiting for the deal desk' }, { id: 'sales-overdue', label: 'Overdue next steps' }] },
  { id: 'renewals', title: 'Renewals', cards: [{ id: 'renew-decisions', label: 'Renewal decisions due' }, { id: 'renew-lapsed', label: 'Lapsed contracts' }] },
  { id: 'ops', title: 'Infrastruktur', cards: [{ id: 'certs', label: 'Certificates about to expire' }, { id: 'fleet', label: 'Red customers in the fleet' }] },
  { id: 'board', title: 'Board', cards: [{ id: 'board', label: 'Board briefing on a button' }] },
];
/** Key under which a whole group is switched off in the settings. */
export const categoryKey = (id: BriefingCategoryId) => `cat:${id}`;

export type BriefingCard = {
  id: string;
  category: BriefingCategoryId;
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

/** Sales pipeline and renewal samples. Optional: no cards without them. */
export type SalesBriefingData = {
  asOf: string;
  deals: { id: string; stage: string; account: string; title: string; value: number | null; approval?: string; next?: { text: string; due: string } }[];
};
export type RenewalsBriefingData = {
  cases: { id: string; customer: string; product: string; status: string; decisionDate: string; annualEur: number }[];
};
export type BriefingExtra = { ops?: OpsBriefingData; sales?: SalesBriefingData; renewals?: RenewalsBriefingData };

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
      category: 'ops',
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
      category: 'ops',
      area: 'Infrastruktur',
      tone: 'red',
      title: `${reds.length} ${reds.length === 1 ? 'Kunde ist' : 'Kunden sind'} im Fleet rot`,
      detail: `Mindestens eine Produktiv-VM ist rot, zum Beispiel bei ${reds.slice(0, 2).join(' und ')}. Von dort kannst du ein Ticket für den Operator öffnen.`,
      actions: [{ kind: 'open', label: 'Infra-Operations-Fleet öffnen', space: 'it-fleet' }],
    });
  }
  return cards;
}

const eur = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} Mio. €` : `${Math.round(n / 1000)} k€`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function salesCards(sales: SalesBriefingData, today: Date): BriefingCard[] {
  const cards: BriefingCard[] = [];
  const waiting = sales.deals.filter((d) => d.stage === 'sell' && /^pending/i.test(d.approval ?? ''));
  if (waiting.length) {
    const sum = waiting.reduce((a, d) => a + (d.value ?? 0), 0);
    cards.push({
      id: 'sales-desk', category: 'sales', area: 'Sales', tone: 'amber',
      title: `${plural(waiting.length, 'Angebot wartet', 'Angebote warten')} auf den Deal Desk`,
      detail: `${waiting.map((d) => `${d.account} ${d.id} (${eur(d.value ?? 0)})`).join(', ')}: zusammen ${eur(sum)}.`,
      actions: [
        { kind: 'open', label: 'Pipeline öffnen', space: 'sales' },
        { kind: 'ask', label: 'Freigabe-Unterlagen vorbereiten', connector: CONNECTOR, prompt: `Bereite für den Deal Desk eine kurze Freigabe-Unterlage für die Angebote ${waiting.map((d) => d.id).join(' und ')} vor: Kunde, Wert, Rabatt, Grund der Prüfung, Risiken. Nur Zahlen aus den Daten, nichts versenden.` },
      ],
    });
  }
  const overdue = sales.deals
    .filter((d) => d.next && d.stage !== 'contract' && d.stage !== 'interest' && daysUntil(d.next.due, today) < 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (overdue.length) {
    cards.push({
      id: 'sales-overdue', category: 'sales', area: 'Sales', tone: 'amber',
      title: `${plural(overdue.length, 'nächster Schritt ist', 'nächste Schritte sind')} überfällig`,
      detail: overdue.slice(0, 3).map((d) => `${d.account} ${d.id} (seit ${-daysUntil(d.next!.due, today)} ${-daysUntil(d.next!.due, today) === 1 ? 'Tag' : 'Tagen'})`).join('; ') + '.',
      actions: [
        { kind: 'open', label: 'Pipeline öffnen', space: 'sales' },
        { kind: 'ask', label: 'Mail-Entwurf an Owner', connector: CONNECTOR, prompt: `Erstelle für die überfälligen nächsten Schritte der Deals ${overdue.map((d) => d.id).join(', ')} je einen kurzen Gmail-Entwurf an den Owner mit der Bitte um ein Update. Nur Entwürfe anlegen, nichts senden.` },
      ],
    });
  }
  return cards;
}

function renewalCards(renewals: RenewalsBriefingData, today: Date): BriefingCard[] {
  const cards: BriefingCard[] = [];
  const open = renewals.cases.filter((c) => c.status !== 'Lapsed');
  const late = open.filter((c) => daysUntil(c.decisionDate, today) < 0);
  const soon = open.filter((c) => { const d = daysUntil(c.decisionDate, today); return d >= 0 && d <= 14; });
  if (late.length || soon.length) {
    const sum = [...late, ...soon].reduce((a, c) => a + c.annualEur, 0);
    const first = late[0] ?? soon[0];
    cards.push({
      id: 'renew-decisions', category: 'renewals', area: 'Renewals', tone: late.length ? 'red' : 'amber',
      title: late.length
        ? `${plural(late.length, 'Entscheidung', 'Entscheidungen')} überfällig${soon.length ? `, ${soon.length} weitere in 14 Tagen` : ''}`
        : `${plural(soon.length, 'Entscheidung', 'Entscheidungen')} in 14 Tagen fällig`,
      detail: `${first.customer}, ${first.product} (${eur(first.annualEur)}) zuerst. Zusammen ${eur(sum)} pro Jahr.`,
      actions: [
        { kind: 'open', label: 'Renewals öffnen', space: 'renewals' },
        { kind: 'ask', label: 'Reihenfolge erklären', connector: CONNECTOR, prompt: 'Welche Verlängerungsentscheidungen sind überfällig oder in den nächsten 14 Tagen fällig, und in welcher Reihenfolge sollte ich sie angehen? Begründe kurz mit Wert und Risiko.' },
      ],
    });
  }
  const lapsed = renewals.cases.filter((c) => c.status === 'Lapsed');
  if (lapsed.length) {
    const sum = lapsed.reduce((a, c) => a + c.annualEur, 0);
    cards.push({
      id: 'renew-lapsed', category: 'renewals', area: 'Renewals', tone: 'amber',
      title: `${plural(lapsed.length, 'Vertrag', 'Verträge')} abgelaufen, ${eur(sum)} ohne Vertrag`,
      detail: lapsed.map((c) => `${c.product} bei ${c.customer} (${eur(c.annualEur)})`).join(', ') + '.',
      actions: [
        { kind: 'open', label: 'Renewals öffnen', space: 'renewals' },
        { kind: 'ask', label: 'Rückholplan vorschlagen', connector: CONNECTOR, prompt: 'Schlage für die abgelaufenen Verträge einen Rückholplan vor: nächste Schritte, Ansprechpartner, Risiken. Nur vorschlagen, nichts versenden.' },
      ],
    });
  }
  return cards;
}

export function buildBriefing(data: BriefingData, today: Date = new Date(), extra: BriefingExtra = {}): BriefingCard[] {
  const cards: BriefingCard[] = [];

  const weakHigh = data.risks
    .filter((r) => r.severity === 'high' && r.progressPct < data.meta.riskThresholdPct)
    .sort((a, b) => a.progressPct - b.progressPct);
  if (weakHigh.length) {
    const worst = weakHigh[0];
    cards.push({
      id: 'risks',
      category: 'ai',
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
      category: 'ai',
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
      category: 'ai',
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
      category: 'ai',
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

  // Order of the groups: AI, Sales, Renewals, Infrastruktur, Board (the board card stays last).
  if (extra.sales) cards.push(...salesCards(extra.sales, today));
  if (extra.renewals) cards.push(...renewalCards(extra.renewals, today));
  if (extra.ops) cards.push(...opsCards(extra.ops, today));

  // Always last: the one-page summary for whoever has to report upwards, on demand.
  cards.push({
    id: 'board',
    category: 'board',
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
