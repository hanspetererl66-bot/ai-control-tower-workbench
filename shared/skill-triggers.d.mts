export type Triggers = { should: string[]; shouldNot: string[]; shouldNotLive?: string[] };
export type TriggerCase = { prompt: string; expect: 'pick' | 'not pick'; picked: string | null; ok: boolean };
export const MIN_EXAMPLES: number;
export const MAX_EXAMPLES: number;
export function checkTriggers(value: unknown): string[];
export function words(text: string): string[];
export function lexicalChoose(prompt: string, skills: Array<{ name: string; description: string }>, opts?: { min?: number }): string | null;
export function evaluateTriggers(
  all: Array<{ name: string; description: string; triggers?: Triggers | null }>,
  choose: (prompt: string, skills: Array<{ name: string; description: string }>) => string | null | Promise<string | null>,
  opts?: { live?: boolean },
): Promise<{ results: Array<{ skill: string; missing: boolean; cases: TriggerCase[] }>; failures: Array<TriggerCase & { skill: string }>; missing: string[] }>;
