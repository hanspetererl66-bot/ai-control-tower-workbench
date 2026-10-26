import { useEffect, useRef, useState } from 'react';
import { fetchSpaceHtml, relativeTime, type Space } from '../spaces';
import { handleSub4meMessage, type BridgeCall } from '../sub4me-bridge';
import { handlePrdMessage, PRD_SPACE } from '../prd-bridge';
import { parseAskMessage } from '../space-ask';
import { applySpacePrefs } from '../preferences-style';
import type { Preferences } from '../preferences';
import { applySpaceScale, applySpaceTheme, DEFAULT_SPACE_SCALE, type SpaceScale } from '../space-scale';
import { applySpaceTools, type SpaceToolsState } from '../space-tools';
import { downloadSpaceFile, emailDraftUrl } from '../space-share';
import { parseHandoffMessage, parseStateMessage, restoreMessage, type Handoff, type IncomingHandoff } from '../space-handoff';

/** Ask the space to show one of its tabs. `nonce` makes repeating the same tab count as a new request. */
export type SpaceTabRequest = { tab: string; nonce: number; /** Target space; defaults to the AI Control Tower. */ space?: string };

export default function SpaceViewer({
  space,
  tabRequest,
  bridge,
  bridgeEnabled = false,
  onAsk,
  textScale = DEFAULT_SPACE_SCALE,
  theme = 'light',
  prefs,
  onHandoff,
  onSpaceState,
  savedState,
  incoming,
  studioAgents,
  onIncomingDelivered,
}: {
  space: Space;
  tabRequest?: SpaceTabRequest | null;
  /** Connector calls for spaces that need them (Sub4Me tickets). */
  bridge?: BridgeCall;
  bridgeEnabled?: boolean;
  /** A Space asks Joule a question ("Joule fragen"): the host opens the chat and sends it. */
  onAsk?: (prompt: string) => void;
  /** Text size of the page inside the frame (1 = as authored). */
  textScale?: SpaceScale;
  /** The app's resolved theme; the Space follows it instead of the operating system. */
  theme?: 'light' | 'dark';
  /** Personal look (accent, font, contrast); optional. */
  prefs?: Preferences;
  /** The Space hands work to another Space (the host opens it). */
  onHandoff?: (handoff: Handoff) => void;
  /** The Space reports its working state so it survives a trip to another Space. */
  onSpaceState?: (state: Record<string, unknown>) => void;
  savedState?: Record<string, unknown>;
  /** Work another Space handed to this one; delivered once the frame has loaded. */
  incoming?: IncomingHandoff[];
  /** Agents built in the Agent Studio; the AI Control Tower registers them as processes. */
  studioAgents?: unknown[];
  onIncomingDelivered?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);
  const postTab = () => {
    if (!tabRequest || !loaded.current) return;
    // The frame has an opaque origin, so '*' is the only possible target; the
    // message carries a tab id and nothing else.
    frame.current?.contentWindow?.postMessage({ type: 'ct:open-tab', tab: tabRequest.tab }, '*');
  };
  useEffect(postTab, [tabRequest?.tab, tabRequest?.nonce]);
  const postAgents = () => {
    if (space.slug !== 'ai-control-tower' || !loaded.current || !studioAgents) return;
    frame.current?.contentWindow?.postMessage({ type: 'ct:studio-agents', agents: studioAgents }, '*');
  };
  const agentsKey = JSON.stringify(studioAgents ?? null);
  useEffect(postAgents, [agentsKey]);

  const askRef = useRef(onAsk);
  askRef.current = onAsk;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const prompt = parseAskMessage(event.data);
      if (prompt) askRef.current?.(prompt);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handoffRef = useRef(onHandoff);
  handoffRef.current = onHandoff;
  const stateRef = useRef(onSpaceState);
  stateRef.current = onSpaceState;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const handoff = parseHandoffMessage(event.data);
      if (handoff) { handoffRef.current?.(handoff); return; }
      const state = parseStateMessage(event.data);
      if (state) stateRef.current?.(state);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const restoreRef = useRef({ savedState, incoming, onIncomingDelivered });
  restoreRef.current = { savedState, incoming, onIncomingDelivered };
  const postRestore = () => {
    const { savedState: saved, incoming: inbox, onIncomingDelivered: delivered } = restoreRef.current;
    if (!saved && !inbox?.length) return;
    frame.current?.contentWindow?.postMessage(restoreMessage(saved, inbox ?? []), '*');
    if (inbox?.length) delivered?.();
  };

  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  useEffect(() => {
    if (!bridgeEnabled) return;
    const onMessage = (event: MessageEvent) => {
      // Only the frame of this space may talk to the bridge.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const handle = space.slug === PRD_SPACE ? handlePrdMessage : handleSub4meMessage;
      void handle(event.data, bridgeRef.current).then((reply) => {
        if (reply) frame.current?.contentWindow?.postMessage(reply, '*');
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bridgeEnabled, space.slug]);

  // Search and filter: the page script (space-tools.ts) does the work, these are its controls.
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [tools, setTools] = useState<SpaceToolsState>({ searchable: false, count: null, filters: [] });
  const sendTools = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(message, '*');
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== 'sp:state' || !Array.isArray(data.filters)) return;
      const filters = data.filters
        .filter((f: any) => f && typeof f.label === 'string' && Array.isArray(f.values))
        .map((f: any) => ({ label: f.label as string, values: f.values.filter((v: unknown) => typeof v === 'string') as string[] }));
      setTools({ searchable: Boolean(data.searchable), count: typeof data.count === 'number' ? data.count : null, filters });
      // A tab without that column no longer offers its filter, so its selection must not keep hiding rows.
      setSelected((current) => {
        const kept = Object.fromEntries(Object.entries(current).filter(([label, value]) => filters.some((f: any) => f.label === label && f.values.includes(value))));
        return Object.keys(kept).length === Object.keys(current).length ? current : kept;
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => sendTools({ type: 'sp:search', query }), 150);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    sendTools({ type: 'sp:filter', filters: selected });
  }, [selected]);
  const filtersActive = Object.keys(selected).length > 0;
  function resetTools() {
    setQuery('');
    setSelected({});
    sendTools({ type: 'sp:clear' });
  }

  const [bust, setBust] = useState(space.updatedAt);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareNote, setShareNote] = useState('');
  async function share(withMail: boolean) {
    try {
      const name = await downloadSpaceFile(space.slug);
      setShareNote(withMail ? `Saved ${name}. Attach it to the e-mail.` : `Saved ${name}.`);
      if (withMail) window.location.href = emailDraftUrl(space.title, name);
    } catch (e: any) {
      setShareNote(e?.message ?? 'Sharing failed.');
    }
    setShareOpen(false);
    setTimeout(() => setShareNote(''), 8000);
  }
  const [html, setHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setLoadError(null);
    fetchSpaceHtml(space.slug, bust)
      .then((h) => !cancelled && setHtml(h))
      .catch((e) => !cancelled && setLoadError(e?.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [space.slug, bust]);

  return (
    <main className="main">
      <header className="topbar">
        <button className="icon-btn" title="Spaces" aria-label="Spaces">
          <ListIcon />
        </button>
        <div className="topbar-stack">
          <h1 className="topbar-title" title={space.title}>{space.title}</h1>
          <span className="topbar-sub">Updated {relativeTime(space.updatedAt)}</span>
        </div>

        <div className="space-tools" role="search">
          <input
            className="space-search"
            type="search"
            value={query}
            placeholder="In diesem Space suchen"
            aria-label="In diesem Space suchen"
            disabled={!tools.searchable}
            title={tools.searchable ? undefined : 'Dieser Space hat keine durchsuchbaren Inhalte.'}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && resetTools()}
          />
          {tools.filters.slice(0, 4).map((filter) => (
            <select
              key={filter.label}
              className={`space-filter ${selected[filter.label] ? 'space-filter-on' : ''}`}
              aria-label={`Filter: ${filter.label}`}
              value={selected[filter.label] ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setSelected((current) => {
                  const next = { ...current };
                  if (value) next[filter.label] = value;
                  else delete next[filter.label];
                  return next;
                });
              }}
            >
              <option value="">{filter.label}: alle</option>
              {filter.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ))}
          {tools.count !== null && (
            <span className="space-count" role="status">
              {tools.count} Treffer
            </span>
          )}
          {(query || filtersActive) && (
            <button className="ghost-btn" onClick={resetTools} title="Suche und Filter zurücksetzen">
              Zurücksetzen
            </button>
          )}
        </div>

        <button
          className={`ghost-btn ${insightsOpen ? 'ghost-btn-on' : ''}`}
          onClick={() => setInsightsOpen((v) => !v)}
          disabled={space.insights.length === 0}
          title={space.insights.length ? 'Insights' : 'No insights recorded for this space'}
        >
          <BulbIcon /> Insights
        </button>
        <div className="chip-wrap">
          <button className={`ghost-btn ${shareOpen ? 'ghost-btn-on' : ''}`} onClick={() => setShareOpen((v) => !v)} aria-expanded={shareOpen} title="Share this Space as a file">
            Share
          </button>
          {shareOpen && (
            <div className="menu share-menu" role="menu" style={{ top: 'calc(100% + 6px)', bottom: 'auto', right: 0, left: 'auto' }}>
              <button role="menuitem" className="connector-menu-item" onClick={() => void share(false)}>Save as file</button>
              <button role="menuitem" className="connector-menu-item" onClick={() => void share(true)}>Send by e-mail</button>
            </div>
          )}
        </div>
        {shareNote && <span className="space-count" role="status">{shareNote}</span>}
        {/* Re-render what is already on disk. Regeneration remains an explicit conversation. */}
        <button className="icon-btn" onClick={() => setBust(Date.now())} title="Refresh" aria-label="Refresh">
          <RefreshIcon />
        </button>
        <button className="icon-btn topbar-more" title="More" aria-label="More">
          ···
        </button>
      </header>

      {insightsOpen && space.insights.length > 0 && (
        <section className="insights">
          <h2 className="insights-title">Insights</h2>
          <ul>
            {space.insights.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {loadError ? (
        <div className="banner-error">Could not load this space: {loadError}</div>
      ) : (
        <iframe
          ref={frame}
          onLoad={() => {
            // The frame first loads empty while the page is still being fetched; restoring then would use up the hand-over.
            if (html === null) return;
            loaded.current = true;
            postRestore();
            postTab();
            postAgents();
            if (query) sendTools({ type: 'sp:search', query });
            if (filtersActive) sendTools({ type: 'sp:filter', filters: selected });
          }}
          key={`${space.slug}-${bust}-${html?.length ?? 0}-${textScale}-${theme}-${prefs ? `${prefs.accent}${prefs.font}${prefs.contrast}${prefs.reduceMotion}` : ''}`}
          className="space-frame"
          title={space.title}
          srcDoc={applySpaceTools(applySpaceScale((() => { const themed = applySpaceTheme(html ?? '', theme); return prefs ? applySpacePrefs(themed, prefs) : themed; })(), textScale))}
          // No allow-same-origin: the page is agent-authored, so it gets an
          // opaque origin and cannot reach this window or its storage.
          sandbox="allow-scripts"
        />
      )}
    </main>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 12h4M6.5 14h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.4.3.6.7.6 1.1V11h3.6v-.5c0-.4.2-.8.6-1.1A4.2 4.2 0 0 0 8 1.8z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13.6 1.9v3.2h-3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
