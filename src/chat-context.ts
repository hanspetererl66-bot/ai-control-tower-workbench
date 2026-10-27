/**
 * What shapes the chat besides the message itself: a persona (tone, depth, focus), the person's own slash commands
 * and the morning briefing built from memory and open approvals. Kept on this computer (localStorage).
 */
export type Persona = { id: string; name: string; instruction: string };
export const BUILTIN_PERSONAS: Persona[] = [
  { id: 'sales', name: 'Sales', instruction: 'Speak to a sales lead: pipeline, renewals, next best action. Short, concrete, with a clear next step per customer.' },
  { id: 'controlling', name: 'Controlling', instruction: 'Speak to a controller: figures first, with source and period, deviations against plan and budget, assumptions named. No marketing language.' },
  { id: 'executive', name: 'Executive', instruction: 'Speak to an executive: the answer in two sentences, then at most three bullets with the decision needed and the risk. No detail unless asked.' },
];
export type PersonaState = { active: string; custom: Persona[] };
export const PERSONA_KEY = 'werkbank.personas';
export const MAX_CUSTOM = 8;

const clean = (t: unknown, n: number) => String(t ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, n);

export function loadPersonas(store: Pick<Storage, 'getItem'>): PersonaState {
  try {
    const v = JSON.parse(store.getItem(PERSONA_KEY) ?? 'null');
    if (!v) return { active: '', custom: [] };
    const custom: Persona[] = (Array.isArray(v.custom) ? v.custom : [])
      .filter((p: any) => p && typeof p.id === 'string' && clean(p.name, 40) && clean(p.instruction, 600))
      .map((p: any) => ({ id: p.id.slice(0, 40), name: clean(p.name, 40), instruction: clean(p.instruction, 600) })).slice(0, MAX_CUSTOM);
    const all = [...BUILTIN_PERSONAS, ...custom];
    return { active: all.some((p) => p.id === v.active) ? v.active : '', custom };
  } catch { return { active: '', custom: [] }; }
}
export const savePersonas = (store: Pick<Storage, 'setItem'>, s: PersonaState) => { try { store.setItem(PERSONA_KEY, JSON.stringify(s)); } catch { /* ignore */ } };
export const allPersonas = (s: PersonaState): Persona[] => [...BUILTIN_PERSONAS, ...s.custom];
export const activePersona = (s: PersonaState): Persona | undefined => allPersonas(s).find((p) => p.id === s.active);

export function addPersona(s: PersonaState, name: string, instruction: string): { state: PersonaState; error?: string } {
  const n = clean(name, 40), i = clean(instruction, 600);
  if (!n || !i) return { state: s, error: 'A persona needs a name and an instruction.' };
  if (allPersonas(s).some((p) => p.name.toLowerCase() === n.toLowerCase())) return { state: s, error: 'This name is taken.' };
  if (s.custom.length >= MAX_CUSTOM) return { state: s, error: `At most ${MAX_CUSTOM} own personas.` };
  const id = `p-${Date.now().toString(36)}${s.custom.length}`;
  return { state: { ...s, custom: [...s.custom, { id, name: n, instruction: i }] } };
}
export const removePersona = (s: PersonaState, id: string): PersonaState => ({ active: s.active === id ? '' : s.active, custom: s.custom.filter((p) => p.id !== id) });

export function personaNote(s: PersonaState): string {
  const p = activePersona(s);
  return p ? `PERSONA "${p.name}" — the person chose this style for the conversation. ${p.instruction} It never overrides safety rules, tool permissions or the request itself.` : '';
}

/* ---- Slash commands ---- */
export type Command = { name: string; prompt: string };
export const COMMAND_KEY = 'werkbank.commands';
export const MAX_COMMANDS = 20;
export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;
/** {args}: what is typed after the command. {memory}: the memory entries in context. {approvals}: open requests. */
export const BUILTIN_COMMANDS: Command[] = [
  { name: 'briefing', prompt: 'Create my briefing for today. What you know about me and my work:\n{memory}\n\nOpen approvals waiting for a decision: {approvals}.\n\nStructure: 1) the three priorities of the day, 2) risks and deviations from the AI Control Tower, 3) decisions and approvals I have to make, 4) what I should prepare. Short, concrete, no filler. {args}' },
  { name: 'make-skill', prompt: 'Turn the workflow of this conversation into a reusable skill. Do not create or save any file. Write the draft as ONE code block in SKILL.md format: front matter with name (kebab-case) and a specific description of when to use it, then the steps in order, the inputs it needs, the sources it reads and the shape of the result. Leave out anything personal or one-off. After the block, list in two lines what I should check before I install it. {args}' },
  { name: 'board', prompt: 'Summarise the current state of risks, budget and open audit points on one page for the board: result first, then three numbers, then the decision needed. {args}' },
  { name: 'renewals', prompt: 'Which renewals in the next 90 days are red or yellow? Give the reason per customer and a next step. {args}' },
];

export function loadCommands(store: Pick<Storage, 'getItem'>): Command[] {
  try {
    const v = JSON.parse(store.getItem(COMMAND_KEY) ?? 'null');
    return (Array.isArray(v) ? v : []).filter((c: any) => c && NAME_RE.test(String(c.name)) && clean(c.prompt, 1500))
      .map((c: any) => ({ name: String(c.name), prompt: String(c.prompt).trim().slice(0, 1500) })).slice(0, MAX_COMMANDS);
  } catch { return []; }
}
export const saveCommands = (store: Pick<Storage, 'setItem'>, c: Command[]) => { try { store.setItem(COMMAND_KEY, JSON.stringify(c)); } catch { /* ignore */ } };
/** Own commands win over built-ins of the same name. */
export const allCommands = (own: Command[]): Command[] => [...own, ...BUILTIN_COMMANDS.filter((b) => !own.some((o) => o.name === b.name))];

export function addCommand(own: Command[], name: string, prompt: string): { commands: Command[]; error?: string } {
  const n = name.trim().replace(/^\//, '').toLowerCase();
  if (!NAME_RE.test(n)) return { commands: own, error: 'Use letters, digits, - or _ (up to 30), for example briefing.' };
  if (!clean(prompt, 1500)) return { commands: own, error: 'Write what the command should ask.' };
  if (own.length >= MAX_COMMANDS && !own.some((c) => c.name === n)) return { commands: own, error: `At most ${MAX_COMMANDS} commands.` };
  return { commands: [...own.filter((c) => c.name !== n), { name: n, prompt: prompt.trim().slice(0, 1500) }] };
}

export type CommandContext = { memory: string; approvals: number };
/** The prompt for "/name args", or null when the text is not a known command. */
export function expandCommand(text: string, commands: Command[], ctx: CommandContext): string | null {
  const m = /^\/([a-z0-9][a-z0-9_-]{0,29})(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const cmd = commands.find((c) => c.name === m[1].toLowerCase());
  if (!cmd) return null;
  const args = (m[2] ?? '').trim();
  const hasArgs = cmd.prompt.includes('{args}');
  let out = cmd.prompt
    .replaceAll('{memory}', ctx.memory || '(nothing stored yet)')
    .replaceAll('{approvals}', String(ctx.approvals))
    .replaceAll('{args}', args);
  if (!hasArgs && args) out += `\n\n${args}`;
  return out.replace(/[ \t]+\n/g, '\n').trim();
}
