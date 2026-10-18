import { useEffect, useRef, useState } from 'react';
import { fetchSpaceHtml, relativeTime, type Space } from '../spaces';

/** Ask the space to show one of its tabs. `nonce` makes repeating the same tab count as a new request. */
export type SpaceTabRequest = { tab: string; nonce: number };

export default function SpaceViewer({ space, tabRequest }: { space: Space; tabRequest?: SpaceTabRequest | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);
  const postTab = () => {
    if (!tabRequest || !loaded.current) return;
    // The frame has an opaque origin, so '*' is the only possible target; the
    // message carries a tab id and nothing else.
    frame.current?.contentWindow?.postMessage({ type: 'ct:open-tab', tab: tabRequest.tab }, '*');
  };
  useEffect(postTab, [tabRequest?.tab, tabRequest?.nonce]);

  const [bust, setBust] = useState(space.updatedAt);
  const [insightsOpen, setInsightsOpen] = useState(false);
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
          <h1 className="topbar-title">{space.title}</h1>
          <span className="topbar-sub">Updated {relativeTime(space.updatedAt)}</span>
        </div>

        <button
          className={`ghost-btn ${insightsOpen ? 'ghost-btn-on' : ''}`}
          onClick={() => setInsightsOpen((v) => !v)}
          disabled={space.insights.length === 0}
          title={space.insights.length ? 'Insights' : 'No insights recorded for this space'}
        >
          <BulbIcon /> Insights
        </button>
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
            loaded.current = true;
            postTab();
          }}
          key={`${space.slug}-${bust}-${html?.length ?? 0}`}
          className="space-frame"
          title={space.title}
          srcDoc={html ?? ''}
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
