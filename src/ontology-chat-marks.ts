/**
 * Marks the terms of the ontology in a chat answer. A rehype plugin: it changes the tree that react-markdown turns into
 * elements, so React stays in charge of the page (no editing of the finished DOM while an answer is still streaming).
 * The same rules as everywhere (`findMentions`): phrases of two or more words, capital acronyms, never a single everyday word.
 */
import { findMentions, newBudget, type PhraseIndex } from './ontology-glossary.ts';

type HNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HNode[] };

/** Text inside these is never marked: code is code, a header or a link is no place for a card. */
const SKIP = new Set(['code', 'pre', 'a', 'button', 'th', 'thead', 'script', 'style', 'svg']);
export const TERM_CLASS = 'chat-term';
/** Separator of the keys in `data-keys`; no key contains a line break. */
export const KEY_SEP = '\n';

function walk(node: HNode, index: PhraseIndex, budget: ReturnType<typeof newBudget>): void {
  if (!node.children) return;
  if (node.type === 'element' && node.tagName && SKIP.has(node.tagName)) return;
  const next: HNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const found = findMentions(child.value, index, budget);
      if (!found.length) { next.push(child); continue; }
      let pos = 0;
      for (const m of found) {
        if (m.start > pos) next.push({ type: 'text', value: child.value.slice(pos, m.start) });
        next.push({
          type: 'element', tagName: 'span',
          properties: { className: [TERM_CLASS], tabIndex: 0, role: 'button', dataKeys: m.keys.join(KEY_SEP) },
          children: [{ type: 'text', value: m.text }],
        });
        pos = m.end;
      }
      if (pos < child.value.length) next.push({ type: 'text', value: child.value.slice(pos) });
    } else {
      walk(child, index, budget);
      next.push(child);
    }
  }
  node.children = next;
}

/** `rehypePlugins={[[rehypeTerms, index]]}`: a fresh budget (2 per term, 200 per answer) for every answer. */
export function rehypeTerms(index?: PhraseIndex) {
  return (tree: HNode) => {
    if (!index || !index.phrases.length) return;
    walk(tree, index, newBudget());
  };
}
