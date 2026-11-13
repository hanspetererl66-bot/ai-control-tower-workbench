/**
 * Diagrams in the chat. The agent writes a fenced code block with the language `mermaid`; the chat draws it.
 * This file holds the pure rules (which diagram kinds we draw, what the text looks like); drawing is in `ui/MermaidDiagram.tsx`.
 * Nothing here talks to a network or to Figma.
 */

/** The four kinds the first release draws. Key = first word of the diagram text, value = label for the user. */
export const DIAGRAM_KINDS: Record<string, string> = {
  flowchart: 'Flowchart',
  graph: 'Flowchart',
  gantt: 'Gantt chart',
  sequenceDiagram: 'Sequence diagram',
  'stateDiagram-v2': 'State diagram',
  stateDiagram: 'State diagram',
};

/** Source without Mermaid front matter (`---` block), `%%{init}%%` directives and `%%` comments, trimmed. */
export function stripPreamble(source: string): string {
  let text = source.replace(/\r\n?/g, '\n').trim();
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) text = text.slice(end + 4);
  }
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('%%'))
    .join('\n')
    .trim();
}

/** The label of the diagram kind ("Flowchart", ...), or null when the text is empty or of a kind we do not draw. */
export function diagramKind(source: string): string | null {
  const first = stripPreamble(source).split(/\s+/)[0] ?? '';
  return Object.prototype.hasOwnProperty.call(DIAGRAM_KINDS, first) ? DIAGRAM_KINDS[first] : null;
}

/** Mermaid lets a diagram change its own security settings with an init directive. We never allow that. */
export function hasInitDirective(source: string): boolean {
  return /%%\{\s*(init|initialize)\b/i.test(source);
}

/** True when the chat should try to draw this block (a supported kind and no init directive). */
export function shouldDraw(source: string): boolean {
  return diagramKind(source) !== null && !hasInitDirective(source);
}

/** The language of a Markdown code block, from the class react-markdown gives it (`language-mermaid`). */
export function codeLanguage(className?: string): string | null {
  const m = /(?:^|\s)language-([\w-]+)/.exec(className ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** True when the person asks for a diagram (German or English), so the hint for the agent is only added then. */
export function wantsDiagram(text: string): boolean {
  return /\b(diagram(m|me|s)?|flow ?chart|flussdiagramm|ablaufdiagramm|ablaufplan|prozessdiagramm|gantt|sequenz\w*|sequence\s+diagram|zustandsdiagramm|state\s+(diagram|machine)|mermaid)\b/i.test(text);
}

/** The hint for the agent: how to write a diagram so the chat can draw it. Added to the prompt only when `wantsDiagram`. */
export const DIAGRAM_NOTE = [
  'DIAGRAM — the chat draws diagrams from Mermaid text. Write the diagram as one fenced code block with the language mermaid.',
  'Use only these kinds: flowchart (TD or LR), gantt (with dateFormat YYYY-MM-DD), sequenceDiagram, stateDiagram-v2.',
  'Keep labels short and put a label in double quotes if it contains brackets, colons or other special characters.',
  'No init directive (%%{init}%%), no HTML, no links and no click handlers in the diagram; they are not drawn.',
  'Put one sentence before or after the block that says what the diagram shows. Say plainly that the diagram is shown in this chat; do not claim that a file was created or that anything was sent to Figma.',
].join('\n');
