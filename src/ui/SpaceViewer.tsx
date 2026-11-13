import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSpaceHtml, relativeTime, type Space } from '../spaces';
import { handleSalesMessage, handleSub4meMessage, SALES_SPACE, type BridgeCall } from '../sub4me-bridge';
import { handlePrdMessage, PRD_SPACE } from '../prd-bridge';
import { CONTROL_TOWER_BRIDGE_SPACE, PRECLOSE_SPACE, handleControlTowerForecastMessage, handlePrecloseForecastMessage } from '../forecast-bridge';
import { HOTLINE_SPACE, handleHotlineMailMessage, type HotlineMailHost } from '../hotline-mail-bridge';
import { MONITORING_SPACE, SHADOW_SPACE, handleMonitoringMessage, type MonitoringHost } from '../monitoring-bridge';
import { handleShadowMessage, type ShadowHost } from '../shadow-bridge';
import { ONBOARDING_SPACE, handleOnboardingMessage, type OnboardingHost } from '../onboarding-bridge';
import { HIRING_SPACE, handleHiringMessage, type HiringHost } from '../hiring-bridge';
import { OBSERVABILITY_SPACE, handleObservabilityMessage, type ObservabilityHost } from '../observability-bridge';
import { handleDatabricksPrecloseMessage } from '../databricks-preclose-bridge';
import { handleSalesKnowledgeMessage, type SalesKnowledgeDeps } from '../sales-knowledge-bridge';
import { handleCustomer360Message, CUSTOMER360_SPACE, type Customer360Deps } from '../customer360-bridge';
import { handleRenewalsMessage, RENEWALS_SPACE, type RenewalsDeps } from '../renewals-bridge';
import { handleInterviewMessage, INTERVIEW_SPACE, type InterviewDeps } from '../interview-bridge';
import { parseAskMessage } from '../space-ask';
import { applySpacePrefs } from '../preferences-style';
import type { Preferences } from '../preferences';
import { applySpaceFit, applySpaceScroll, applySpaceTheme, DEFAULT_SPACE_SCALE, SPACE_SCALES, type SpaceScale } from '../space-scale';
import { applySpaceTools, type SpaceToolsState } from '../space-tools';
import { applySpaceTerms, pageEntries, parseOpenTermMessage, type SpaceTermsControl } from '../space-terms';
import { downloadSpaceFile, emailDraftUrl } from '../space-share';
import { parseOpenViewMessage, type OpenableView } from '../space-open';
import { parseHandoffMessage, parseStateMessage, restoreMessage, type Handoff, type IncomingHandoff } from '../space-handoff';

/** Ask the space to show one of its tabs. `nonce` makes repeating the same tab count as a new request. */
export type SpaceTabRequest = { tab: string; nonce: number; /** Target space; defaults to the AI Control Tower. */ space?: string };

export default function SpaceViewer({
  space,
  tabRequest,
  bridge,
  bridgeEnabled = false,
  interviewDeps,
  customer360Deps,
  renewalsDeps,
  salesKnowledgeDeps,
  onOpenHiringTools,
  onAsk,
  textScale = DEFAULT_SPACE_SCALE,
  onTextScale,
  theme = 'light',
  prefs,
  onHandoff,
  onOpenView,
  onSpaceState,
  savedState,
  incoming,
  studioAgents,
  installedSpaces,
  onIncomingDelivered,
  onEditDesign,
  terms,
}: {
  space: Space;
  /** Opens the Space in the Designer (only given for Spaces made there). */
  onEditDesign?: () => void;
  tabRequest?: SpaceTabRequest | null;
  /** Connector calls for spaces that need them (Sub4Me tickets). */
  bridge?: BridgeCall;
  bridgeEnabled?: boolean;
  interviewDeps?: InterviewDeps;
  customer360Deps?: Customer360Deps;
  renewalsDeps?: RenewalsDeps;
  salesKnowledgeDeps?: SalesKnowledgeDeps;
  /** Hiring Approvals Space: open the proposals and criteria screen. */
  onOpenHiringTools?: () => void;
  /** A Space asks Joule a question ("Joule fragen"): the host opens the chat and sends it. */
  onAsk?: (prompt: string) => void;
  /** Text size of the page inside the frame (1 = as authored). */
  textScale?: SpaceScale;
  /** Shows a small slider in the header; the size applies to every Space (same setting as in Settings). */
  onTextScale?: (scale: SpaceScale) => void;
  /** The app's resolved theme; the Space follows it instead of the operating system. */
  theme?: 'light' | 'dark';
  /** Personal look (accent, font, contrast); optional. */
  prefs?: Preferences;
  /** The Space hands work to another Space (the host opens it). */
  onHandoff?: (handoff: Handoff) => void;
  /** The Space asks the app to open one of its own views (e.g. the Agent Studio). */
  onOpenView?: (view: OpenableView) => void;
  /** The Space reports its working state so it survives a trip to another Space. */
  onSpaceState?: (state: Record<string, unknown>) => void;
  savedState?: Record<string, unknown>;
  /** Work another Space handed to this one; delivered once the frame has loaded. */
  incoming?: IncomingHandoff[];
  /** Agents built in the Agent Studio; the AI Control Tower registers them as processes. */
  studioAgents?: unknown[];
  /** Slugs of the installed Spaces; only the AI Control Tower gets them (its tiles show which subspaces are missing). */
  installedSpaces?: string[];
  onIncomingDelivered?: () => void;
  /** Terms of the ontology marked in the page (act B); not given: no switch. */
  terms?: SpaceTermsControl;
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
    if ((space.slug !== 'ai-control-tower' && space.slug !== 'agent-registry') || !loaded.current || !studioAgents) return;
    frame.current?.contentWindow?.postMessage({ type: 'ct:studio-agents', agents: studioAgents }, '*');
  };
  const agentsKey = JSON.stringify(studioAgents ?? null);
  useEffect(postAgents, [agentsKey]);
  const postInstalled = () => {
    if (space.slug !== 'ai-control-tower' || !loaded.current || !installedSpaces) return;
    // Only slugs go over; the page checks their shape again and uses them to mark tiles.
    frame.current?.contentWindow?.postMessage({ type: 'ct:spaces', slugs: installedSpaces.slice(0, 200) }, '*');
  };
  const installedKey = JSON.stringify(installedSpaces ?? null);
  useEffect(postInstalled, [installedKey]);

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
  const openViewRef = useRef(onOpenView);
  openViewRef.current = onOpenView;
  const stateRef = useRef(onSpaceState);
  stateRef.current = onSpaceState;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const handoff = parseHandoffMessage(event.data);
      if (handoff) { handoffRef.current?.(handoff); return; }
      const openView = parseOpenViewMessage(event.data);
      if (openView) { openViewRef.current?.(openView); return; }
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
  const interviewRef = useRef(interviewDeps);
  interviewRef.current = interviewDeps;
  const c360Ref = useRef(customer360Deps);
  c360Ref.current = customer360Deps;
  const renewalsRef = useRef(renewalsDeps);
  renewalsRef.current = renewalsDeps;
  const salesKnRef = useRef(salesKnowledgeDeps);
  salesKnRef.current = salesKnowledgeDeps;
  useEffect(() => {
    if (!bridgeEnabled) return;
    const onMessage = (event: MessageEvent) => {
      // Only the frame of this space may talk to the bridge.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const handle = space.slug === CUSTOMER360_SPACE ? (data: unknown) => handleCustomer360Message(data, c360Ref.current ?? {})
        : space.slug === RENEWALS_SPACE ? (data: unknown) => handleRenewalsMessage(data, renewalsRef.current ?? {})
        : space.slug === INTERVIEW_SPACE ? (data: unknown) => handleInterviewMessage(data, interviewRef.current ?? {})
        : space.slug === PRD_SPACE ? handlePrdMessage
        : space.slug === SALES_SPACE ? async (data: unknown, call: BridgeCall | undefined) => (await handleSalesKnowledgeMessage(data, salesKnRef.current ?? {})) ?? handleSalesMessage(data, call)
        : space.slug === CONTROL_TOWER_BRIDGE_SPACE ? handleControlTowerForecastMessage
        : space.slug === PRECLOSE_SPACE ? async (data: unknown, call: BridgeCall | undefined) => (await handlePrecloseForecastMessage(data, call)) ?? handleDatabricksPrecloseMessage(data, call)
        : handleSub4meMessage;
      if (space.slug === OBSERVABILITY_SPACE) {
        // Read only, through the main process as the stored e-mail, never through the agent.
        const h = window.host;
        const host: ObservabilityHost | undefined = h?.observabilityCall ? { observe: h.observabilityCall } : undefined;
        void handleObservabilityMessage(event.data, host).then((reply) => { if (reply) frame.current?.contentWindow?.postMessage(reply, '*'); });
        return;
      }
      if (space.slug === MONITORING_SPACE || space.slug === SHADOW_SPACE) {
        // Live alerts are read by the main process with a login that stays there, never through the agent.
        const h = window.host;
        const host: MonitoringHost | undefined = h?.monitoringAlerts ? { alerts: h.monitoringAlerts, findings: h.monitoringFindings } : undefined;
        // The Orchestrator Space also writes and judges the shadow protocol, through the main process as the stored e-mail.
        const shadow: ShadowHost | undefined = space.slug === SHADOW_SPACE && h?.shadowStart ? { start: h.shadowStart, verdict: h.shadowVerdict, summary: h.shadowSummary } : undefined;
        void handleMonitoringMessage(event.data, host)
          .then((reply) => reply ?? (space.slug === SHADOW_SPACE ? handleShadowMessage(event.data, shadow) : null))
          .then((reply) => { if (reply) frame.current?.contentWindow?.postMessage(reply, '*'); });
        return;
      }
      if (space.slug === HOTLINE_SPACE) {
        // The confirmation mail is built and sent by the main process after its own dialog, never by the Space or the agent.
        const h = window.host;
        const host: HotlineMailHost | undefined = h?.hotlineMailPreview ? { preview: h.hotlineMailPreview, send: h.hotlineMailSend } : undefined;
        void handleHotlineMailMessage(event.data, host).then((reply) => { if (reply) frame.current?.contentWindow?.postMessage(reply, '*'); });
        return;
      }
      if (space.slug === ONBOARDING_SPACE) {
        // Reads, the handover and step status go through the main process as the stored e-mail, never through the agent.
        const h = window.host;
        const host: OnboardingHost | undefined = h?.onboardingList ? { list: h.onboardingList, handover: h.onboardingHandover, set: h.onboardingSet } : undefined;
        void handleOnboardingMessage(event.data, host).then((reply) => { if (reply) frame.current?.contentWindow?.postMessage(reply, '*'); });
        return;
      }
      if (space.slug === HIRING_SPACE) {
        // Reads and decisions go through the main process as the stored e-mail, never through the agent.
        const h = window.host;
        const host: HiringHost | undefined = h?.recruitingHireList && h.recruitingHireDecide ? { list: h.recruitingHireList, decide: h.recruitingHireDecide, release: h.recruitingHireRelease, handover: h.onboardingHandover } : undefined;
        void handleHiringMessage(event.data, host, onOpenHiringTools).then((reply) => { if (reply) frame.current?.contentWindow?.postMessage(reply, '*'); });
        return;
      }
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

  // Terms of the ontology: the page script (space-terms.ts) marks them and draws the card; the host sends the glossary and the switch.
  const termsRef = useRef(terms);
  termsRef.current = terms;
  const [termCount, setTermCount] = useState<number | null>(null);
  const knownTerms = useMemo(() => new Set((terms?.glossary?.entries ?? []).map((e) => e.key)), [terms?.glossary]);
  const knownTermsRef = useRef(knownTerms);
  knownTermsRef.current = knownTerms;
  const postTerms = () => {
    if (!loaded.current) return;
    const t = termsRef.current;
    const ready = Boolean(t?.on && t.state === 'ready' && t.glossary);
    if (ready && t?.glossary) frame.current?.contentWindow?.postMessage({ type: 'ot:glossary', entries: pageEntries(t.glossary.entries) }, '*');
    frame.current?.contentWindow?.postMessage({ type: 'ot:enable', on: ready }, '*');
    if (!ready) setTermCount(null);
  };
  useEffect(postTerms, [terms?.on, terms?.state, terms?.glossary]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data;
      if (data && data.type === 'ot:state') setTermCount(data.enabled === true && typeof data.count === 'number' ? data.count : null);
      const key = parseOpenTermMessage(data, knownTermsRef.current);
      if (key) termsRef.current?.onOpen(key);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

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

        <div className={`space-tools ${tools.filters.length >= 2 ? 'space-tools-wide' : ''}`} role="search">
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
          {terms && (
            <span className="space-terms">
              <button
                className={`ghost-btn ${terms.on ? 'ghost-btn-on' : ''}`}
                aria-pressed={terms.on}
                onClick={() => terms.onToggle(!terms.on)}
                title="Mark terms of the ontology in this Space and show their definition (off by default)"
              >
                Terms{terms.on && terms.state === 'ready' && termCount !== null ? ` · ${termCount}` : ''}
              </button>
              {terms.on && terms.state === 'loading' && <span className="space-count" role="status">Loading vocabulary…</span>}
              {terms.on && terms.state === 'unavailable' && <span className="space-count" role="status" title={terms.reason}>Vocabulary not available</span>}
              {terms.on && (
                <label className="space-terms-domain" title={`Terms stay on for every Space of the domain ${terms.domain}`}>
                  <input type="checkbox" checked={terms.domainOn} onChange={(event) => terms.onToggleDomain(event.target.checked)} /> all in {terms.domain}
                </label>
              )}
            </span>
          )}
        </div>

        {onTextScale && (
          <label className="space-zoom" title="Text size in all Spaces">
            <span aria-hidden="true" className="space-zoom-small">A</span>
            <input
              type="range"
              min={0}
              max={SPACE_SCALES.length - 1}
              step={1}
              value={Math.max(0, SPACE_SCALES.indexOf(textScale))}
              aria-label="Text size in all Spaces"
              aria-valuetext={`${Math.round(textScale * 100)}%`}
              onChange={(event) => onTextScale(SPACE_SCALES[Number(event.target.value)])}
            />
            <span aria-hidden="true" className="space-zoom-big">A</span>
            <span className="space-zoom-value" role="status">{Math.round(textScale * 100)}%</span>
          </label>
        )}

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
        {onEditDesign && <button className="ghost-btn" onClick={onEditDesign} title="Edit this Space in the Designer">Edit design</button>}
        {onAsk && (
          <button className="ghost-btn" onClick={() => onAsk(`Ich möchte den Space „${space.title}“ (${space.slug}) ändern. Frag mich kurz, was anders sein soll, und passe ihn danach an.`)} title="Open the chat and describe what should change in this Space">
            Change with Joule
          </button>
        )}
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
            postInstalled();
            postTerms();
            if (query) sendTools({ type: 'sp:search', query });
            if (filtersActive) sendTools({ type: 'sp:filter', filters: selected });
          }}
          key={`${space.slug}-${bust}-${html?.length ?? 0}-${textScale}-${theme}-${prefs ? `${prefs.accent}${prefs.font}${prefs.contrast}${prefs.reduceMotion}` : ''}`}
          className="space-frame"
          title={space.title}
          srcDoc={applySpaceScroll(applySpaceTools(applySpaceFit((() => { const themed = applySpaceTheme(html ?? '', theme); return applySpaceTerms(prefs ? applySpacePrefs(themed, prefs) : themed); })(), textScale)))}
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
