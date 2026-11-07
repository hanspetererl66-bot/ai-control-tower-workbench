import { useEffect, useState } from 'react';
import type { StarterPrompt } from '../starter-prompts';
import { TABS, nextTab, loadUse, popular, recordUse, saveUse, suggested, whatsNew, type Entry, type SkillLike, type SpaceLike, type RankRow, type TabId, type UseMap } from '../chat-tabs';
import BriefingCards from './BriefingCards';

type Props = {
  disabled: boolean;
  canAsk: boolean;
  hiddenBriefing?: string[];
  own?: StarterPrompt[];
  favorites?: StarterPrompt[];
  skills?: SkillLike[];
  spaces?: SpaceLike[];
  onPrompt: (prompt: string) => void;
  /** Open a Space (and one of its tabs). */
  onOpen?: (target: { space: string; tab?: string }) => void;
  onAsk: (prompt: string, connector?: string) => void;
};


/** One small line icon per tab. */
function TabIcon({ id }: { id: TabId }) {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (id === 'favorites') return <svg {...common}><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.5l-3.8 2.1.7-4.3-3.1-3 4.3-.6z" /></svg>;
  if (id === 'suggested') return <svg {...common}><path d="M6.5 1.8l1.2 3.1 3.1 1.2-3.1 1.2-1.2 3.1-1.2-3.1L2.2 6.1l3.1-1.2zM12 9.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" /></svg>;
  if (id === 'popular') return <svg {...common}><path d="M2 12l4-4 2.5 2.5L14 5M10 5h4v4" /></svg>;
  return <svg {...common}><path d="M8 2a4 4 0 00-4 4v2.5L2.8 11h10.4L12 8.5V6a4 4 0 00-4-4zM6.5 13a1.6 1.6 0 003 0" /></svg>;
}
const EMPTY: Record<TabId, string> = {
  favorites: 'Nothing here yet. Add your own prompts and favourite skills in the settings.',
  suggested: 'Nothing to suggest right now: you already use all installed skills.',
  popular: 'What you use most often will appear here.',
  new: 'Nothing new in the last 30 days.',
};

/** Under the empty chat: Favorites (own prompts, favourite skills, the cards "Heute für dich"), Suggested, Popular, What's new. */
export default function ChatTabs(p: Props) {
  const [tab, setTab] = useState<TabId | null>(null); // the chat starts minimal: every start has all lists closed, a click opens one, the next click closes it
  const [used, setUsed] = useState<UseMap>(() => loadUse(window.localStorage));
  // The organisation's ranking from the shared database; without it (not set up, offline) Popular shows local use only.
  const [ranking, setRanking] = useState<RankRow[]>([]);
  useEffect(() => {
    let live = true;
    void window.host?.skillDbRanking?.().then((r) => { if (live && r?.ok && Array.isArray(r.rows)) setRanking(r.rows); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const skills = p.skills ?? [], spaces = p.spaces ?? [];
  const favNames = (p.favorites ?? []).map((f) => f.label);
  const lists: Record<Exclude<TabId, 'favorites'>, Entry[]> = { suggested: suggested(skills, favNames, used), popular: popular(used, ranking, skills), new: whatsNew(skills, spaces) };

  const use = (e: Entry) => {
    const next = recordUse(used, e);
    setUsed(next); saveUse(window.localStorage, next);
    if (e.prompt) p.onPrompt(e.prompt); else if (e.open) p.onOpen?.(e.open);
  };
  const chip = (s: StarterPrompt, kind: string) => (
    <button key={`${kind}-${s.label}`} className="starter" disabled={p.disabled} title={s.prompt} onClick={() => use({ key: `${kind}:${s.label}`, label: s.label, hint: '', prompt: s.prompt })}>{s.label}</button>
  );
  const own = p.own ?? [], favorites = p.favorites ?? [];

  return (
    <section className="chat-tabs" aria-label="Start here">
      <div className="chat-tabs-bar" role="tablist" aria-label="Start here">
        {TABS.map((t) => (
          <button key={t.id} role="tab" id={`chat-tab-${t.id}`} aria-selected={tab === t.id} aria-expanded={tab === t.id} aria-controls="chat-tab-panel" className={`chat-tab ${tab === t.id ? 'chat-tab-on' : ''}`} onClick={() => setTab((cur) => nextTab(cur, t.id))}><TabIcon id={t.id} /><span>{t.label}</span></button>
        ))}
      </div>
      {tab && <div className="chat-tab-panel" id="chat-tab-panel" role="tabpanel" aria-labelledby={`chat-tab-${tab}`}>
        {tab === 'favorites' ? (
          <>
            {own.length > 0 && <><div className="starters-title">My prompts</div><div className="starters-list">{own.map((s) => chip(s, 'own'))}</div></>}
            {favorites.length > 0 && <><div className="starters-title">Favourite skills</div><div className="starters-list">{favorites.map((s) => chip(s, 'skill'))}</div></>}
            {p.onOpen && <BriefingCards disabled={p.disabled} canAsk={p.canAsk} hidden={p.hiddenBriefing} onOpen={p.onOpen} onAsk={p.onAsk} />}
            {!own.length && !favorites.length && !p.onOpen && <p className="chat-tab-empty">{EMPTY.favorites}</p>}
          </>
        ) : lists[tab].length === 0 ? (
          <p className="chat-tab-empty">{EMPTY[tab]}</p>
        ) : (
          <ul className="chat-tab-list">
            {lists[tab].map((e) => (
              <li key={e.key}>
                <button className="chat-entry" disabled={e.prompt ? p.disabled : !p.onOpen} onClick={() => use(e)}>
                  <span className="chat-entry-label">{e.label}</span>
                  {e.hint && <span className="chat-entry-hint">{e.hint}</span>}
                  <span className="chat-entry-kind">{e.open ? 'Space' : 'Skill'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>}
    </section>
  );
}
