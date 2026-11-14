import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findMentions, newBudget, type Glossary, type PhraseIndex } from '../ontology-glossary';
import { NONE, describeEntry, splitByMentions, type Ambiguity } from '../ontology-chat';
import { KEY_SEP, TERM_CLASS } from '../ontology-chat-marks';

/** What the chat needs to show the terms of the ontology; not given: no marks, no ask-back. */
export type ChatTermsControl = {
  glossary: Glossary;
  index: PhraseIndex;
  /** A term was asked for in the catalog; the key comes from the glossary. */
  onOpen: (key: string) => void;
};

/** The person's own message with the terms marked (the answers are marked by the Markdown plugin). */
export function MarkedText({ text, index }: { text: string; index: PhraseIndex }) {
  const parts = useMemo(() => splitByMentions(text, findMentions(text, index, newBudget())), [text, index]);
  return (
    <span>
      {parts.map((p, i) => (p.keys ? <span key={i} className={TERM_CLASS} role="button" tabIndex={0} data-keys={p.keys.join(KEY_SEP)}>{p.text}</span> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

/**
 * The card for every marked term in the chat. One listener for the whole page: hover or click opens it, Enter or Space opens it
 * for the keyboard (focus moves into the card), Escape closes it and gives the focus back. It shows text only and asks the
 * glossary of the host, never the page, what a key means.
 */
export function TermCardLayer({ terms }: { terms: ChatTermsControl }) {
  const [open, setOpen] = useState<{ keys: string[]; x: number; y: number; below: boolean } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const pinned = useRef(false);
  const timers = useRef<{ hover?: number; leave?: number }>({});
  const card = useRef<HTMLDivElement>(null);
  const byKey = useMemo(() => new Map(terms.glossary.entries.map((e) => [e.key, e])), [terms.glossary]);

  useEffect(() => {
    const clear = () => { window.clearTimeout(timers.current.hover); window.clearTimeout(timers.current.leave); };
    const close = (refocus: boolean) => {
      clear();
      const a = anchor.current;
      anchor.current = null; pinned.current = false;
      setOpen(null);
      if (refocus) a?.focus();
    };
    const show = (el: HTMLElement, pin: boolean, focus: boolean) => {
      const keys = (el.getAttribute('data-keys') ?? '').split(KEY_SEP).filter((k) => byKey.has(k));
      if (!keys.length) return;
      if (anchor.current === el) { pinned.current = pinned.current || pin; return; }
      const r = el.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 16);
      anchor.current = el; pinned.current = pin;
      setOpen({ keys, x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), y: r.bottom + 6, below: true });
      if (focus) window.setTimeout(() => card.current?.focus(), 0);
    };
    const termOf = (t: EventTarget | null) => ((t as HTMLElement | null)?.closest?.(`.${TERM_CLASS}`) ?? null) as HTMLElement | null;
    const inCard = (t: EventTarget | null) => Boolean((t as HTMLElement | null)?.closest?.('.chat-term-card'));
    const over = (e: MouseEvent) => {
      const el = termOf(e.target);
      window.clearTimeout(timers.current.leave);
      if (el && !pinned.current) { window.clearTimeout(timers.current.hover); timers.current.hover = window.setTimeout(() => show(el, false, false), 150); }
    };
    const out = (e: MouseEvent) => {
      window.clearTimeout(timers.current.hover);
      if ((termOf(e.target) || inCard(e.target)) && !pinned.current) { window.clearTimeout(timers.current.leave); timers.current.leave = window.setTimeout(() => close(false), 250); }
    };
    const click = (e: MouseEvent) => {
      const el = termOf(e.target);
      if (el) { if (anchor.current === el && pinned.current) close(false); else { close(false); show(el, true, false); } return; }
      if (!inCard(e.target)) close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && anchor.current) { e.preventDefault(); close(true); return; }
      const el = termOf(e.target);
      if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); close(false); show(el, true, true); }
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('click', click);
    document.addEventListener('keydown', key);
    return () => {
      clear();
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', key);
    };
  }, [byKey]);

  if (!open) return null;
  const items = open.keys.map((k) => byKey.get(k)).filter((e): e is NonNullable<typeof e> => Boolean(e)).map(describeEntry);
  return createPortal(
    <div ref={card} className="chat-term-card" role="dialog" aria-label="Term definition" tabIndex={-1} style={{ left: open.x, top: open.y, width: Math.min(340, window.innerWidth - 16) }}>
      {items.length > 1 && <p className="chat-term-amb">This name means different things in {items.length} ontologies.</p>}
      {items.map((it) => (
        <section key={it.key} className="chat-term-item">
          <p className="chat-term-head"><strong>{it.title}</strong><span className={`chat-term-chip ${it.status.startsWith('Deprecated') ? 'chat-term-chip-old' : ''}`}>{it.status}</span></p>
          <p className="chat-term-def">{it.definition}</p>
          {it.meta.map((m) => <p key={m} className="chat-term-meta">{m}</p>)}
          <button type="button" className="chat-term-open" onClick={() => terms.onOpen(it.key)}>Open in the catalog</button>
        </section>
      ))}
    </div>,
    document.body,
  );
}

/** The ask-back under the composer: a name that means something different in two ontologies. Nothing is chosen for the person. */
export function AskBack({ pending, onChoose, hold = '' }: { pending: Ambiguity[]; onChoose: (ambiguity: Ambiguity, key: string) => void; hold?: string }) {
  if (hold && !pending.length) return <div className="term-ask" role="status"><p className="term-ask-lead">{hold}</p></div>;
  if (!pending.length) return null;
  return (
    <div className="term-ask" role="group" aria-label="Which meaning do you want?">
      <p className="term-ask-lead">Some names exist in more than one ontology. Choose what you mean, then press Send again. Nothing is sent until then.</p>
      {pending.map((a) => (
        <div key={a.id} className="term-ask-item">
          <p className="term-ask-q">“{a.text}”: which one?</p>
          <div className="term-ask-options">
            {a.options.map((o) => (
              <button key={o.key} type="button" className="ghost-btn" onClick={() => onChoose(a, o.key)} title={o.definition}>
                <strong>{o.label}</strong> · {o.ontology}<span className="term-ask-def"> {o.definition || 'No definition yet.'}</span>
              </button>
            ))}
            <button type="button" className="ghost-btn" onClick={() => onChoose(a, NONE)}>Neither</button>
          </div>
        </div>
      ))}
    </div>
  );
}
