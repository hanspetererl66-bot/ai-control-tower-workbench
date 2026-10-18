/**
 * Suggested questions shown on the empty chat, Joule-style. Each one is routed to
 * the AI Control Tower connector, so it works without the person having to pick
 * a connector or type "Use only …" first.
 */

/** The connector's name as defined in connectors/control-tower/manifest.json. */
export const CONTROL_TOWER_CONNECTOR = 'ai-control-tower';

export type StarterPrompt = {
  /** Short label on the chip. */
  label: string;
  /** What is sent to the agent, and shown as the user's message. */
  prompt: string;
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
