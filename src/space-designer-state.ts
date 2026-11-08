/**
 * Small pure helpers of the Space Designer: undo/redo history and the link between the preview frame and the editor.
 * The preview is a sandboxed frame; it only reports which block was clicked. The editor accepts the message only
 * from its own frame and only a block id of the current layout.
 */
import type { Layout } from './space-layout.ts';

export type History = { past: Layout[]; present: Layout; future: Layout[] };
const LIMIT = 60;

export const startHistory = (layout: Layout): History => ({ past: [], present: layout, future: [] });

/** A new state; an identical one (same content) is not recorded. */
export function commit(h: History, next: Layout): History {
  if (next === h.present || JSON.stringify(next) === JSON.stringify(h.present)) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}
export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;
export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}
export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/** What the preview frame sends. */
export function parsePreviewMessage(data: unknown, layout: Layout): { type: 'select'; id: string } | { type: 'scroll'; y: number } | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as { type?: unknown; id?: unknown; y?: unknown };
  if (m.type === 'wbd:scroll' && typeof m.y === 'number' && Number.isFinite(m.y)) return { type: 'scroll', y: Math.max(0, Math.min(1e6, m.y)) };
  if (m.type !== 'wbd:select' || typeof m.id !== 'string') return null;
  return layout.blocks.some((b) => b.id === m.id) ? { type: 'select', id: m.id } : null;
}

const MARK = 'wbd-preview';

/** The page for the preview frame: a click selects a block; the selected block is outlined. Not part of the saved page. */
export function withPreview(html: string, selectedId: string | null, scrollY = 0): string {
  const sel = selectedId && /^[A-Za-z0-9_-]{1,40}$/.test(selectedId) ? selectedId : '';
  const style = `<style id="${MARK}">[data-wb-block]{cursor:pointer}[data-wb-block]:hover{outline:1px dashed var(--accent,#7c5cff);outline-offset:3px}${sel ? `[data-wb-block="${sel}"]{outline:2px solid var(--accent,#7c5cff)!important;outline-offset:3px}` : ''}</style>`;
  const script = `<script>document.addEventListener('click',function(e){var t=e.target&&e.target.closest?e.target.closest('[data-wb-block]'):null;e.preventDefault();e.stopPropagation();if(t)parent.postMessage({type:'wbd:select',id:t.getAttribute('data-wb-block')},'*')},true);var y=${Math.round(Math.max(0, scrollY))};if(y)addEventListener('load',function(){scrollTo(0,y)});addEventListener('scroll',function(){parent.postMessage({type:'wbd:scroll',y:scrollY||pageYOffset},'*')});</script>`;
  const tail = style + script;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${tail}</body>`) : html + tail;
}
