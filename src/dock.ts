import { DOC_TITLE, type AgentProject, type DocKey } from './agent-project.ts';

/** What the docked Joule chat knows about the screen next to it. */
export type DockFocus = { projectId: string; docKey: DocKey };

const CONFIRM = /^\s*(yes|yes,? confirm|confirm|confirmed|ok(ay)?,? confirm|ja|ja,? bestätigt?|bestätig(e|t|en)?|passt|freigeben)\s*[.!]*\s*$/i;

/** True if the typed line is a plain "yes, confirm" for the document on screen (it is not sent to the model). */
export function isConfirmCommand(text: string): boolean {
  return CONFIRM.test(text);
}

/**
 * Context block added to the prompt while a project document is open. Joule sees the full document and is told how to answer:
 * a short comment plus the complete new version in one markdown block, which the person applies with a button.
 */
export function documentNote(project: AgentProject, key: DocKey): string {
  const text = project.docs[key] ?? '';
  const status = project.stale.includes(key) ? 'outdated' : project.confirmed[key] ? 'confirmed' : 'draft';
  return [
    `DOCUMENT ON SCREEN — the person is editing "${DOC_TITLE[key]}" for the agent project "${project.answers.name}" (status: ${status}). It is shown next to this chat.`,
    'If the person asks for a change, answer with one or two sentences and then the COMPLETE updated document in a single ```markdown block, nothing else inside it. Never change the document yourself: the person applies your version with a button. If they only ask a question, answer it and send no block.',
    '```markdown',
    text.slice(0, 20_000),
    '```',
  ].join('\n');
}

/** The last fenced markdown block of an answer, or null. Used for "Apply to document". */
export function extractDocument(reply: string): string | null {
  const blocks = [...reply.matchAll(/```(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n```/gi)];
  const last = blocks.at(-1)?.[1]?.trim();
  return last && last.length > 20 ? last : null;
}

export const DOCK_ACTIONS: { label: string; prompt: string }[] = [
  { label: 'Find gaps', prompt: 'Review this document. List gaps, contradictions and unclear points. Do not rewrite it.' },
  { label: 'Make it shorter', prompt: 'Make the document shorter and clearer. Keep every requirement.' },
  { label: 'Add risks', prompt: 'Add the risks you think are missing, each with a mitigation.' },
  { label: 'Explain it simply', prompt: 'Explain this document in five plain sentences for a business owner. Do not change it.' },
];
