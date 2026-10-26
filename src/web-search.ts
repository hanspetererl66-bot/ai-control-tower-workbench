/** Per-conversation Web Search switch: the instruction sent with every turn and the guard for web tools. */

export const WEB_SEARCH_ON_NOTE =
  'WEB SEARCH IS ON for this conversation — you may look up current public information on the web when it helps, and you should name your sources with links. Customer and company data still comes from the connectors first. For SAP sites, Handelsblatt and FAZ use the connector tools list_web_sources, fetch_web_page and search_web_sources (approved addresses only; never bypass a login or paywall).';
export const WEB_SEARCH_OFF_NOTE =
  'WEB SEARCH IS OFF for this conversation — do not use any web search, web scraping, fetch-URL or browsing tool. Answer from the connectors, attached files and your own knowledge, and say so when the question needs current information from the web.';
export const WEB_SEARCH_BLOCKED_NOTE =
  '\n\n_Web Search is switched off for this conversation, so a web lookup was stopped. Switch it on in the Integrations menu (sparkle icon) and ask again._';

export const webSearchNote = (enabled: boolean): string => (enabled ? WEB_SEARCH_ON_NOTE : WEB_SEARCH_OFF_NOTE);

const WEB_TOOL =
  /(?:^|[_\-\s.])(?:web[_\-\s]?(?:search|scrape|fetch|browse|browser)|search[_\-\s]?web|internet[_\-\s]?search|fetch[_\-\s]?(?:url|web)|browse[_\-\s]?(?:web|url|page)|brave[_\-\s]?(?:web[_\-\s]?)?search|tavily|duckduckgo|serper|perplexity)/i;

/** True for tools that reach out to the open web (not for connectors such as Sub4Me, n8n or the Control Tower). */
export function isWebTool(call: { toolName?: string; title?: string }): boolean {
  return WEB_TOOL.test(call.toolName ?? '') || WEB_TOOL.test(call.title ?? '');
}

/** Model providers shown in the Model menu. Only OpenRouter is wired up in this design study. */
export const MODEL_PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', available: true },
  { id: 'sap-genai-hub', label: 'SAP Generative AI Hub', available: false },
  { id: 'azure-openai', label: 'Azure OpenAI', available: false },
  { id: 'anthropic', label: 'Anthropic', available: false },
  { id: 'google', label: 'Google Gemini', available: false },
] as const;
