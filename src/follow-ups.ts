import { splitTool } from './chat-sources-split.ts';
import type { ToolCall } from './acp.ts';

const GERMAN = /\b(und|der|die|das|nicht|ist|sind|mit|für|wir|ein|eine|zu|den|im|auf|von|es)\b/gi;
export function isGerman(text: string): boolean {
  const words = text.split(/\s+/).length || 1;
  return (text.match(GERMAN)?.length ?? 0) / words > 0.12;
}

type Rule = { when: (names: string, text: string) => boolean; de: string[]; en: string[] };

const RULES: Rule[] = [
  { when: (n) => /ticket|enrich/.test(n), de: ['Welche Tickets sind am dringendsten und warum?', 'Gibt es ein ähnliches Ticket bei anderen Kunden?'], en: ['Which tickets are most urgent and why?', 'Is there a similar ticket at other customers?'] },
  { when: (n, t) => /renewal|contract|invoice/.test(n) || /renewal|verlängerung|vertrag/i.test(t), de: ['Welche Verlängerung ist am dringendsten?', 'Was sollte ich im Kundengespräch ansprechen?'], en: ['Which renewal is most urgent?', 'What should I raise in the customer call?'] },
  { when: (n, t) => /risk|risiko|audit/.test(n) || /risiko|risk/i.test(t), de: ['Welche Maßnahmen reduzieren das Risiko am schnellsten?', 'Wer ist verantwortlich und bis wann?'], en: ['Which actions reduce the risk fastest?', 'Who owns it and by when?'] },
  { when: (n, t) => /budget|credit|cost/.test(n) || /budget|kosten|cost/i.test(t), de: ['Was passiert, wenn die Credits um 20 % gekürzt werden?', 'Welches Team verbraucht am meisten?'], en: ['What happens if credits are cut by 20 %?', 'Which team uses the most?'] },
  { when: (n) => /web|search_sap|fetch_web|sap_help|community/.test(n), de: ['Nenne die wichtigsten Quellen mit Link.', 'Was ist daran neu oder geändert?'], en: ['List the key sources with links.', 'What is new or changed?'] },
  { when: (n) => /workflow|n8n/.test(n), de: ['Welche Workflows sind fehlgeschlagen und warum?', 'Wie oft liefen sie in der letzten Woche?'], en: ['Which workflows failed and why?', 'How often did they run last week?'] },
];
const GENERIC = {
  de: ['Fasse das in drei Sätzen für den Vorstand zusammen.', 'Was sind die größten Unsicherheiten dabei?', 'Welche nächsten Schritte empfiehlst du?'],
  en: ['Summarise this in three sentences for the board.', 'What are the biggest uncertainties?', 'Which next steps do you recommend?'],
};

/** Up to three follow-up questions for an answer, chosen from the tools used and the wording. No model call. */
export function followUps(text: string, tools: ToolCall[], language?: 'de' | 'en'): string[] {
  if (!text.trim()) return [];
  const lang = language ?? (isGerman(text) ? 'de' : 'en');
  const names = tools.map((t) => { const s = splitTool(t); return `${s.ext}_${s.tool}`; }).join(' ').toLowerCase();
  const out: string[] = [];
  for (const rule of RULES) if (rule.when(names, text)) for (const q of rule[lang]) if (!out.includes(q)) out.push(q);
  if (/^\s*\|.+\|\s*$/m.test(text)) out.push(lang === 'de' ? 'Stelle das als Diagramm dar.' : 'Show this as a chart.');
  for (const q of GENERIC[lang]) if (!out.includes(q)) out.push(q);
  return out.slice(0, 3);
}
