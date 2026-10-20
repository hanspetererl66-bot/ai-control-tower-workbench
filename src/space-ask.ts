/** A Space can ask Joule a question ("Joule fragen"). The page posts { type: 'wb:ask', prompt }; this is the host's check. */
export const MAX_ASK_LENGTH = 600;

/** The prompt to send, or null when the message is not a valid ask. */
export function parseAskMessage(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as { type?: unknown; prompt?: unknown };
  if (message.type !== 'wb:ask' || typeof message.prompt !== 'string') return null;
  const prompt = message.prompt.trim();
  return prompt && prompt.length <= MAX_ASK_LENGTH ? prompt : null;
}
