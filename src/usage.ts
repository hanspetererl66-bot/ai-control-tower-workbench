/** Rough token and cost estimate of a conversation (about four characters per token). Not a bill: the provider's own figures count. */
export type UsageMessage = { role: 'user' | 'agent'; text: string; tools?: Array<{ rawInput?: Record<string, unknown> }> };
export type Usage = { inTokens: number; outTokens: number; eur: number | null };

export const tokensOf = (text: string): number => Math.ceil(text.length / 4);

export function estimateUsage(messages: UsageMessage[], priceInPerM = 0, priceOutPerM = 0): Usage {
  let inTokens = 0, outTokens = 0, history = 0;
  for (const m of messages) {
    if (m.role === 'user') {
      history += tokensOf(m.text);
    } else {
      const tools = (m.tools ?? []).reduce((a, t) => a + tokensOf(JSON.stringify(t.rawInput ?? {})), 0);
      inTokens += history + tools;
      outTokens += tokensOf(m.text) + tools;
      history += tokensOf(m.text);
    }
  }
  const eur = priceInPerM > 0 || priceOutPerM > 0 ? (inTokens / 1e6) * priceInPerM + (outTokens / 1e6) * priceOutPerM : null;
  return { inTokens, outTokens, eur };
}

export const compact = (n: number): string => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const euro = (n: number): string => `€${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
