export type PrivacyInfo = { webSearch: boolean; connectors: string[]; model: string; mode: string };

/** One line for the privacy bar: what the assistant may use and where the text goes. */
export function privacySummary(i: PrivacyInfo): { web: string; connectors: string; model: string; actions: string } {
  return {
    web: i.webSearch ? 'Web search on' : 'Web search off',
    connectors: i.connectors.length ? `${i.connectors.length} connector${i.connectors.length === 1 ? '' : 's'}: ${i.connectors.join(', ')}` : 'No connector',
    model: i.model ? `Text goes to the model provider (OpenRouter · ${i.model})` : 'Text goes to the model provider (OpenRouter)',
    actions: i.mode === 'auto' ? 'Actions run without asking' : i.mode === 'chat' ? 'No tools' : 'Asks before actions that change something',
  };
}
