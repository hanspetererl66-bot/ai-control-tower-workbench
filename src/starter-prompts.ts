/**
 * Names of the connectors the chat knows by name, and the shape of a starter prompt. The empty chat shows no
 * built-in suggestions; only the person's own prompts and favourite skills appear there.
 */

/** The connector's name as defined in connectors/ai-control-tower/manifest.json. */
export const CONTROL_TOWER_CONNECTOR = 'ai-control-tower';

/** Personal settings sync and groups (connectors/werkbank-workspace). */
export const WORKSPACE_CONNECTOR = 'werkbank-workspace';

export type StarterPrompt = {
  /** Short label on the chip. */
  label: string;
  /** What is sent to the agent, and shown as the user's message. */
  prompt: string;
  /** Connector the question is routed to. Defaults to the AI Control Tower connector. */
  connector?: string;
};

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    label: 'Risiken unter 40 % mitigiert',
    prompt: 'Welche Risiken sind unter 40 % mitigiert?',
  },
  {
    label: 'High-Risiken mit Owner',
    prompt: 'Zeig mir alle High-Severity-Risiken mit Verantwortlichem und ETA.',
  },
  {
    label: 'Agenten in Produktion',
    prompt: 'Wie viele Agenten sind in Produktion, und wie viele davon sind überprivilegiert?',
  },
  {
    label: 'Top-Agenten nach Runs',
    prompt: 'Liste die 12 Produktions-Agenten mit den meisten Runs pro Tag.',
  },
  {
    label: 'Unregistrierte KI-Assets',
    prompt: 'Welche unregistrierten KI-Assets hat der Discovery-Scan gefunden?',
  },
  {
    label: 'Budget pro Team',
    prompt: 'Welche Teams liegen über dem KI-Budget?',
  },
  {
    label: 'Zahlungsverzug-Prognose',
    prompt: 'Welche offenen Sub4Me-Rechnungen werden voraussichtlich mehr als 14 Tage zu spät bezahlt?',
    // predict_late_payments lives in the Sub4Me connector, not in the AI Control Tower connector.
    connector: 'sub4me',
  },
];

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when the Control Tower connector is among the configured connectors. */
export function hasControlTowerConnector(names: Iterable<string>): boolean {
  const wanted = normalized(CONTROL_TOWER_CONNECTOR);
  for (const name of names) if (normalized(name) === wanted) return true;
  return false;
}
