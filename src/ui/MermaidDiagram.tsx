import { useEffect, useId, useState } from 'react';
import { diagramKind, shouldDraw } from '../mermaid-diagram';

type Drawn = { svg: string } | { error: string } | null;

/** Reads the app's colour tokens so the diagram follows light and dark. Falls back to neutral values if a token is missing. */
function themeVariables(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const ink = get('--ink', '#1c1c1e');
  const panel = get('--panel', '#ffffff');
  const line = get('--line', '#e6e6ec');
  const accent = get('--accent', '#6d28d9');
  return {
    background: panel,
    primaryColor: panel,
    primaryTextColor: ink,
    primaryBorderColor: accent,
    lineColor: get('--muted', '#6b7280'),
    secondaryColor: line,
    tertiaryColor: panel,
    textColor: ink,
    fontFamily: 'inherit',
  };
}

/**
 * One diagram from a ```mermaid block. Drawn after a short pause (the agent's text arrives piece by piece), with Mermaid's
 * strict security level. If the text cannot be drawn, the source stays visible so nothing is lost.
 */
export function MermaidDiagram({ source }: { source: string }) {
  const id = 'mmd' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const [drawn, setDrawn] = useState<Drawn>(null);
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const kind = diagramKind(source);
  const drawable = shouldDraw(source);

  useEffect(() => {
    if (!drawable) {
      setDrawn({ error: 'This kind of diagram is not drawn here.' });
      return;
    }
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: themeVariables() });
        const { svg } = await mermaid.render(id, source);
        if (live) setDrawn({ svg });
      } catch (e) {
        if (live) setDrawn({ error: e instanceof Error ? e.message.split('\n')[0] : 'The diagram could not be drawn.' });
      }
    }, 500);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [source, drawable, id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available: the source is shown via "Show source" */
    }
  };

  const failed = drawn !== null && 'error' in drawn;
  return (
    <figure className="mermaid-diagram" aria-label={kind ?? 'Diagram'}>
      <figcaption>
        <span>{kind ?? 'Diagram'}</span>
        <span className="mermaid-actions">
          <button type="button" className="link-btn" onClick={() => setShowSource((v) => !v)} aria-pressed={showSource}>
            {showSource || failed ? 'Hide source' : 'Show source'}
          </button>
          <button type="button" className="link-btn" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy source'}
          </button>
        </span>
      </figcaption>
      {drawn === null && <div className="mermaid-pending">Drawing the diagram…</div>}
      {drawn !== null && 'svg' in drawn && <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: drawn.svg }} />}
      {failed && <div className="mermaid-error" role="status">{(drawn as { error: string }).error} The source is shown below.</div>}
      {(showSource || failed) && <pre className="mermaid-source"><code>{source}</code></pre>}
    </figure>
  );
}
