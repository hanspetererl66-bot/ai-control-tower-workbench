import { useEffect, useState } from 'react';
import type { Agent, SessionExtension } from '../acp';
import { formatFileSize, type ChatAttachment } from '../attachments';
import {
  applyExclusiveConnectorRequest,
  requestedConnectorIsAlreadyExclusive,
} from '../connector-selection';
import {
  INTEGRATION_MENU_ITEMS,
  connectorDisplayName,
  connectorDisplayOrder,
  isMicrosoft365Backend,
} from '../connector-presentation';
import { listSkills } from '../skills';
import {
  CONTROL_TOWER_CONNECTOR,
  hasControlTowerConnector,
  type StarterPrompt,
} from '../starter-prompts';
import StarterPrompts from './StarterPrompts';
import { PRODUCT_NAME } from '../product';

type Props = {
  onSend: (text: string, attachments: ChatAttachment[]) => void | Promise<void>;
  agent: Agent | null;
  busy: boolean;
  workdir: string;
  /** Owned by App: this component remounts when the layout switches out of the
   *  empty state, so local mode state would silently reset to the default. */
  mode: string;
  onModeChange: (id: string) => void;
  onCancel: () => void;
  onManageConnectors?: () => void;
  /** Stage the bundled AI Control Tower connector for installation. */
  onInstallConnector?: () => void;
  /** Show suggested Control Tower questions (empty chat only). */
  starters?: boolean;
};

export default function Composer({
  onSend,
  agent,
  busy,
  workdir,
  mode,
  onModeChange,
  onCancel,
  onManageConnectors,
  onInstallConnector,
  starters = false,
}: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [connectorError, setConnectorError] = useState('');
  const [preparingConnector, setPreparingConnector] = useState(false);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  // All connectors ever seen this session, plus which are currently active.
  // Removing one drops it from the session list, so we keep the config around
  // to be able to switch it back on.
  const [known, setKnown] = useState<SessionExtension[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  // True once the installed-connector list has been read, so the suggestions
  // don't flash "connector missing" while it is still loading.
  const [connectorsChecked, setConnectorsChecked] = useState(false);

  const refreshConnectors = async () => {
    if (!agent) return false;
    let installed: SessionExtension[] = [];
    let configuredReady = false;
    try {
      installed = (await agent.listExtensions())
        .filter(
          (extension) =>
            !extension.isPlatform &&
            extension.enabled &&
            !isMicrosoft365Backend(extension.configKey)
        )
        .map((extension) => ({
          name: extension.configKey,
          isPlatform: false,
          config: extension.config,
        }))
        .sort((a, b) => connectorDisplayOrder(a.name) - connectorDisplayOrder(b.name));
      configuredReady = true;
    } catch {
      // Session-scoped connectors still work if the global config API is not
      // available on an older agent build.
    }
    // Publish installed connectors before asking for session state. Some goose
    // builds can leave the unstable session-extension list pending while a
    // connector is starting; that must not turn the picker into a dead end.
    setKnown((prev) => {
      const merged = new Map(
        prev.filter((e) => !isMicrosoft365Backend(e.name)).map((e) => [e.name, e])
      );
      for (const e of installed) merged.set(e.name, e);
      return [...merged.values()].sort(
        (a, b) => connectorDisplayOrder(a.name) - connectorDisplayOrder(b.name)
      );
    });
    if (configuredReady) setConnectorsChecked(true);

    let live: SessionExtension[] = [];
    let sessionReady = false;
    try {
      live = await agent.listSessionExtensions();
      sessionReady = true;
    } catch {
      // A fresh or recently reconnected agent can expose global configuration
      // before its session-extension endpoint is ready. Installed connectors
      // remain visible and selectable in that state.
    }
    const usable = live
      .filter((e) => !e.isPlatform && !isMicrosoft365Backend(e.name))
      .sort((a, b) => connectorDisplayOrder(a.name) - connectorDisplayOrder(b.name));
    setKnown((prev) => {
      const merged = new Map(
        prev.filter((e) => !isMicrosoft365Backend(e.name)).map((e) => [e.name, e])
      );
      for (const e of usable) merged.set(e.name, e);
      return [...merged.values()].sort(
        (a, b) => connectorDisplayOrder(a.name) - connectorDisplayOrder(b.name)
      );
    });
    setActive(new Set(usable.map((e) => e.name)));
    return (configuredReady || sessionReady) && (installed.length > 0 || usable.length > 0);
  };

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async (attempt = 0) => {
      const found = await refreshConnectors();
      if (!disposed && !found && attempt < 20) {
        retryTimer = setTimeout(() => load(attempt + 1), 1_500);
      }
    };
    load();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  async function toggleConnector(e: SessionExtension) {
    const on = active.has(e.name);
    // Optimistic: the dropdown should feel instant.
    setActive((prev) => {
      const next = new Set(prev);
      on ? next.delete(e.name) : next.add(e.name);
      return next;
    });
    try {
      if (on) await agent!.removeSessionExtension(e.name);
      else await agent!.addSessionExtension(e.config);
    } catch {
      /* fall through to refresh, which restores the truth */
    }
    refreshConnectors();
  }

  useEffect(() => {
    listSkills().then(setSkills);
  }, []);

  // Type "/" at the start of an empty-ish line to pick an installed skill.
  // goose auto-discovers skills by description, but naming one explicitly is
  // far more reliable than hoping the model picks it.
  const slash = /^\/(\S*)$/.exec(text);
  const matches = slash
    ? skills.filter((s) => s.name.toLowerCase().includes(slash[1].toLowerCase())).slice(0, 8)
    : [];

  function pickSkill(name: string) {
    setText(`Use the ${name} skill to `);
  }


  /**
   * Send the typed message, or — for a suggested question — `override`, which
   * leaves whatever the person typed untouched. `override.connector` routes the
   * question to that connector exactly as typing "Use only <connector>" would,
   * without putting that instruction into the visible message.
   */
  async function submit(override?: { text: string; connector?: string }) {
    const t = override?.text ?? (text.trim() || (attachments.length ? 'Review the attached files and help me with them.' : ''));
    if (!t || busy || preparingConnector || !agent) return;
    const routing = override?.connector ? `Use only ${override.connector}` : t;
    setConnectorError('');
    setPreparingConnector(true);
    try {
      const selection = requestedConnectorIsAlreadyExclusive(routing, active)
        ? null
        : await applyExclusiveConnectorRequest(agent, routing);
      if (selection) {
        const configured = selection.configured
          .map((extension) => ({
            name: extension.configKey,
            isPlatform: false,
            config: extension.config,
          }))
          .filter((extension) => !isMicrosoft365Backend(extension.name))
          .sort((a, b) => connectorDisplayOrder(a.name) - connectorDisplayOrder(b.name));
        const activeConnectors = selection.active.filter(
          (extension) => !extension.isPlatform && !isMicrosoft365Backend(extension.name)
        );
        setKnown(configured);
        setActive(new Set(activeConnectors.map((extension) => extension.name)));
      }
    } catch (error: any) {
      setConnectorError(error?.message ?? String(error));
      setPreparingConnector(false);
      return;
    }

    setPreparingConnector(false);
    if (override) {
      void onSend(t, []);
      return;
    }
    void onSend(t, attachments);
    setText('');
    setAttachments([]);
    setAttachmentError('');
  }

  function pickStarter(starter: StarterPrompt) {
    void submit({ text: starter.prompt, connector: CONTROL_TOWER_CONNECTOR });
  }

  async function pickAttachments() {
    if (busy) return;
    setAttachmentError('');
    const result = await window.host?.pickChatFiles?.();
    if (!result) {
      setAttachmentError('File attachments are available in the Electron app.');
      return;
    }
    const merged = new Map(attachments.map((attachment) => [attachment.path, attachment]));
    for (const attachment of result.files) merged.set(attachment.path, attachment);
    const next = [...merged.values()];
    if (next.length > 8) {
      setAttachmentError('Attach at most 8 files at once.');
      setAttachments(next.slice(0, 8));
    } else {
      setAttachments(next);
      setAttachmentError(result.errors.join(' '));
    }
  }

  return (
    <div className="composer">
      {matches.length > 0 && (
        <div className="picker">
          {matches.map((s) => (
            <button key={s.name} className="picker-item" onClick={() => pickSkill(s.name)}>
              <span className="picker-name">/{s.name}</span>
              <span className="picker-desc">{s.description}</span>
            </button>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="attachment-list" aria-label="Attached files">
          {attachments.map((attachment) => (
            <div
              key={attachment.path}
              className={`attachment attachment-${attachment.kind}`}
              title={attachment.warning || attachment.path}
            >
              {attachment.kind === 'image' && attachment.imageData ? (
                <img
                  className="attachment-thumb"
                  src={`data:${attachment.mimeType};base64,${attachment.imageData}`}
                  alt=""
                />
              ) : (
                <span className="attachment-icon" aria-hidden="true">
                  {attachment.kind === 'presentation' ? 'P' : attachment.kind === 'document' ? 'W' : 'T'}
                </span>
              )}
              <span className="attachment-body">
                <span className="attachment-name">{attachment.name}</span>
                <span className="attachment-meta">
                  {attachment.kind} · {formatFileSize(attachment.size)}
                  {attachment.warning ? ' · extraction warning' : ''}
                </span>
              </span>
              <button
                className="attachment-remove"
                onClick={() =>
                  setAttachments((current) => current.filter((item) => item.path !== attachment.path))
                }
                title={`Remove ${attachment.name}`}
                aria-label={`Remove ${attachment.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        className="composer-input"
        placeholder={agent ? `Message ${PRODUCT_NAME}…` : 'Connecting…'}
        rows={1}
        autoFocus
        value={text}
        disabled={!agent || preparingConnector}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // While the skill picker is open, Enter takes the top match.
            if (matches.length > 0) pickSkill(matches[0].name);
            else submit();
          }
        }}
      />
      {(attachmentError || connectorError) && (
        <div className="attachment-error">{attachmentError || connectorError}</div>
      )}
      <div className="composer-bar">
        <button
          className="chip chip-icon"
          title="Add PowerPoint, Word, text, or picture files"
          aria-label="Attach files"
          onClick={pickAttachments}
          disabled={busy || preparingConnector}
        >
          +
        </button>

        <div className="chip-wrap">
          <button
            className={`chip chip-icon integrations-trigger ${integrationsOpen ? 'chip-on' : ''}`}
            title="Integrations"
            aria-label="Integrations"
            aria-expanded={integrationsOpen}
            onClick={() => {
              setIntegrationsOpen((value) => !value);
              setConnectorsOpen(false);
            }}
          >
            <IntegrationsIcon />
          </button>
          {integrationsOpen && (
            <div className="menu integration-menu" aria-label="Integrations menu">
              {INTEGRATION_MENU_ITEMS.map((item) => (
                <div
                  key={item.id}
                  className="integration-menu-item"
                >
                  <IntegrationItemIcon id={item.id} />
                  <span className="integration-menu-label">{item.label}</span>
                  {item.trailing === 'check' ? <CheckIcon /> : <ChevronRightIcon />}
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="chip" title={workdir}>
          <FolderIcon /> Default
        </button>

        <div className="chip-wrap">
          <button
            className={`chip ${connectorsOpen ? 'chip-on' : ''}`}
            onClick={() => {
              setConnectorsOpen((value) => !value);
              setIntegrationsOpen(false);
            }}
            title="Choose connectors for this conversation"
            aria-expanded={connectorsOpen}
            aria-busy={preparingConnector}
            disabled={preparingConnector}
          >
            <PlugIcon />{' '}
            {preparingConnector ? 'Selecting…' : connectorLabel(known, active)}
            {active.size > 0 && (
              <span
                className="online-dot"
                aria-label="MCP process online"
                title="MCP process connected; the downstream service login is checked on the first tool call."
              />
            )}
          </button>
          {connectorsOpen && (
            <div className="menu connector-menu">
              <div className="connector-menu-head">
                <span className="connector-menu-mark"><PlugIcon /></span>
                <span>
                  <strong>Connectors</strong>
                  <small title="MCP processes are connected; downstream service logins are checked on tool calls.">
                    <span className="online-dot" /> Online
                  </small>
                </span>
              </div>
              {known.length === 0 && <div className="menu-empty">No connectors configured.</div>}
              {known.map((item) => (
                <button key={item.name} className="menu-item connector-menu-item" onClick={() => toggleConnector(item)}>
                  <span className="connector-name">{connectorDisplayName(item.name)}</span>
                  {active.has(item.name) && (
                    <span
                      className="connector-online"
                      title="MCP process connected; downstream authentication is checked on the first tool call."
                    >
                      <span className="online-dot" /> Online
                    </span>
                  )}
                  {active.has(item.name) && <CheckIcon />}
                </button>
              ))}
              <div className="menu-sep" />
              <button
                className="menu-item menu-item-action"
                onClick={() => {
                  setConnectorsOpen(false);
                  onManageConnectors?.();
                }}
              >
                Manage Connectors
              </button>
            </div>
          )}
        </div>

        <label className="chip chip-select" title="Approval mode">
          <SlidersIcon />
          <select value={mode} onChange={(e) => onModeChange(e.target.value)} disabled={!agent}>
            {(agent?.modes ?? [{ id: 'auto', name: 'auto' }]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <span className="composer-spacer" />

        <button
          className={`send ${busy ? 'send-stop' : ''}`}
          onClick={busy ? onCancel : () => void submit()}
          disabled={
            !agent ||
            preparingConnector ||
            (!busy && !text.trim() && attachments.length === 0)
          }
          aria-busy={preparingConnector}
          title={busy ? 'Stop' : 'Send'}
          aria-label={busy ? 'Stop generating' : 'Send'}
        >
          {busy ? <StopIcon /> : <SendIcon />}
        </button>
      </div>
      {starters && (
        <StarterPrompts
          available={connectorsChecked ? hasControlTowerConnector(known.map((k) => k.name)) : null}
          disabled={busy || preparingConnector || !agent}
          onPick={pickStarter}
          onInstall={onInstallConnector}
          onManage={onManageConnectors}
        />
      )}
    </div>
  );
}

function connectorLabel(known: SessionExtension[], active: Set<string>) {
  if (active.size === 0) return 'No Connector';
  if (active.size === 1) {
    const name = known.find((item) => active.has(item.name))?.name;
    return name ? connectorDisplayName(name) : '1 Connector';
  }
  return `${active.size} Connectors`;
}

function SlidersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 5h9M13 5h1M2 11h3M7 11h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="11" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="menu-check" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3 8.5 3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="integration-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IntegrationsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M7.3 2.1 8.4 5l2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1L6.2 5z" fill="currentColor" />
      <path d="m11.8 8.5.6 1.7 1.7.6-1.7.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6zM3.2 9.7l.5 1.2 1.2.5-1.2.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="currentColor" opacity=".78" />
    </svg>
  );
}

type IntegrationItemId = (typeof INTEGRATION_MENU_ITEMS)[number]['id'];

function IntegrationItemIcon({ id }: { id: IntegrationItemId }) {
  if (id === 'model') {
    return (
      <svg className="integration-item-icon integration-item-icon-model" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7.1" fill="currentColor" opacity=".18" />
        <circle cx="10" cy="10" r="4.2" stroke="currentColor" strokeWidth="1.25" />
        <path d="m10 7.3.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" />
      </svg>
    );
  }
  if (id === 'web-search') {
    return (
      <svg className="integration-item-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2.5" y="3" width="11" height="12.5" rx="1.5" fill="currentColor" opacity=".16" />
        <rect x="5.8" y="6.2" width="11.5" height="10.7" rx="2" fill="currentColor" />
        <circle cx="11.5" cy="11.5" r="3.1" stroke="white" strokeWidth="1" />
        <path d="M8.6 11.5h5.8M11.5 8.4c1.4 1.6 1.4 4.6 0 6.2M11.5 8.4c-1.4 1.6-1.4 4.6 0 6.2" stroke="white" strokeWidth=".75" />
      </svg>
    );
  }
  if (id === 'work-email') {
    return (
      <svg className="integration-item-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="currentColor" opacity=".15" />
        <rect x="3.5" y="5.4" width="13" height="9.2" rx="1.5" stroke="currentColor" strokeWidth="1.45" />
        <path d="m4.4 6.5 5.6 4.2 5.6-4.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === 'charts') {
    return (
      <svg className="integration-item-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="11" width="3" height="6" rx=".7" fill="currentColor" opacity=".55" />
        <rect x="8.5" y="7.5" width="3" height="9.5" rx=".7" fill="currentColor" opacity=".78" />
        <rect x="14" y="3.5" width="3" height="13.5" rx=".7" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="integration-item-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="13" rx="2" fill="currentColor" opacity=".14" />
      <rect x="3.7" y="5.2" width="12.6" height="11.6" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.2 8.5h11.6M7 3.2v3.6M13 3.2v3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="6.2" y="10.3" width="2" height="2" rx=".3" fill="currentColor" />
      <rect x="9" y="10.3" width="2" height="2" rx=".3" fill="currentColor" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 4.2c0-.6.4-1 1-1h3l1.2 1.4h6.8c.6 0 1 .4 1 1v6.2c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.5" y="6.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 14 14 8 2 2l2.4 6z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" />
    </svg>
  );
}
