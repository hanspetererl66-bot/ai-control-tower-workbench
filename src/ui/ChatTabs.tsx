import { useEffect, useState } from 'react';
import type { StarterPrompt } from '../starter-prompts';
import { TABS, loadUse, popular, recordUse, saveUse, suggested, whatsNew, type Entry, type SkillLike, type SpaceLike, type TabId, type UseMap } from '../chat-tabs';
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

const TAB_KEY = 'werkbank.chatTab';
const EMPTY: Record<TabId, string> = {
  favorites: 'Nothing here yet. Add your own prompts and favourite skills in the settings.',
  suggested: 'Nothing to suggest right now: you already use all installed skills.',
  popular: 'What you use most often will appear here.',
  new: 'Nothing new in the last 30 days.',
};

/** Under the empty chat: Favorites (own prompts, favourite skills, the cards "Heute für dich"), Suggested, Popular, What's new. */
export default function ChatTabs(p: Props) {
  const [tab, setTab] = useState<TabId>(() => { try { const t = window.localStorage.getItem(TAB_KEY); return TABS.some((x) => x.id === t) ? (t as TabId) : 'favorites'; } catch { return 'favorites'; } });
  const [used, setUsed] = useState<UseMap>(() => loadUse(window.localStorage));
  useEffect(() => { try { window.localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ } }, [tab]);

  const skills = p.skills ?? [], spaces = p.spaces ?? [];
  const favNames = (p.favorites ?? []).map((f) => f.label);
  const lists: Record<Exclude<TabId, 'favorites'>, Entry[]> = { suggested: suggested(skills, favNames, used), popular: popular(used), new: whatsNew(skills, spaces) };

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
          <button key={t.id} role="tab" id={`chat-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="chat-tab-panel" className={`chat-tab ${tab === t.id ? 'chat-tab-on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="chat-tab-panel" id="chat-tab-panel" role="tabpanel" aria-labelledby={`chat-tab-${tab}`}>
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
      </div>
    </section>
  );
}
