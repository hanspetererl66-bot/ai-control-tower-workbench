import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ToolCall } from '../acp';
import type { MessageAttachment } from '../attachments';
import type { Space } from '../spaces';
import { controlTowerViews, type ControlTowerView } from '../control-tower-views';

export type Message = {
  role: 'user' | 'agent';
  text: string;
  tools: ToolCall[];
  attachments?: MessageAttachment[];
  startedAt?: number;
  completedAt?: number;
  spaceResult?: Space;
};

export default function Chat({
  messages,
  busy,
  onOpenSpace,
  onOpenView,
}: {
  messages: Message[];
  busy: boolean;
  onOpenSpace: (slug: string) => void;
  onOpenView?: (view: ControlTowerView) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat">
      {messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className="msg-user">
            {m.attachments && m.attachments.length > 0 && (
              <div className="msg-attachments">
                {m.attachments.map((attachment, attachmentIndex) => (
                  <span key={`${attachment.name}-${attachmentIndex}`} className="msg-attachment">
                    <span aria-hidden="true">{attachment.kind === 'image' ? '▧' : '▤'}</span>
                    {attachment.name}
                  </span>
                ))}
              </div>
            )}
            {m.text && <span>{m.text}</span>}
          </div>
        ) : (
          <div key={i} className="msg-agent">
            {m.tools.length > 0 && (
              <TaskBlock
                tools={m.tools}
                startedAt={m.startedAt}
                completedAt={m.completedAt}
              />
            )}
            {m.spaceResult && <SpaceResultCard space={m.spaceResult} onOpen={onOpenSpace} />}
            {m.text ? (
              <>
                <div className="msg-text">
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
                {onOpenView && <ViewLinks tools={m.tools} onOpen={onOpenView} />}
                <MessageActions text={m.text} tools={m.tools} />
              </>
            ) : (
              busy && i === messages.length - 1 && <div className="thinking">··· Thinking…</div>
            )}
          </div>
        )
      )}
      <div ref={end} />
    </div>
  );
}

function TaskBlock({
  tools,
  startedAt,
  completedAt,
}: {
  tools: ToolCall[];
  startedAt?: number;
  completedAt?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (completedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [completedAt]);

  const completed = tools.filter((tool) => tool.status === 'completed').length;
  const elapsed = Math.max(0, (completedAt ?? now) - (startedAt ?? now));

  return (
    <div className={`task-block ${collapsed ? 'task-block-collapsed' : ''}`}>
      <button
        className="task-head"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span>Tasks ({completed}/{tools.length})</span>
        <span className="task-duration">{formatDuration(elapsed)}</span>
        <ChevronIcon />
      </button>
      {!collapsed && (
        <div className="task-list">
          {tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)}
        </div>
      )}
    </div>
  );
}

/** "Open in dashboard" buttons for Control Tower answers. Shown, not forced: the chat answer stays visible. */
function ViewLinks({ tools, onOpen }: { tools: ToolCall[]; onOpen: (view: ControlTowerView) => void }) {
  const views = controlTowerViews(tools);
  if (views.length === 0) return null;
  return (
    <div className="view-links">
      {views.map((view) => (
        <button key={view.tab} className="view-link" onClick={() => onOpen(view)}>
          Im Control Tower ansehen: {view.label} <span aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  );
}

function SpaceResultCard({ space, onOpen }: { space: Space; onOpen: (slug: string) => void }) {
  return (
    <button className="space-result" onClick={() => onOpen(space.slug)}>
      <SpaceResultIcon />
      <span className="space-result-title">{space.title}</span>
      <span className="space-result-count">
        {space.cardCount} card{space.cardCount === 1 ? '' : 's'}
      </span>
      <span className="space-result-arrow" aria-hidden="true">›</span>
    </button>
  );
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function ToolRow({ tool }: { tool: ToolCall }) {
  const args = tool.rawInput ? Object.entries(tool.rawInput) : [];
  return (
    <div className={`tool tool-${tool.status}`}>
      <span className="tool-state" aria-hidden="true">
        {tool.status === 'completed' ? '✓' : tool.status === 'failed' ? '!' : '·'}
      </span>
      <span className="tool-name">{tool.title}</span>
      {args.length > 0 && (
        <span className="tool-args">
          {args
            .slice(0, 4)
            .map(([k, v]) => `${k}=${typeof v === 'object' ? '…' : String(v)}`)
            .join('  ')}
        </span>
      )}
    </div>
  );
}

function MessageActions({ text, tools }: { text: string; tools: ToolCall[] }) {
  const [pinned, setPinned] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const links = [...new Set(text.match(/https?:\/\/[^\s)\]]+/g) ?? [])];
  const toolSources = tools
    .filter((tool) => tool.status === 'completed')
    .map((tool) => tool.title)
    .filter((title, index, values) => values.indexOf(title) === index);
  const sources = [...toolSources, ...links];

  return (
    <div className="message-actions">
      <button
        title="Copy response"
        aria-label="Copy response"
        onClick={() => navigator.clipboard?.writeText(text)}
      >
        <CopyIcon />
      </button>
      <button
        className={pinned ? 'message-action-on' : ''}
        title={pinned ? 'Unpin response' : 'Pin response'}
        aria-label={pinned ? 'Unpin response' : 'Pin response'}
        aria-pressed={pinned}
        onClick={() => setPinned((value) => !value)}
      >
        <PinIcon />
      </button>
      {sources.length > 0 && (
        <span className="sources-wrap">
          <button
            className={`sources-btn ${sourcesOpen ? 'message-action-on' : ''}`}
            title="Sources"
            aria-label={`${sources.length} sources`}
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((value) => !value)}
          >
            Sources <span>{sources.length}</span>
          </button>
          {sourcesOpen && (
            <span className="sources-popover">
              <strong>Sources</strong>
              {sources.map((source) => (
                <span key={source}>{source}</span>
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpaceResultIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M3 10V4.5C3 3.7 3.7 3 4.5 3H10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11.5 7.1c0 2.5-3.5 6-3.5 6s-3.5-3.5-3.5-6a3.5 3.5 0 1 1 7 0z" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="7" r="1.1" fill="currentColor" />
    </svg>
  );
}
