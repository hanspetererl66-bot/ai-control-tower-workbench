/**
 * Several process interviews about the same process, put together. Each person describes the process as they see it;
 * this module finds the steps that two people describe (by similar wording), the places where they disagree, and the
 * roles that were named but not yet interviewed. The result feeds the next interview (`agendaFor`), the Intent
 * (`synthesisSummary`) and the process documentation (`synthesisMarkdown`).
 *
 * Matching is by word overlap, not by meaning: two steps with different words are listed as separate steps and one
 * step can be matched wrongly. The result says so, and the person who reads it decides.
 */

import { similarity, type InterviewState, type Lang, type Step } from './interview.ts';

export const MATCH_THRESHOLD = 0.5;

export type StepSource = { role: string; stepId: number; step: Step };
export type MergedStep = {
  text: string;
  /** Interviews that mention this step. */
  sources: StepSource[];
  actors: string[];
  systems: string[];
  decisions: string[];
  exceptions: string[];
};
export type Conflict = { kind: 'system' | 'rule' | 'actor'; step: string; text: string; question: string };
export type Synthesis = {
  roles: string[];
  steps: MergedStep[];
  conflicts: Conflict[];
  /** Roles named as hand-over targets that no interview covers. */
  open: string[];
  /** Steps only one person mentioned. */
  single: string[];
  lang: Lang;
};

const uniq = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = x.trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};
const norm = (v: string) => v.trim().toLowerCase();
const sameRole = (a: string, b: string) => norm(a) === norm(b) || similarity(a, b) >= 0.6;

export function synthesize(interviews: InterviewState[], lang: Lang = interviews[0]?.lang ?? 'en'): Synthesis {
  const merged: MergedStep[] = [];
  const roles = uniq(interviews.map((iv) => iv.role || '?'));
  interviews.forEach((iv, idx) => {
    const role = iv.role || '?';
    const claimed = new Set<MergedStep>();
    for (const st of iv.steps) {
      // A step matches one merged step of another interview, never one of the same interview.
      let best: MergedStep | null = null; let score = 0;
      for (const m of merged) {
        if (claimed.has(m) || m.sources.every((s) => s.role === role && interviews.indexOf(iv) === idx && s.step === st)) continue;
        if (m.sources.some((s) => s.role === role)) continue;
        const sim = similarity(m.text, st.text);
        if (sim >= MATCH_THRESHOLD && sim > score) { best = m; score = sim; }
      }
      const source: StepSource = { role, stepId: st.id, step: st };
      if (best) {
        best.sources.push(source); claimed.add(best);
        if (st.text.length > best.text.length) best.text = st.text;
      } else {
        const fresh: MergedStep = { text: st.text, sources: [source], actors: [], systems: [], decisions: [], exceptions: [] };
        merged.push(fresh); claimed.add(fresh);
      }
    }
  });
  const conflicts: Conflict[] = [];
  const single: string[] = [];
  const ask = (en: string, de: string) => (lang === 'de' ? de : en);
  for (const m of merged) {
    m.actors = uniq(m.sources.map((s) => s.step.actor));
    m.systems = uniq(m.sources.map((s) => s.step.system));
    m.decisions = uniq(m.sources.map((s) => s.step.decision));
    m.exceptions = uniq(m.sources.map((s) => s.step.exception));
    if (m.sources.length < 2) { if (interviews.length > 1) single.push(m.text); continue; }
    const by = (f: 'system' | 'decision' | 'actor') => m.sources.filter((s) => s.step[f].trim()).map((s) => `${s.role}: ${s.step[f]}`);
    if (m.systems.length > 1) {
      const who = by('system').join('; ');
      conflicts.push({ kind: 'system', step: m.text, text: ask(`System differs for "${m.text}": ${who}.`, `Das System unterscheidet sich bei "${m.text}": ${who}.`),
        question: ask(`Two colleagues use different systems for "${m.text}" (${m.systems.join(' / ')}). Which one is it in your case, and why?`, `Zwei Kolleginnen oder Kollegen nutzen für "${m.text}" unterschiedliche Systeme (${m.systems.join(' / ')}). Welches ist es bei dir, und warum?`) });
    }
    // Two rules at the same step conflict when their wording is clearly different.
    const rules = m.sources.filter((s) => s.step.decision.trim());
    for (let i = 0; i < rules.length; i += 1) for (let j = i + 1; j < rules.length; j += 1) {
      if (similarity(rules[i].step.decision, rules[j].step.decision) < 0.3 && !conflicts.some((c) => c.kind === 'rule' && c.step === m.text)) {
        const who = by('decision').join('; ');
        conflicts.push({ kind: 'rule', step: m.text, text: ask(`Rules differ for "${m.text}": ${who}.`, `Die Regeln unterscheiden sich bei "${m.text}": ${who}.`),
          question: ask(`For "${m.text}" there are two different rules (${m.decisions.join(' / ')}). Which one do you follow, and when does the other apply?`, `Für "${m.text}" gibt es zwei verschiedene Regeln (${m.decisions.join(' / ')}). Nach welcher richtest du dich, und wann gilt die andere?`) });
      }
    }
    if (m.actors.length > 1 && !m.actors.every((a, _, all) => sameRole(a, all[0]))) {
      conflicts.push({ kind: 'actor', step: m.text, text: ask(`Who does "${m.text}" differs: ${by('actor').join('; ')}.`, `Wer "${m.text}" macht, unterscheidet sich: ${by('actor').join('; ')}.`),
        question: ask(`Who does "${m.text}" in your area?`, `Wer macht "${m.text}" in deinem Bereich?`) });
    }
  }
  const open = uniq(interviews.flatMap((iv) => iv.handoffs)).filter((h) => !roles.some((r) => sameRole(r, h)));
  return { roles, steps: merged, conflicts, open, single, lang };
}

/** Questions for the next interview: what the others disagreed on, and what only one person said. */
export function agendaFor(syn: Synthesis, limit = 4): string[] {
  const qs = syn.conflicts.map((c) => c.question);
  for (const s of syn.single) qs.push(syn.lang === 'de' ? `Eine Kollegin oder ein Kollege nennt diesen Schritt: "${s}". Kommt er bei dir auch vor, und wie läuft er?` : `A colleague mentions this step: "${s}". Does it happen in your area too, and how?`);
  return qs.slice(0, limit);
}

/** Short note about the others' view, for the analyst prompt of the next interview. */
export function priorNote(syn: Synthesis): string {
  const lines = syn.steps.slice(0, 14).map((m, i) => `${i + 1}. ${m.text}${m.systems.length ? ` (${m.systems.join(' / ')})` : ''}${m.decisions.length ? `, rule: ${m.decisions.join(' / ')}` : ''}`);
  return `Roles already interviewed: ${syn.roles.join(', ')}.\n${lines.join('\n')}`.slice(0, 1500);
}

const T = {
  en: { title: 'Process synthesis', roles: 'Interviews', steps: 'Steps across the interviews', cols: ['#', 'Step', 'Said by', 'Systems', 'Rules', 'Exceptions'], conflicts: 'Where the interviews disagree', none: 'No disagreement found.', open: 'Roles named but not yet interviewed', single: 'Steps only one person mentioned', note: 'Steps are matched by similar wording, not by meaning. Check matches and conflicts before you rely on them.', use: 'Use: input for the Intent step and the process documentation.', of: 'of' },
  de: { title: 'Prozess-Synthese', roles: 'Interviews', steps: 'Schritte über alle Interviews', cols: ['#', 'Schritt', 'Genannt von', 'Systeme', 'Regeln', 'Ausnahmen'], conflicts: 'Wo die Interviews sich widersprechen', none: 'Kein Widerspruch gefunden.', open: 'Genannte, aber noch nicht befragte Rollen', single: 'Schritte, die nur eine Person nannte', note: 'Schritte werden über ähnliche Wörter zugeordnet, nicht über die Bedeutung. Prüfe Zuordnung und Widersprüche, bevor du dich darauf verlässt.', use: 'Verwendung: Eingabe für den Intent-Schritt und die Prozessdokumentation.', of: 'von' },
} as const;

const cell = (v: string) => (v || '-').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');

export function synthesisMarkdown(syn: Synthesis): string {
  const t = T[syn.lang];
  const out = [`# ${t.title}`, '', `**${t.roles} (${syn.roles.length}):** ${syn.roles.join(', ')}`, '', `## ${t.steps}`, ''];
  if (syn.steps.length) {
    out.push(`| ${t.cols.join(' | ')} |`, `|${t.cols.map(() => '---').join('|')}|`,
      ...syn.steps.map((m, i) => `| ${i + 1} | ${cell(m.text)} | ${cell(uniq(m.sources.map((s) => s.role)).join(', '))} (${uniq(m.sources.map((s) => s.role)).length} ${t.of} ${syn.roles.length}) | ${cell(m.systems.join(' / '))} | ${cell(m.decisions.join(' / '))} | ${cell(m.exceptions.join(' / '))} |`), '');
  } else out.push('-', '');
  out.push(`## ${t.conflicts}`, '', ...(syn.conflicts.length ? syn.conflicts.map((c) => `- ${c.text}`) : [t.none]), '');
  if (syn.open.length) out.push(`## ${t.open}`, '', ...syn.open.map((r) => `- ${r}`), '');
  if (syn.single.length) out.push(`## ${t.single}`, '', ...syn.single.map((s) => `- ${s}`), '');
  out.push(`_${t.note}_`, `_${t.use}_`);
  return out.join('\n') + '\n';
}

/** The synthesis as plain text for the Intent and the downstream prompts. */
export function synthesisSummary(syn: Synthesis): string {
  const out = [`Process described in ${syn.roles.length} interviews (roles: ${syn.roles.join(', ')}). Steps are matched by similar wording.`, 'Steps in order:'];
  syn.steps.forEach((m, i) => out.push(`${i + 1}. ${m.text}${m.actors.length ? ` (by ${m.actors.join(' / ')})` : ''}${m.systems.length ? ` (in ${m.systems.join(' / ')})` : ''}${m.decisions.length ? ` (rule: ${m.decisions.join(' / ')})` : ''}${m.exceptions.length ? ` (exception: ${m.exceptions.join(' / ')})` : ''}${m.sources.length < syn.roles.length ? ` [mentioned by ${m.sources.length} of ${syn.roles.length}]` : ''}`));
  if (syn.conflicts.length) out.push('Disagreements between the interviews (unresolved):', ...syn.conflicts.map((c) => `- ${c.text}`));
  if (syn.open.length) out.push(`Roles named but not yet interviewed: ${syn.open.join(', ')}.`);
  out.push('Source: interviews with people who describe the process as they experience it; nothing was checked against the systems.');
  return out.join('\n');
}
