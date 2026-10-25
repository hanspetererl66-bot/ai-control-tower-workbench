import { useEffect, useRef, useState } from 'react';
import { ChatMarkdown } from './ChatMarkdown';
import type { ToolCall } from '../acp';
import type { MessageAttachment } from '../attachments';
import type { Space } from '../spaces';
import { controlTowerViews, type ControlTowerView } from '../control-tower-views';
import { collectSources, sourceSummary, type Source } from '../chat-sources';
import { followUps, isGerman } from '../follow-ups';
import { exportAnswer } from '../export-answer-html';
import { privacySummary, type PrivacyInfo } from '../privacy-bar';
import { compact, estimateUsage, euro } from '../usage';
import type { ChatTools } from '../preferences';
import { ReplySpeaker } from '../voice';

export type Message = {
  role: 'user' | 'agent';
  text: string;
  tools: ToolCall[];
  attachments?: MessageAttachment[];
  startedAt?: number;
  completedAt?: number;
  spaceResult?: Space;
};

export type ChatMeta = { privacy: PrivacyInfo; title: string };

export default function Chat({
  messages,
  busy,
  onOpenSpace,
  onOpenView,
  onAsk,
  onSaveAsSpace,
  chatTools,
  meta,
}: {
  messages: Message[];
  busy: boolean;
  onOpenSpace: (slug: string) => void;
  onOpenView?: (view: ControlTowerView) => void;
  /** Send a follow-up question as the person's next message. */
  onAsk?: (text: string) => void;
  /** Turn the answer at this index into a Space. */
  onSaveAsSpace?: (index: number) => void;
  chatTools?: ChatTools;
  meta?: ChatMeta;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat">
      {chatTools && meta && (chatTools.privacyBar || chatTools.usage) && messages.length > 0 && <MetaStrip tools={chatTools} meta={meta} messages={messages} />}
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
                <ChatMarkdown text={m.text} />
                {onOpenView && <ViewLinks tools={m.tools} onOpen={onOpenView} />}
                <MessageActions
                  text={m.text}
                  tools={m.tools}
                  title={meta?.title || 'Answer'}
                  canSave={Boolean(onSaveAsSpace) && !busy}
                  onSave={() => onSaveAsSpace?.(i)}
                  listen={Boolean(chatTools?.readAloud)}
                />
                <SourcesBar sources={collectSources(m.tools, m.text)} />
                {onAsk && !busy && i === messages.length - 1 && (
                  <div className="follow-ups" role="group" aria-label="Suggested follow-up questions">
                    {followUps(m.text, m.tools).map((q) => (
                      <button key={q} className="follow-up" onClick={() => onAsk(q)}>{q}</button>
                    ))}
                  </div>
                )}
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

let reader: ReplySpeaker | null = null;

function MessageActions({
  text,
  tools,
  title,
  canSave,
  onSave,
  listen,
}: {
  text: string;
  tools: ToolCall[];
  title: string;
  canSave: boolean;
  onSave: () => void;
  listen: boolean;
}) {
  const [pinned, setPinned] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const sources = collectSources(tools, text).map((s) => (s.url ? s.url : s.detail ? `${s.label}: ${s.detail}` : s.label));

  function toggleListen() {
    if (speaking) {
      reader?.stop();
      setSpeaking(false);
      return;
    }
    reader?.stop();
    reader = new ReplySpeaker(isGerman(text) ? 'de' : 'en');
    reader.feed(text);
    reader.finish();
    setSpeaking(true);
    window.setTimeout(() => setSpeaking(false), Math.min(10 * 60_000, text.length * 70));
  }

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
      <button className="text-action" title="Turn this answer into a Space" disabled={!canSave} onClick={onSave}>
        Save as Space
      </button>
      <span className="sources-wrap">
        <button
          className={`text-action ${exportOpen ? 'message-action-on' : ''}`}
          title="Export this answer"
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          onClick={() => setExportOpen((value) => !value)}
        >
          Export ▾
        </button>
        {exportOpen && (
          <span className="sources-popover export-menu" role="menu">
            {([['md', 'Markdown (.md)'], ['word', 'Word (.doc)'], ['pdf', 'PDF (print dialog)']] as const).map(([kind, label]) => (
              <button
                key={kind}
                role="menuitem"
                onClick={() => {
                  setExportOpen(false);
                  exportAnswer(kind, title, text, sources);
                }}
              >
                {label}
              </button>
            ))}
          </span>
        )}
      </span>
      {listen && (
        <button
          className={`text-action ${speaking ? 'message-action-on' : ''}`}
          aria-pressed={speaking}
          title={speaking ? 'Stop reading aloud' : 'Read this answer aloud'}
          onClick={toggleListen}
        >
          {speaking ? '■ Stop' : '▶ Listen'}
        </button>
      )}
    </div>
  );
}

/** Where the answer comes from, shown under every answer: connectors, web pages and files. */
function SourcesBar({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  const icon = (kind: Source['kind']) => (kind === 'connector' ? '⛁' : kind === 'web' ? '↗' : '▤');
  return (
    <div className="sources-bar">
      <button className="sources-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> Sources · {sourceSummary(sources)}
      </button>
      {open && (
        <ul className="sources-list">
          {sources.map((source) => (
            <li key={`${source.kind}-${source.label}-${source.url ?? ''}`}>
              <span className={`src-kind src-${source.kind}`} aria-hidden="true">{icon(source.kind)}</span>
              {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : <b>{source.label}</b>}
              {source.detail && <small>{source.detail}</small>}
              {source.kind === 'connector' && <em>from the connector, not from the web</em>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Privacy and usage strip at the top of the chat. Each part is a switch under Individualisierung → Assistant. */
function MetaStrip({ tools, meta, messages }: { tools: ChatTools; meta: ChatMeta; messages: Message[] }) {
  const p = privacySummary(meta.privacy);
  const u = estimateUsage(messages, tools.priceInPerM, tools.priceOutPerM);
  return (
    <div className="chat-meta" role="status">
      {tools.privacyBar && (
        <div className="meta-privacy" title={p.connectors}>
          <span className={`meta-dot ${meta.privacy.webSearch ? 'meta-dot-warn' : 'meta-dot-ok'}`} aria-hidden="true" />
          <b>Privacy</b> {p.web} · {p.connectors.split(':')[0]} · {p.actions} · {p.model}
        </div>
      )}
      {tools.usage && (
        <div className="meta-usage" title="Estimate: about four characters per token. The provider's invoice counts.">
          <b>Usage</b> ≈ {compact(u.inTokens)} tokens in · {compact(u.outTokens)} out{u.eur !== null ? ` · ≈ ${euro(u.eur)}` : ' · set the price per million tokens to see a cost'}
        </div>
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
