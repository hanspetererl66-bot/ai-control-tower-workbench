/**
 * Spoken navigation: "Zeig mir die Risiken", "Öffne Sub4Me Tickets", "go to the knowledge graph".
 *
 * The parser is deliberately strict. A message only counts as a command when it starts with a
 * navigation verb and names a known target; everything else is a normal question for the agent.
 * Pure and synchronous, so it is covered by test/voice-commands.test.mjs.
 */

export type NavTarget = { space: string; tab?: string; label: string };

type Entry = { space: string; tab?: string; label: string; words: RegExp };

// Longer, more specific phrases first: the first match wins.
const TARGETS: Entry[] = [
  { space: 'ai-control-tower', tab: 'risk', label: 'Risk & Compliance', words: /\b(risiken?|risks?|compliance|eu ai act|audit)\b/ },
  { space: 'ai-control-tower', tab: 'repo', label: 'Agent Repository', words: /\b(agent(en)?[ -]?(repository|register|registry|uebersicht|liste)|agents?|agenten)\b/ },
  { space: 'ai-control-tower', tab: 'gov', label: 'Model Governance', words: /\b(model[ -]?governance|governance|budget|modelle?|models?)\b/ },
  { space: 'ai-control-tower', tab: 'tokens', label: 'Token Economics', words: /\b(token[ -]?economics|tokens?|token ?kosten)\b/ },
  { space: 'ai-control-tower', tab: 'kpis', label: 'DORA Metrics', words: /\b(dora|kennzahlen|kpis?)\b/ },
  { space: 'ai-control-tower', tab: 'usage', label: 'Agent Usage', words: /\b(agent[ -]?usage|nutzung)\b/ },
  { space: 'ai-control-tower', tab: 'policies', label: 'Policies & Framework', words: /\b(policies|richtlinien|policy|framework)\b/ },
  { space: 'ai-control-tower', tab: 'devops', label: 'Dev/Ops', words: /\b(dev ?ops|engineering)\b/ },
  { space: 'ai-control-tower', tab: 'board', label: 'Executive Dashboard', words: /\b(executive|board|vorstand)\b/ },
  { space: 'sub4me', tab: 'tickets', label: 'Sub4Me Tickets', words: /\b(tickets?)\b/ },
  { space: 'sub4me', tab: 'contracts', label: 'Sub4Me Contracts', words: /\b(vertraege?|vertrag|contracts?)\b/ },
  { space: 'sub4me', tab: 'usage', label: 'Sub4Me AI units', words: /\b(ai[ -]?units?|verbrauch|consumption)\b/ },
  { space: 'ai-control-tower', label: 'AI Control Tower', words: /\b(control ?tower|kontrollturm)\b/ },
  { space: 'sub4me', label: 'Sub4Me', words: /\b(sub ?4 ?me|sub for me|kundenportal|customer portal)\b/ },
  { space: 'skill-marketplace', label: 'Skill Marketplace', words: /\b(skill[ -]?(marketplace|marktplatz)|skills?)\b/ },
  { space: 'automation-dashboard', label: 'Automation Dashboard', words: /\b(automation|automatisierung|n8n|workflows?)\b/ },
  { space: 'knowledge-graph', label: 'Knowledge Graph', words: /\b(knowledge ?graph|wissensgraph|graph)\b/ },
  { space: 'call-transcripts', label: 'Call Transcripts', words: /\b(calls?|anrufe?|telefonate?|transkripte?|transcripts?)\b/ },
  { space: 'customer-emails', label: 'Customer E-Mails', words: /\b(e ?mails?|mails?|kundenmails?)\b/ },
];

const LEAD_VERB =
  /^(?:(?:bitte|hey|ok|okay|joule)[, ]+)*(?:zeig(?:e)?(?: mir)?|oeffne|oeffnen|gehe? (?:zu|zum|zur|in|nach)|wechsle? (?:zu|zum|zur|in)|spring(?:e)? (?:zu|zum|zur)|bring mich (?:zu|zum|zur)|show(?: me)?|open|go to|switch to|take me to|navigate to)\b/;

/** Lower-case, strip diacritics and punctuation so "Öffne die Verträge!" matches "oeffne ... vertraege". */
export function normalizeCommand(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The navigation target a spoken message asks for, or null when it is not a navigation command. */
export function parseNavCommand(text: string): NavTarget | null {
  const heard = normalizeCommand(text);
  if (!heard || heard.split(' ').length > 12) return null;
  const lead = LEAD_VERB.exec(heard);
  if (!lead) return null;
  const rest = heard.slice(lead[0].length).trim();
  if (!rest) return null;
  for (const entry of TARGETS) {
    if (entry.words.test(rest)) return { space: entry.space, tab: entry.tab, label: entry.label };
  }
  return null;
}
