/**
 * Process interview: an alternative way to fill the Intent step of a workflow project. Instead of a form, the person is
 * interviewed about how the process runs today. The interview does not follow a fixed list of questions: it fills a
 * process model (slots) and always asks next where the model has the biggest gap. Answers are turned into model entries
 * by the agent (one call per answer, see `turnPrompt`); everything else here is deterministic and pure, so it is tested
 * without a model: which question comes next, when to dig deeper, when to summarise, when to stop.
 *
 * At the end the model is translated into the Intent form (`intentPrompt`, `parseIntentProposal`) and a process
 * description that the PRD, the specification and the build prompts carry along (`processSummary`).
 *
 * The interview is spoken: questions can be read aloud and answers dictated (see InterviewPanel). Every question and
 * answer is logged word by word (`transcript`) and, with the notes, written to a Markdown result (`interviewMarkdown`)
 * that feeds the Intent step and the process documentation. The person is identified by role, not by name, and the
 * interview starts only after the interviewer confirmed that the person agrees to the recording.
 */

import type { Intent } from './develop.ts';
import { DEFAULT_RETENTION_DAYS, isExpired, redact } from './interview-privacy.ts';

export type Lang = 'en' | 'de';
export type Bi = { en: string; de: string };

export const SLOT_KEYS = ['trigger', 'inputs', 'steps', 'decisions', 'exceptions', 'handoffs', 'result', 'volume', 'pain', 'automation'] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export type SlotDef = {
  key: SlotKey;
  label: string;
  /** What belongs in this slot (shown to the model). */
  meaning: string;
  /** How much a gap in this slot matters for the workflow. */
  weight: number;
  required: boolean;
  /** Number of confident entries at which the slot counts as full. */
  target: number;
  questions: Bi[];
};

export const SLOTS: SlotDef[] = [
  { key: 'trigger', label: 'Trigger', meaning: 'What starts the process (mail, ticket, date, system event).', weight: 0.8, required: true, target: 1, questions: [
    { en: 'Tell me about the last case you handled. What triggered it?', de: 'Erzähl mir den letzten Fall, den du bearbeitet hast. Was hat ihn ausgelöst?' },
    { en: 'How do you notice that it starts?', de: 'Woran merkst du, dass es losgeht?' }] },
  { key: 'inputs', label: 'Inputs', meaning: 'Documents, data and systems that are needed.', weight: 0.7, required: false, target: 1, questions: [
    { en: 'Which documents and systems do you need for it?', de: 'Welche Unterlagen und Systeme brauchst du dafür?' }] },
  { key: 'steps', label: 'Steps', meaning: 'The steps in order: who does what, in which system.', weight: 1.0, required: true, target: 4, questions: [
    { en: 'What do you do next, and in which system?', de: 'Was machst du als Nächstes, und in welchem System?' },
    { en: 'And after that? What comes next?', de: 'Und danach? Was kommt als Nächstes?' }] },
  { key: 'decisions', label: 'Decisions and rules', meaning: 'If X then Y: rules, thresholds, criteria.', weight: 1.0, required: true, target: 2, questions: [
    { en: 'Are there points where you decide how to continue? By which rule?', de: 'Gibt es Stellen, an denen du entscheidest, wie es weitergeht? Nach welcher Regel?' },
    { en: 'Is there another rule or limit you follow?', de: 'Gibt es noch eine Regel oder Grenze, nach der du dich richtest?' }] },
  { key: 'exceptions', label: 'Exceptions', meaning: 'Missing data, outliers, special cases, errors, escalation.', weight: 1.0, required: true, target: 2, questions: [
    { en: 'What happens when something is missing or does not fit?', de: 'Was passiert, wenn etwas fehlt oder nicht passt?' },
    { en: 'Tell me about the last case that went differently than usual.', de: 'Erzähl mir den letzten Fall, der anders lief als sonst.' }] },
  { key: 'handoffs', label: 'Handovers', meaning: 'To whom the work is handed over, and in which form.', weight: 0.7, required: false, target: 1, questions: [
    { en: 'Who do you pass it on to, and in what form?', de: 'An wen gibst du es weiter, und in welcher Form?' }] },
  { key: 'result', label: 'Result', meaning: 'What is finished, and how the person sees that.', weight: 0.6, required: true, target: 1, questions: [
    { en: 'When is a case done for you, and how do you see that?', de: 'Wann ist der Fall für dich erledigt, und woran siehst du das?' }] },
  { key: 'volume', label: 'Volume and rhythm', meaning: 'How often, how long, how many variants.', weight: 0.4, required: false, target: 1, questions: [
    { en: 'How often does this happen, and how long does one case take?', de: 'Wie oft kommt das vor, und wie lange dauert ein Fall?' }] },
  { key: 'pain', label: 'Pain points', meaning: 'Waiting, media breaks, manual work, errors.', weight: 0.5, required: false, target: 1, questions: [
    { en: 'Where do you wait or do things by hand that annoy you?', de: 'Wo wartest du oder machst du Dinge von Hand, die dich nerven?' }] },
  { key: 'automation', label: 'Automation potential', meaning: 'Where own judgement is needed, and what could run without the person.', weight: 0.4, required: true, target: 1, questions: [
    { en: 'Where do you need your own judgement, and what could run without you?', de: 'Wo brauchst du dein eigenes Urteil, und was könnte auch ohne dich laufen?' }] },
];
export const SLOT_BY_KEY = Object.fromEntries(SLOTS.map((s) => [s.key, s])) as Record<SlotKey, SlotDef>;

/** A slot counts as covered at this fill level; the interview ends when all required slots are covered. */
export const DONE_THRESHOLD = 0.7;
export const MIRROR_EVERY = 3;
export const MAX_FOLLOWUP_DEPTH = 2;
export const DEFAULT_BUDGET = 10;

const CLOSING: Bi = { en: 'What have I not asked that would be important?', de: 'Was habe ich nicht gefragt, was wichtig wäre?' };
const DONE: Bi = { en: 'Thank you, that was very helpful.', de: 'Danke, das war sehr hilfreich.' };
export const INTRO: Bi = {
  en: 'Thank you for your time. I will ask a few short questions about how this process really runs for you. There are no wrong answers: tell me how it is, not how it should be.',
  de: 'Danke für deine Zeit. Ich stelle dir ein paar kurze Fragen dazu, wie dieser Prozess bei dir wirklich abläuft. Es gibt keine falschen Antworten: Erzähl, wie es ist, nicht wie es sein sollte.',
};

/* ---------------- signal words: where hidden rules live ---------------- */

type Rule = { id: string; re: RegExp; ask: Bi };
/** In priority order. At most one follow-up per answer, so that the interview does not turn into an interrogation. */
export const SIGNAL_RULES: Rule[] = [
  { id: 'depends', re: /\b(it depends|depends on|depending on|depends)\b|kommt (drauf|darauf) an|je nachdem/i, ask: { en: 'What does it depend on?', de: 'Wovon hängt das ab?' } },
  { id: 'usually', re: /\b(usually|normally|as a rule|mostly|in most cases)\b|meistens|in der regel|normalerweise|größtenteils/i, ask: { en: 'When is it not like that?', de: 'Wann ist es nicht so?' } },
  { id: 'actually', re: /\b(actually|in theory|supposed to)\b|eigentlich|theoretisch/i, ask: { en: 'And how does it really work in practice?', de: 'Und wie läuft es tatsächlich?' } },
  { id: 'vague', re: /\b(quickly (look|check)|just check|somehow|sort of|kind of)\b|schau ich kurz|prüfe ich kurz|irgendwie|so ungefähr/i, ask: { en: 'What exactly do you look at, and how do you see that it is fine?', de: 'Was genau schaust du dir an, und woran erkennst du, dass es passt?' } },
  { id: 'sometimes', re: /\b(sometimes|now and then|occasionally|from time to time)\b|manchmal|ab und zu|gelegentlich/i, ask: { en: 'Roughly how often, and what happens then?', de: 'Wie oft ungefähr, und was passiert dann?' } },
  { id: 'threshold', re: /\d+([.,]\d+)?\s?(%|percent|prozent)|\b(over|above|more than|under|below|über|unter|mehr als|weniger als)\s+\d+/i, ask: { en: 'Where does that limit come from?', de: 'Woher kommt diese Grenze?' } },
];
export const RULE_IDS = SIGNAL_RULES.map((r) => r.id);

/** Rule ids whose signal words appear in the text. */
export function detectSignals(text: string): string[] {
  return SIGNAL_RULES.filter((r) => r.re.test(text)).map((r) => r.id);
}

/* ---------------- state ---------------- */

export type Entry = { id: number; slot: SlotKey; text: string; confidence: number; /** Index of the log line the entry comes from. */ turn?: number };
/** One step of the process, as the person described it. Roles, never names. */
export type Step = {
  id: number; text: string; actor: string; system: string; input: string; output: string;
  /** The rule or decision at this step, if any. */
  decision: string; exception: string;
  /** How the person sees that the step is done (record, mail, file). */
  evidence: string; confidence: number; turn?: number;
};
export type StepField = 'actor' | 'system' | 'evidence';
export type ActionKind = 'question' | 'followup' | 'mirror' | 'playback' | 'probe' | 'agenda' | 'closing' | 'done';
export type Action = { kind: ActionKind; text: string; slot: SlotKey | null };

/** One line of the interview log. `via` tells whether the answer was dictated or typed. */
export type Turn = { who: 'interviewer' | 'person'; text: string; via?: 'voice' | 'text'; at: number };

export type InterviewState = {
  /** The role of the person (never the name). */
  role: string;
  lang: Lang;
  budget: number;
  startedAt: number;
  entries: Entry[];
  nextId: number;
  /** How many main questions were asked per slot. */
  asked: Partial<Record<SlotKey, number>>;
  followups: { slot: SlotKey; text: string }[];
  depth: Partial<Record<SlotKey, number>>;
  mainQuestions: number;
  sinceMirror: number;
  closingAsked: boolean;
  lastSlot: SlotKey | null;
  /** Roles the person hands over to: candidates for the next interview. */
  handoffs: string[];
  /** The question that waits for an answer, so that a reload does not count it twice. */
  pending: Action | null;
  finished: boolean;
  /** The whole conversation, word by word, in order. */
  transcript: Turn[];
  /** The process as a list of steps (see Step). */
  steps: Step[];
  nextStepId: number;
  /** Which step fields were already asked about ("id:field"), so that nothing is asked twice. */
  probed: string[];
  playbackAsked: boolean;
  /** Questions from earlier interviews (conflicts, gaps) that this interview should clear up. */
  agenda: string[];
  /** Short note on what other interviews said; goes into the analyst prompt. */
  prior: string;
  /** Personal data is removed from stored text. */
  redact: boolean;
  /** Days after which the log is deleted (0 = until deleted by hand). */
  retainDays: number;
  /** When the person agreed. */
  consentAt: number;
  /** Set when the log was deleted, by hand or by the retention period. */
  purgedAt: number;
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const pick = (b: Bi, lang: Lang) => b[lang];

export type StartOptions = { retainDays?: number; redact?: boolean; agenda?: string[]; prior?: string };

export function startInterview(role: string, lang: Lang = 'en', budget = DEFAULT_BUDGET, now = Date.now(), opts: StartOptions = {}): InterviewState {
  return {
    role: role.trim().slice(0, 80), lang, budget: Math.min(Math.max(Math.round(budget) || DEFAULT_BUDGET, 3), 20), startedAt: now,
    entries: [], nextId: 1, asked: {}, followups: [], depth: {}, mainQuestions: 0, sinceMirror: 0,
    closingAsked: false, lastSlot: null, handoffs: [], pending: null, finished: false, transcript: [],
    steps: [], nextStepId: 1, probed: [], playbackAsked: false,
    agenda: (opts.agenda ?? []).map((q) => q.trim().slice(0, 300)).filter(Boolean).slice(0, 6), prior: (opts.prior ?? '').slice(0, 1500),
    redact: opts.redact !== false, retainDays: Number.isFinite(opts.retainDays) ? Math.max(0, Math.round(opts.retainDays!)) : DEFAULT_RETENTION_DAYS,
    consentAt: now, purgedAt: 0,
  };
}

export function fill(iv: InterviewState, key: SlotKey): number {
  const total = iv.entries.filter((e) => e.slot === key).reduce((a, e) => a + e.confidence, 0);
  return Math.min(1, total / SLOT_BY_KEY[key].target);
}
/** Importance of the gap: weight times what is missing. */
export const gapScore = (iv: InterviewState, key: SlotKey) => SLOT_BY_KEY[key].weight * (1 - fill(iv, key));
export const requiredDone = (iv: InterviewState) => SLOTS.filter((s) => s.required).every((s) => fill(iv, s.key) >= DONE_THRESHOLD);
export const openSlots = (iv: InterviewState): SlotKey[] => SLOTS.filter((s) => fill(iv, s.key) < DONE_THRESHOLD).map((s) => s.key);
export const coverage = (iv: InterviewState) => SLOTS.map((s) => ({ key: s.key, label: s.label, required: s.required, fill: Math.round(fill(iv, s.key) * 100) / 100 }));

/* ---------------- steps ---------------- */

const STOP = new Set('the a an and or of to in on for with is are was were it this that then als und oder der die das den dem des ein eine einen einem ich wir dann wird werden mit von zu im in auf für'.split(' '));
const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
/** Word overlap of two texts, 0 to 1. */
export function similarity(a: string, b: string): number {
  const x = tokens(a); const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both);
}
const short = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const STEP_FIELDS = ['actor', 'system', 'input', 'output', 'decision', 'exception', 'evidence'] as const;
const stepMissing = (st: Step, f: StepField) => !st[f].trim();
/** Probe questions per interview, so that the step detail does not make the interview endless. */
export const MAX_PROBES = 4;
const PROBE: Record<StepField, Bi> = {
  system: { en: 'In which system do you do this: "{s}"?', de: 'In welchem System machst du das: "{s}"?' },
  evidence: { en: 'How do you see that this is done: "{s}"? (a record, a mail, a file)', de: 'Woran siehst du, dass das erledigt ist: "{s}"? (ein Eintrag, eine Mail, eine Datei)' },
  actor: { en: 'Who does this: "{s}"?', de: 'Wer macht das: "{s}"?' },
};

/** The next step detail worth asking about: steps in order, fields in order of use, each only once. */
function probeFor(s: InterviewState): { stepId: number; field: StepField } | null {
  if (s.probed.length >= MAX_PROBES) return null;
  for (const field of ['system', 'evidence', 'actor'] as StepField[]) {
    for (const st of s.steps) if (stepMissing(st, field) && !s.probed.includes(`${st.id}:${field}`)) return { stepId: st.id, field };
  }
  return null;
}

/** The process read back, one line per step. The person corrects what is wrong. */
export function playbackText(iv: Pick<InterviewState, 'steps' | 'lang'>): string {
  const lines = iv.steps.map((st, i) => `${i + 1}. ${[st.actor, st.text].filter(Boolean).join(': ')}${st.system ? ` (${st.system})` : ''}${st.decision ? `, ${iv.lang === 'de' ? 'Regel' : 'rule'}: ${st.decision}` : ''}`);
  return iv.lang === 'de'
    ? `Ich lese den Ablauf noch einmal vor:\n${lines.join('\n')}\nStimmt die Reihenfolge? Was fehlt oder ist falsch?`
    : `Let me read the process back:\n${lines.join('\n')}\nIs the order right? What is missing or wrong?`;
}

/** Adds or merges a step the agent reported. A step is matched by id, else by similar text. */
function putStep(s: InterviewState, u: ModelOut['steps'][number], certain: boolean, turn: number) {
  const clean = (v: string) => (s.redact ? redact(v) : v);
  const text = clean(u.text);
  const hit = s.steps.find((x) => x.id === u.id) ?? s.steps.find((x) => similarity(x.text, text) >= 0.6);
  const conf = certain ? 1 : u.confidence;
  if (hit) {
    hit.text = hit.text.length >= text.length ? hit.text : text;
    for (const f of STEP_FIELDS) if (u[f].trim()) hit[f] = clean(u[f]);
    hit.confidence = Math.max(hit.confidence, conf);
    return;
  }
  const st: Step = { id: s.nextStepId++, text, actor: clean(u.actor), system: clean(u.system), input: clean(u.input), output: clean(u.output), decision: clean(u.decision), exception: clean(u.exception), evidence: clean(u.evidence), confidence: conf, turn };
  const at = u.position > 0 ? Math.min(u.position - 1, s.steps.length) : s.steps.length;
  s.steps.splice(at, 0, st);
}

const mm = (t: string) => short(t.replace(/["\[\]{}()<>|#&]/g, ' ').replace(/\s+/g, ' ').trim(), 60);

/** The process as a Mermaid flowchart. Decisions are diamonds, exceptions dashed side branches. */
export function interviewMermaid(iv: Pick<InterviewState, 'steps' | 'entries' | 'lang'>): string {
  if (!iv.steps.length) return '';
  const trigger = iv.entries.find((e) => e.slot === 'trigger');
  const result = iv.entries.find((e) => e.slot === 'result');
  const out = ['flowchart TD', `  S0(["${mm(trigger?.text ?? (iv.lang === 'de' ? 'Start' : 'Start'))}"])`];
  let prev = 'S0';
  iv.steps.forEach((st, i) => {
    const id = `S${i + 1}`;
    const label = `${i + 1}. ${mm(st.text)}${st.actor || st.system ? `<br/>${mm([st.actor, st.system].filter(Boolean).join(' / '))}` : ''}${st.decision ? `<br/>${iv.lang === 'de' ? 'Regel' : 'Rule'}: ${mm(st.decision)}` : ''}`;
    out.push(st.decision ? `  ${id}{"${label}"}` : `  ${id}["${label}"]`);
    out.push(`  ${prev} --> ${id}`);
    if (st.exception) { out.push(`  X${i + 1}["${mm(st.exception)}"]`, `  ${id} -.-> X${i + 1}`); }
    prev = id;
  });
  out.push(`  E(["${mm(result?.text ?? (iv.lang === 'de' ? 'Erledigt' : 'Done'))}"])`, `  ${prev} --> E`);
  return out.join('\n');
}

/** Index of the log line that the next answer will get: call right before the answer is logged. */
const nextTurn = (s: InterviewState) => s.transcript.length;

function mirrorText(iv: InterviewState): string {
  const parts = iv.entries.slice(-MIRROR_EVERY).map((e) => e.text.replace(/[.\s]+$/, '')).join('; ');
  return iv.lang === 'de' ? `Ich fasse kurz zusammen: ${parts}. Stimmt das so?` : `Let me summarise: ${parts}. Is that right?`;
}

function choose(s: InterviewState): Action {
  if (s.followups.length) {
    const f = s.followups.shift()!;
    return { kind: 'followup', text: f.text, slot: f.slot };
  }
  if (s.sinceMirror >= MIRROR_EVERY && s.entries.length > 0) {
    s.sinceMirror = 0;
    return { kind: 'mirror', text: mirrorText(s), slot: null };
  }
  if (requiredDone(s) || s.mainQuestions >= s.budget) {
    // Before closing: one detail question per weak step (few), the process read back once, then what earlier interviews left open.
    const probe = probeFor(s);
    if (probe) {
      const st = s.steps.find((x) => x.id === probe.stepId)!;
      s.probed.push(`${probe.stepId}:${probe.field}`);
      return { kind: 'probe', text: pick(PROBE[probe.field], s.lang).replace('{s}', short(st.text, 80)), slot: 'steps' };
    }
    if (s.steps.length >= 3 && !s.playbackAsked) { s.playbackAsked = true; return { kind: 'playback', text: playbackText(s), slot: 'steps' }; }
    if (s.agenda.length) return { kind: 'agenda', text: s.agenda.shift()!, slot: null };
    if (!s.closingAsked) { s.closingAsked = true; return { kind: 'closing', text: pick(CLOSING, s.lang), slot: null }; }
    return { kind: 'done', text: pick(DONE, s.lang), slot: null };
  }
  // The first question is always about the last real case, not about the target process.
  if (s.mainQuestions === 0 && !s.asked.trigger) {
    s.asked.trigger = 1; s.mainQuestions += 1;
    return { kind: 'question', text: pick(SLOT_BY_KEY.trigger.questions[0], s.lang), slot: 'trigger' };
  }
  const candidates = SLOTS
    .filter((d) => fill(s, d.key) < 1 && (s.asked[d.key] ?? 0) < d.questions.length)
    .map((d) => ({ key: d.key, gap: gapScore(s, d.key), required: d.required }))
    .sort((a, b) => b.gap - a.gap || Number(b.required) - Number(a.required));
  if (!candidates.length) { s.mainQuestions = s.budget; return choose(s); }
  const key = candidates[0].key;
  const n = s.asked[key] ?? 0;
  s.asked[key] = n + 1; s.mainQuestions += 1;
  return { kind: 'question', text: pick(SLOT_BY_KEY[key].questions[n], s.lang), slot: key };
}

/** The next thing the interviewer says. Returns the new state, which remembers it as the pending question. */
export function nextAction(iv: InterviewState): { iv: InterviewState; action: Action } {
  const s = clone(iv);
  const action = choose(s);
  s.pending = action;
  if (action.kind === 'done') s.finished = true;
  return { iv: s, action };
}

/* ---------------- what the agent returns for one answer ---------------- */

export type ModelOut = {
  updates: { slot: SlotKey; text: string; confidence: number }[];
  /** Ids of earlier entries that the answer replaces or corrects. */
  supersedes: number[];
  /** Extra rule ids the agent recognised (the engine also looks for signal words itself). */
  signals: string[];
  /** Role the person hands the work over to, if one was named. */
  handoffTo: string;
  /** Only when the answer replies to a summary: did the person confirm it? */
  confirmed: boolean | null;
  /** Steps of the process the answer mentions (new, or details for an existing one). */
  steps: { id: number; position: number; text: string; actor: string; system: string; input: string; output: string; decision: string; exception: string; evidence: string; confidence: number }[];
  /** Ids of steps the answer removes (the person says they do not exist). */
  removeSteps: number[];
};

const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Reads the agent's answer. Null when it cannot be read: the caller keeps the person's answer and asks to try again. */
export function parseModelOut(text: string): ModelOut | null {
  const fence = /```[\w-]*[^\n]*\n([\s\S]*?)\n```/.exec(text);
  const body = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let raw: any;
  try { raw = JSON.parse(body); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const updates: ModelOut['updates'] = [];
  for (const u of Array.isArray(raw.updates) ? raw.updates.slice(0, 12) : []) {
    const slot = u?.slot as SlotKey;
    const t = cut(u?.text, 400);
    if (!SLOT_KEYS.includes(slot) || !t) continue;
    const c = Number(u?.confidence);
    updates.push({ slot, text: t, confidence: Number.isFinite(c) ? Math.min(1, Math.max(0.1, c)) : 0.6 });
  }
  const steps: ModelOut['steps'] = [];
  for (const u of Array.isArray(raw.steps) ? raw.steps.slice(0, 12) : []) {
    const text = cut(u?.text, 300);
    if (!text) continue;
    const c = Number(u?.confidence);
    steps.push({
      id: Number.isInteger(u?.id) ? u.id : 0, position: Number.isInteger(u?.position) && u.position > 0 ? u.position : 0, text,
      actor: cut(u?.actor, 80), system: cut(u?.system, 80), input: cut(u?.input, 200), output: cut(u?.output, 200),
      decision: cut(u?.decision, 300), exception: cut(u?.exception, 300), evidence: cut(u?.evidence, 200),
      confidence: Number.isFinite(c) ? Math.min(1, Math.max(0.1, c)) : 0.6,
    });
  }
  return {
    updates, steps,
    removeSteps: (Array.isArray(raw.remove_steps) ? raw.remove_steps : []).filter((n: unknown) => Number.isInteger(n)).slice(0, 12),
    supersedes: (Array.isArray(raw.supersedes) ? raw.supersedes : []).filter((n: unknown) => Number.isInteger(n)).slice(0, 12),
    signals: (Array.isArray(raw.signals) ? raw.signals : []).filter((s: unknown) => typeof s === 'string' && RULE_IDS.includes(s)).slice(0, 3),
    handoffTo: cut(raw.handoff_to, 80),
    confirmed: typeof raw.confirmed === 'boolean' ? raw.confirmed : null,
  };
}

/** Puts one answer into the model: new entries, corrections, handover, and the follow-up the signal words call for. */
export function ingest(iv: InterviewState, out: ModelOut, answer: string): InterviewState {
  const s = clone(iv);
  const replyToMirror = s.pending?.kind === 'mirror' || s.pending?.kind === 'playback';
  const turn = nextTurn(s);
  const clean = (t: string) => (s.redact ? redact(t) : t);
  // A confirmed summary makes the entries behind it more certain.
  if (s.pending?.kind === 'mirror' && out.confirmed === true) for (const e of s.entries.slice(-MIRROR_EVERY)) e.confidence = Math.min(1, e.confidence + 0.2);
  if (s.pending?.kind === 'playback' && out.confirmed === true) for (const st of s.steps) st.confidence = 1;
  if (out.supersedes.length) s.entries = s.entries.filter((e) => !out.supersedes.includes(e.id));
  if (out.removeSteps?.length) s.steps = s.steps.filter((st) => !out.removeSteps.includes(st.id));
  for (const u of out.updates) {
    // What the person says to correct a summary is the most reliable thing in the model.
    s.entries.push({ id: s.nextId++, slot: u.slot, text: clean(u.text), confidence: replyToMirror ? 1 : u.confidence, turn });
  }
  for (const u of out.steps ?? []) putStep(s, u, replyToMirror, turn);
  if (out.updates.length) s.lastSlot = out.updates[out.updates.length - 1].slot;
  // The reply to a summary is a check of what was already said, so it does not count towards the next summary.
  if (!replyToMirror) s.sinceMirror += 1;
  if (out.handoffTo && !s.handoffs.some((h) => h.toLowerCase() === out.handoffTo.toLowerCase())) s.handoffs.push(clean(out.handoffTo));

  const kind = s.pending?.kind;
  if (kind === 'question' || kind === 'followup' || kind === 'probe' || kind === 'agenda') {
    const ids = new Set([...detectSignals(answer), ...out.signals]);
    const rule = SIGNAL_RULES.find((r) => ids.has(r.id));
    const slot = out.updates.length ? out.updates[out.updates.length - 1].slot : s.pending?.slot ?? s.lastSlot;
    if (rule && slot && (s.depth[slot] ?? 0) < MAX_FOLLOWUP_DEPTH) {
      s.followups.push({ slot, text: pick(rule.ask, s.lang) });
      s.depth[slot] = (s.depth[slot] ?? 0) + 1;
    }
  }
  s.pending = null;
  return s;
}

/** Appends lines to the log. Pure: returns a new state. */
export function logTurns(iv: InterviewState, turns: { who: Turn['who']; text: string; via?: Turn['via'] }[], now = Date.now()): InterviewState {
  const add = turns.filter((t) => t.text.trim()).map((t) => ({ who: t.who, text: (iv.redact && t.who === 'person' ? redact(t.text.trim()) : t.text.trim()).slice(0, 3000), ...(t.via ? { via: t.via } : {}), at: now }));
  return { ...iv, transcript: [...iv.transcript, ...add].slice(-400) };
}

/** The person skips the question: nothing is added and nothing counts as an answer. */
export function skip(iv: InterviewState): InterviewState {
  const s = clone(iv);
  s.pending = null;
  return s;
}

/* ---------------- prompts ---------------- */

const JSON_ONLY = 'Answer with one JSON object only, in a ```json fence. No other text. Do not use tools and do not create files.';

export function turnPrompt(iv: InterviewState, answer: string): string {
  const entries = iv.entries.length
    ? iv.entries.map((e) => `[${e.id}] ${e.slot}: ${e.text}`).join('\n')
    : '(nothing yet)';
  const readOut = iv.pending?.kind === 'mirror' || iv.pending?.kind === 'playback';
  const asked = iv.pending ? `${iv.pending.kind === 'playback' ? 'Process that the interviewer read back' : readOut ? 'Summary that the interviewer read out' : 'Question'}: ${iv.pending.text}` : 'Question: (none)';
  const steps = iv.steps.length ? iv.steps.map((st, i) => `[${st.id}] #${i + 1} ${st.text} | actor: ${st.actor || '?'} | system: ${st.system || '?'} | decision: ${st.decision || '-'} | evidence: ${st.evidence || '?'}`).join('\n') : '(none yet)';
  return [
    'You are the analyst behind a process interview. A person describes how a business process runs today. Turn their latest answer into entries of a process model. You do not talk to the person.',
    '',
    '## Slots',
    ...SLOTS.map((d) => `- ${d.key}: ${d.meaning}`),
    '',
    `## Role of the person\n${iv.role || '(not given)'}`,
    '',
    '## Model so far (id, slot, entry)',
    entries,
    '',
    '## Steps so far (id, order, details)',
    steps,
    ...(iv.prior ? ['', '## What other interviews said (do not copy it into this person\'s model; use it only to see where this answer agrees or differs)', iv.prior] : []),
    '',
    '## Latest exchange',
    asked,
    `Answer of the person: ${answer.trim().slice(0, 3000)}`,
    '',
    '## Rules',
    '- One fact per entry, short and concrete, in the language the person used. Only what the person said: never invent steps, rules or numbers.',
    '- The slot is the kind of fact, not the topic of the question: an answer may fill several slots.',
    '- Replace persons by roles. Do not record opinions about colleagues or the performance of people; record the process only.',
    '- confidence: 0.9 explicit and concrete, 0.6 plausible but vague, 0.3 hinted only.',
    '- If the answer corrects or replaces an earlier entry, list its id in "supersedes" and add the corrected entry.',
    '- "steps": the process steps the answer mentions, in order, one per action. Fields: text (what is done), actor (a role), system, input, output, decision (the rule at this step, if any), exception (what goes wrong here, if said), evidence (how the person sees it is done), position (1-based place in the process, only when it must go between existing steps), id (of an existing step when the answer adds details to it), confidence. Leave a field "" when the person did not say it: never guess.',
    '- "remove_steps": ids of steps the person says do not exist or were wrong.',
    '- When the answer replies to a read-back of the process, apply the corrections to the steps (details, order via position, removals).',
    '- "handoff_to": the role the work goes to, if one is named, else "".',
    '- "confirmed": only when the answer replies to a summary: true if the person agrees, false if not, else null.',
    `- "signals": optional; ids from ${RULE_IDS.join(', ')} when the answer contains vague wording that hides a rule.`,
    '',
    'Format: {"updates":[{"slot":"steps","text":"...","confidence":0.9}],"steps":[{"text":"...","actor":"","system":"","input":"","output":"","decision":"","exception":"","evidence":"","confidence":0.8}],"remove_steps":[],"supersedes":[],"signals":[],"handoff_to":"","confirmed":null}',
    JSON_ONLY,
  ].join('\n');
}

/** Readable description of the model; goes into the Intent and from there into the PRD, specification and build prompts. */
export function processSummary(iv: InterviewState): string {
  const out: string[] = [];
  for (const d of SLOTS) {
    const items = iv.entries.filter((e) => e.slot === d.key);
    if (!items.length) continue;
    out.push(`${d.label}:`, ...items.map((e) => `- ${e.text}${e.confidence < 0.5 ? ' (unsure)' : ''}`));
  }
  if (iv.steps.length) {
    out.push('Process steps in order:', ...iv.steps.map((st, i) => `${i + 1}. ${st.text}${[st.actor && `by ${st.actor}`, st.system && `in ${st.system}`, st.decision && `rule: ${st.decision}`, st.exception && `exception: ${st.exception}`, st.evidence && `done when: ${st.evidence}`].filter(Boolean).map((x) => ` (${x})`).join('')}`));
  }
  const open = SLOTS.filter((d) => fill(iv, d.key) < DONE_THRESHOLD);
  if (open.length) out.push(`Not covered in the interview: ${open.map((d) => d.label + (d.required ? ' (needed)' : '')).join(', ')}.`);
  if (iv.handoffs.length) out.push(`Hands over to (not yet interviewed): ${iv.handoffs.join(', ')}.`);
  out.push(`Source: one interview with the role "${iv.role || 'not given'}". The person describes the process as they experience it; nothing was checked against the systems.`);
  return out.join('\n');
}

const L = {
  en: { title: 'Process interview', role: 'Role', date: 'Date', lang: 'Language', summary: 'What the person described', open: 'Not covered', handoffs: 'Hands over to (not yet interviewed)', log: 'Interview log', you: 'Interviewer', person: 'Answer', voice: 'spoken', typed: 'typed', skipped: '(skipped)', none: 'Nothing was noted.', stepsH: 'Process steps', diagram: 'Diagram', cols: ['#', 'Step', 'Role', 'System', 'Rule', 'Exception', 'Done when', 'Log'], consent: 'Consent and data handling', agreed: 'Person agreed on', keep: 'Log kept', redacted: 'Personal data removed from stored text (pattern-based, not a guarantee)', notRedacted: 'Personal data not removed', purged: 'The log was deleted on', untilDeleted: 'until deleted by hand', daysWord: 'days', ref: 'Numbers in brackets refer to the lines of the log below.', source: 'Source: one interview. The person describes the process as they experience it; nothing was checked against the systems.', use: 'Use: input for the Intent step of the workflow project and for the process documentation.' },
  de: { title: 'Prozessinterview', role: 'Rolle', date: 'Datum', lang: 'Sprache', summary: 'Was die Person beschrieben hat', open: 'Nicht abgedeckt', handoffs: 'Übergibt an (noch nicht befragt)', log: 'Gesprächsprotokoll', you: 'Interviewer', person: 'Antwort', voice: 'gesprochen', typed: 'getippt', skipped: '(übersprungen)', none: 'Nichts festgehalten.', stepsH: 'Prozessschritte', diagram: 'Diagramm', cols: ['#', 'Schritt', 'Rolle', 'System', 'Regel', 'Ausnahme', 'Erledigt wenn', 'Protokoll'], consent: 'Einwilligung und Umgang mit den Daten', agreed: 'Person hat zugestimmt am', keep: 'Protokoll aufbewahrt', redacted: 'Personenbezogene Angaben im gespeicherten Text entfernt (musterbasiert, keine Garantie)', notRedacted: 'Personenbezogene Angaben nicht entfernt', purged: 'Das Protokoll wurde gelöscht am', untilDeleted: 'bis zum manuellen Löschen', daysWord: 'Tage', ref: 'Zahlen in eckigen Klammern verweisen auf die Zeilen des Protokolls unten.', source: 'Quelle: ein Interview. Die Person beschreibt den Prozess, wie sie ihn erlebt; nichts wurde gegen die Systeme geprüft.', use: 'Verwendung: Eingabe für den Intent-Schritt des Workflow-Projekts und für die Prozessdokumentation.' },
} as const;

/**
 * The result of the interview as one Markdown file: the structured process description first, then the full log.
 * It is the input for the Intent step and for the process documentation.
 */
export function interviewMarkdown(iv: InterviewState, now = Date.now()): string {
  const t = L[iv.lang];
  const day = new Date(iv.startedAt || now).toISOString().slice(0, 10);
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const ref = (turn?: number) => (turn !== undefined && !iv.purgedAt && iv.transcript[turn] ? ` [${turn + 1}]` : '');
  const cell = (v: string) => (v || '-').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');
  const out: string[] = [`# ${t.title}: ${iv.role || '-'}`, '', `- ${t.role}: ${iv.role || '-'}`, `- ${t.date}: ${day}`, `- ${t.lang}: ${iv.lang === 'de' ? 'Deutsch' : 'English'}`, '', `## ${t.summary}`, ''];
  let any = false;
  for (const d of SLOTS) {
    const items = iv.entries.filter((e) => e.slot === d.key);
    if (!items.length) continue;
    any = true;
    out.push(`### ${d.label}`, '', ...items.map((e) => `- ${e.text}${e.confidence < 0.5 ? (iv.lang === 'de' ? ' (unsicher)' : ' (unsure)') : ''}${ref(e.turn)}`), '');
  }
  if (!any) out.push(t.none, '');
  if (iv.steps.length) {
    out.push(`## ${t.stepsH}`, '', `| ${t.cols.join(' | ')} |`, `|${t.cols.map(() => '---').join('|')}|`,
      ...iv.steps.map((st, i) => `| ${i + 1} | ${cell(st.text)} | ${cell(st.actor)} | ${cell(st.system)} | ${cell(st.decision)} | ${cell(st.exception)} | ${cell(st.evidence)} | ${st.turn !== undefined && !iv.purgedAt && iv.transcript[st.turn] ? `[${st.turn + 1}]` : '-'} |`), '',
      `### ${t.diagram}`, '', '```mermaid', interviewMermaid(iv), '```', '');
  }
  const open = SLOTS.filter((d) => fill(iv, d.key) < DONE_THRESHOLD);
  if (open.length) out.push(`**${t.open}:** ${open.map((d) => d.label).join(', ')}`, '');
  if (iv.handoffs.length) out.push(`**${t.handoffs}:** ${iv.handoffs.join(', ')}`, '');
  out.push(`_${t.source}_`, `_${t.use}_`, '', `## ${t.consent}`, '',
    `- ${t.agreed}: ${date(iv.consentAt || iv.startedAt || now)}`,
    `- ${t.keep}: ${iv.retainDays === 0 ? t.untilDeleted : `${iv.retainDays} ${t.daysWord}`}`,
    `- ${iv.redact ? t.redacted : t.notRedacted}`, '');
  if (iv.purgedAt) out.push(`**${t.purged} ${date(iv.purgedAt)}.**`, '');
  else {
    out.push(`## ${t.log}`, '', `_${t.ref}_`, '');
    iv.transcript.forEach((turn, i) => {
      const label = turn.who === 'interviewer' ? t.you : `${t.person}${turn.via ? ` (${turn.via === 'voice' ? t.voice : t.typed})` : ''}`;
      out.push(`**[${i + 1}] ${label}:** ${turn.text.replace(/\s*\n\s*/g, ' ')}`, '');
    });
  }
  return out.join('\n').trimEnd() + '\n';
}

/** Deletes the log (not the notes). Used by the "delete log" button and by the retention period. */
export function purgeLog(iv: InterviewState, now = Date.now()): InterviewState {
  if (iv.purgedAt) return iv;
  return { ...iv, transcript: [], pending: iv.pending, purgedAt: now };
}
/** Applies the retention period: after it, the log is deleted automatically. */
export function purgeExpired(iv: InterviewState, now = Date.now()): InterviewState {
  return !iv.purgedAt && isExpired(iv.startedAt, iv.retainDays, now) ? purgeLog(iv, now) : iv;
}

export type IntentLists = { triggers: readonly string[]; systems: readonly string[]; guardrails: readonly string[] };

/** `modelText` replaces the single interview's description, for example with the synthesis of several interviews. */
export function intentPrompt(iv: InterviewState, kind: 'workflow' | 'agent', statedGoal: string, lists: IntentLists, modelText?: string): string {
  return [
    `A process interview was held to prepare an ${kind === 'workflow' ? 'n8n workflow' : 'agent'}. Fill in the intent form from it.`,
    '',
    '## Goal stated by the person who started the project',
    statedGoal.trim() || '(not given)',
    '',
    '## Process model from the interview',
    modelText ?? processSummary(iv),
    '',
    '## Form fields',
    '- name: short name, at most 6 words',
    '- goal: one or two sentences, the result wanted and for whom',
    `- trigger: exactly one of: ${lists.triggers.map((t) => `"${t}"`).join(' | ')}`,
    `- systems: array, each exactly from: ${lists.systems.map((t) => `"${t}"`).join(' | ')}`,
    '- otherSystems: systems named in the interview that are not in that list, comma separated',
    '- data: what data goes in and what should come out',
    `- guardrail: exactly one of: ${lists.guardrails.map((t) => `"${t}"`).join(' | ')}. Choose the most restrictive one that fits what the person said about judgement and approvals; if nothing was said, choose the second.`,
    '- success: how the person would know that it works, only if the interview says so',
    '- stakeholders: roles involved (use the role, never a name)',
    '- outOfScope: what the person said must not be automated or touched',
    '- extra: what happens when something goes wrong (from the exceptions)',
    '',
    'Use only what the interview says. Where it says nothing, use "" (or [] for systems): the person completes the form afterwards. Do not invent.',
    JSON_ONLY,
  ].join('\n');
}

const matchOption = (v: unknown, options: readonly string[]) => {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return options.find((o) => o.toLowerCase() === t) ?? '';
};

/** Reads the intent proposal. Values outside the allowed lists are dropped (systems move to "other systems"). */
export function parseIntentProposal(text: string, lists: IntentLists): Partial<Intent> | null {
  const fence = /```[\w-]*[^\n]*\n([\s\S]*?)\n```/.exec(text);
  const body = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let raw: any;
  try { raw = JSON.parse(body); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const systems: string[] = [];
  const other = new Set<string>(cut(raw.otherSystems, 300).split(',').map((s) => s.trim()).filter(Boolean));
  for (const s of Array.isArray(raw.systems) ? raw.systems : []) {
    const m = matchOption(s, lists.systems);
    if (m) { if (!systems.includes(m)) systems.push(m); } else if (typeof s === 'string' && s.trim()) other.add(s.trim().slice(0, 60));
  }
  const out: Partial<Intent> = {
    name: cut(raw.name, 80), goal: cut(raw.goal, 1500), systems, otherSystems: [...other].join(', ').slice(0, 300),
    data: cut(raw.data, 1500), success: cut(raw.success, 1000), stakeholders: cut(raw.stakeholders, 800),
    outOfScope: cut(raw.outOfScope, 800), extra: cut(raw.extra, 1000),
  };
  const trigger = matchOption(raw.trigger, lists.triggers);
  if (trigger) out.trigger = trigger;
  const guardrail = matchOption(raw.guardrail, lists.guardrails);
  if (guardrail) out.guardrail = guardrail;
  return out;
}

/**
 * What the form gets from the interview. Text the person already typed stays; empty fields are filled; systems are
 * added; trigger and guardrail follow the interview when it gave a valid value.
 */
export function mergeProposal(current: Intent, proposal: Partial<Intent>): Partial<Intent> {
  const keep = (cur: string, next: string | undefined) => (cur.trim() ? cur : (next ?? ''));
  const patch: Partial<Intent> = {
    name: keep(current.name, proposal.name), goal: keep(current.goal, proposal.goal), data: keep(current.data, proposal.data),
    success: keep(current.success, proposal.success), stakeholders: keep(current.stakeholders, proposal.stakeholders),
    outOfScope: keep(current.outOfScope, proposal.outOfScope), extra: keep(current.extra, proposal.extra),
    otherSystems: keep(current.otherSystems, proposal.otherSystems),
    systems: [...new Set([...current.systems, ...(proposal.systems ?? [])])],
  };
  if (proposal.trigger) patch.trigger = proposal.trigger;
  if (proposal.guardrail) patch.guardrail = proposal.guardrail;
  return patch;
}

/* ---------------- store ---------------- */

/** Cleans a stored interview state. Anything unreadable gives null (the interview can be started again). */
export function sanitizeInterview(raw: any, now = Date.now()): InterviewState | null {
  if (!raw || typeof raw !== 'object') return null;
  const slot = (v: unknown): SlotKey | null => (SLOT_KEYS.includes(v as SlotKey) ? (v as SlotKey) : null);
  const base = startInterview(cut(raw.role, 80), raw.lang === 'de' ? 'de' : 'en', Number(raw.budget), Number.isFinite(raw.startedAt) ? raw.startedAt : Date.now(), { retainDays: Number.isFinite(raw.retainDays) ? raw.retainDays : DEFAULT_RETENTION_DAYS, redact: raw.redact !== false });
  const entries: Entry[] = [];
  for (const e of Array.isArray(raw.entries) ? raw.entries.slice(0, 200) : []) {
    const k = slot(e?.slot);
    const t = cut(e?.text, 400);
    if (!k || !t) continue;
    const c = Number(e?.confidence);
    entries.push({ id: Number.isInteger(e?.id) ? e.id : entries.length + 1, slot: k, text: t, confidence: Number.isFinite(c) ? Math.min(1, Math.max(0.1, c)) : 0.6, ...(Number.isInteger(e?.turn) && e.turn >= 0 ? { turn: e.turn } : {}) });
  }
  const counts = (v: any): Partial<Record<SlotKey, number>> => {
    const o: Partial<Record<SlotKey, number>> = {};
    for (const k of SLOT_KEYS) if (Number.isInteger(v?.[k]) && v[k] > 0) o[k] = Math.min(v[k], 20);
    return o;
  };
  const action = (a: any): Action | null => {
    const kinds: ActionKind[] = ['question', 'followup', 'mirror', 'playback', 'probe', 'agenda', 'closing', 'done'];
    return a && kinds.includes(a.kind) && cut(a.text, 800) ? { kind: a.kind, text: cut(a.text, 800), slot: slot(a.slot) } : null;
  };
  const steps: Step[] = [];
  for (const x of Array.isArray(raw.steps) ? raw.steps.slice(0, 60) : []) {
    const text = cut(x?.text, 300);
    if (!text) continue;
    const c = Number(x?.confidence);
    steps.push({
      id: Number.isInteger(x?.id) ? x.id : steps.length + 1, text, actor: cut(x?.actor, 80), system: cut(x?.system, 80), input: cut(x?.input, 200), output: cut(x?.output, 200),
      decision: cut(x?.decision, 300), exception: cut(x?.exception, 300), evidence: cut(x?.evidence, 200), confidence: Number.isFinite(c) ? Math.min(1, Math.max(0.1, c)) : 0.6,
      ...(Number.isInteger(x?.turn) && x.turn >= 0 ? { turn: x.turn } : {}),
    });
  }
  const result: InterviewState = {
    ...base, entries, steps, nextStepId: Math.max(Number.isInteger(raw.nextStepId) ? raw.nextStepId : 1, ...steps.map((x) => x.id + 1)),
    probed: (Array.isArray(raw.probed) ? raw.probed : []).filter((v: unknown) => typeof v === 'string' && /^\d+:(actor|system|evidence)$/.test(v)).slice(0, 20),
    playbackAsked: raw.playbackAsked === true,
    agenda: (Array.isArray(raw.agenda) ? raw.agenda : []).map((q: unknown) => cut(q, 300)).filter(Boolean).slice(0, 6),
    prior: cut(raw.prior, 1500),
    consentAt: Number.isFinite(raw.consentAt) ? raw.consentAt : base.startedAt,
    purgedAt: Number.isFinite(raw.purgedAt) ? raw.purgedAt : 0,
    nextId: Math.max(Number.isInteger(raw.nextId) ? raw.nextId : 1, ...entries.map((e) => e.id + 1)),
    asked: counts(raw.asked), depth: counts(raw.depth),
    followups: (Array.isArray(raw.followups) ? raw.followups.slice(0, 5) : []).flatMap((f: any) => { const k = slot(f?.slot); const t = cut(f?.text, 300); return k && t ? [{ slot: k, text: t }] : []; }),
    mainQuestions: Math.min(Math.max(Number.isInteger(raw.mainQuestions) ? raw.mainQuestions : 0, 0), 50),
    sinceMirror: Math.min(Math.max(Number.isInteger(raw.sinceMirror) ? raw.sinceMirror : 0, 0), 50),
    closingAsked: raw.closingAsked === true, lastSlot: slot(raw.lastSlot),
    handoffs: (Array.isArray(raw.handoffs) ? raw.handoffs : []).map((h: unknown) => cut(h, 80)).filter(Boolean).slice(0, 10),
    pending: action(raw.pending), finished: raw.finished === true,
    transcript: (Array.isArray(raw.transcript) ? raw.transcript.slice(-400) : []).flatMap((x: any) => {
      const text = cut(x?.text, 3000);
      if (!text || (x?.who !== 'interviewer' && x?.who !== 'person')) return [];
      return [{ who: x.who as Turn['who'], text, ...(x.via === 'voice' || x.via === 'text' ? { via: x.via as 'voice' | 'text' } : {}), at: Number.isFinite(x.at) ? x.at : 0 }];
    }),
  };
  return purgeExpired(result, now);
}
