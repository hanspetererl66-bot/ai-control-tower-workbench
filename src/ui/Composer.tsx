import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Agent, SessionExtension } from '../acp';
import { MAX_CHAT_ATTACHMENTS, formatFileSize, isTableFile, type ChatAttachment } from '../attachments';
import { mailToAttachment, type MailHit, type MailMessage } from '../mail-pick';
import TableActions from './TableActions';
import {
  applyExclusiveConnectorRequest,
  requestedConnectorIsAlreadyExclusive,
} from '../connector-selection';
import {
  INTEGRATION_MENU_ITEMS,
  connectorDisplayOrder,
  isMicrosoft365Backend,
} from '../connector-presentation';
import { listSkills } from '../skills';
import SkillIcon from './SkillIcon';
import {
  hasControlTowerConnector,
  type StarterPrompt,
} from '../starter-prompts';
import ChatTabs from './ChatTabs';
import type { SkillLike, SpaceLike } from '../chat-tabs';
import type { Command } from '../chat-context';
import { MODEL_PROVIDERS } from '../web-search';
import { startRecording, type Recording, type VoiceSettings } from '../voice';

type Props = {
  /** Returning 'held' keeps the draft in the box: the message was not sent (the app asks something first). */
  onSend: (text: string, attachments: ChatAttachment[]) => void | Promise<void> | 'held';
  /** Install a Space file made from attached tables and open it. */
  onCreateTableSpace?: (file: File) => void | Promise<void>;
  agent: Agent | null;
  busy: boolean;
  /** Web Search switch of the current conversation. */
  webSearch?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  onCancel: () => void;
  /** Show suggested Control Tower questions (empty chat only). */
  starters?: boolean;
  /** Extra control for the bar under the input (the chat context switches). */
  contextSlot?: ReactNode;
  voice?: VoiceSettings;
  /** Opens the settings dialog (where the voice key is entered). */
  onOpenSettings?: () => void;
  /** Stop reading the reply aloud as soon as the user starts talking. */
  onStopSpeaking?: () => void;
  /** Spoken text that is a navigation command ("Zeig mir die Risiken"). Return true when handled. */
  onVoiceCommand?: (text: string) => boolean;
  /** Open a Space (and tab) from a briefing card. */
  onNavigate?: (target: { space: string; tab?: string }) => void;
  /** Own starter prompts and favourite skills from the settings. */
  ownStarters?: StarterPrompt[];
  favoriteStarters?: StarterPrompt[];
  /** Installed skills and Spaces, for the tabs Suggested and What's new. */
  catalogSkills?: SkillLike[];
  spaces?: SpaceLike[];
  /** Briefing cards and groups under the chat that are switched off. */
  hiddenBriefing?: string[];
  /** Slash commands (own and built-in): typing / lists them next to the skills. */
  commands?: Command[];
  /** Keep the typed text as an own starter prompt (the star button). */
  onSaveStarter?: (prompt: string) => void;
  /** Start a fresh conversation (the new-chat button). */
  onNewChat?: () => void;
  /** Mail this conversation (the @ button). Disabled while there is nothing to send. */
  onEmail?: () => void;
  canEmail?: boolean;
  /** Read the Gmail inbox for the "E-mail…" entry of the + menu: the newest mails (or a Gmail search) and one mail in full. Missing without the Gmail connector. */
  mail?: { search: (query: string) => Promise<MailHit[]>; read: (id: string) => Promise<MailMessage> };
  /** Why "E-mail…" is switched off (no agent, no Gmail connector). */
  mailHint?: string;
};

/** Whether the buttons under the input (Favorites, Suggested, …) are shown. */
const BUTTONS_KEY = 'werkbank.chatButtons';
/** Sources the person can name as context; the text goes into the message, the agent reads them with the connector. */
const CONTEXT_SOURCES = [
  { id: 'jira', label: 'Jira ticket', placeholder: 'Ticket key, e.g. ABC-123', prompt: (v: string) => `Read the Jira ticket ${v} first and use it as context. ` },
  { id: 'notion', label: 'Notion page', placeholder: 'Page title or link', prompt: (v: string) => `Read the Notion page "${v}" first and use it as context. ` },
  { id: 'slack', label: 'Slack thread', placeholder: 'Channel or search term', prompt: (v: string) => `Read the Slack thread about "${v}" first and use it as context. ` },
] as const;

export default function Composer({
  contextSlot,
  onEmail,
  canEmail,
  mail,
  mailHint,
  commands = [],
  onSend,
  onCreateTableSpace,
  agent,
  busy,
  webSearch = true,
  onWebSearchChange,
  onCancel,
  starters = false,
  ownStarters,
  favoriteStarters,
  catalogSkills,
  spaces,
  hiddenBriefing,
  onSaveStarter,
  onNewChat,
  voice,
  onOpenSettings,
  onStopSpeaking,
  onVoiceCommand,
  onNavigate,
}: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [micError, setMicError] = useState('');
  const recording = useRef<Recording | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => () => recording.current?.cancel(), []);

  async function toggleMic() {
    setMicError('');
    if (micState === 'transcribing') return;
    if (micState === 'recording') {
      const current = recording.current;
      recording.current = null;
      if (!current) return;
      setMicState('transcribing');
      try {
        const { audio, mimeType } = await current.stop();
        const result = await window.host?.voice?.transcribe(audio, mimeType);
        if (!result?.ok) throw new Error(result?.detail ?? 'Spracherkennung nicht verfügbar.');
        const heard = (result.text ?? '').trim();
        if (!heard) throw new Error('Nichts verstanden — bitte noch einmal sprechen.');
        if (onVoiceCommand?.(heard)) return;
        const combined = [textRef.current.trim(), heard].filter(Boolean).join(' ');
        if (voice?.autoSend) {
          setText('');
          void submit({ text: combined });
        } else {
          setText(combined);
        }
      } catch (error: any) {
        setMicError(error?.message ?? String(error));
      } finally {
        setMicState('idle');
      }
      return;
    }
    if (!voice?.hasKey) {
      setMicError('Für Spracheingabe zuerst den Deepgram-Key in den Einstellungen eintragen.');
      onOpenSettings?.();
      return;
    }
    try {
      onStopSpeaking?.();
      recording.current = await startRecording(() => void toggleMicRef.current());
      setMicState('recording');
    } catch (error: any) {
      setMicError(
        error?.name === 'NotAllowedError'
          ? 'Mikrofon nicht erlaubt — bitte in den Systemeinstellungen freigeben.'
          : error?.name === 'NotFoundError'
            ? 'Kein Mikrofon gefunden.'
            : (error?.message ?? String(error))
      );
    }
  }
  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;
  const [connectorError, setConnectorError] = useState('');
  const [preparingConnector, setPreparingConnector] = useState(false);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [sourcePick, setSourcePick] = useState<(typeof CONTEXT_SOURCES)[number]['id'] | null>(null);
  // The picker for a mail from the inbox (the "E-mail…" entry).
  const [mailOpen, setMailOpen] = useState(false);
  const [mailQuery, setMailQuery] = useState('');
  const [mailHits, setMailHits] = useState<MailHit[] | null>(null);
  const [mailBusy, setMailBusy] = useState<string>('');
  const [mailError, setMailError] = useState('');
  const mailSeq = useRef(0);
  const [sourceValue, setSourceValue] = useState('');
  const [buttonsShown, setButtonsShown] = useState<boolean>(() => {
    try { return window.localStorage.getItem(BUTTONS_KEY) !== 'off'; } catch { return true; }
  });
  const toggleButtons = () => {
    const next = !buttonsShown;
    setButtonsShown(next);
    try { window.localStorage.setItem(BUTTONS_KEY, next ? 'on' : 'off'); } catch { /* ignore */ }
  };

  /** Put the named source into the message as context for the agent. */
  function addSourceContext() {
    const source = CONTEXT_SOURCES.find((s) => s.id === sourcePick);
    const value = sourceValue.trim().slice(0, 200);
    if (!source || !value) return;
    setText((current) => `${source.prompt(value)}${current}`);
    setSourcePick(null);
    setSourceValue('');
    setContextOpen(false);
  }

  /** Loads the list of the mail picker: the newest mails of the inbox, or the result of a Gmail search. Late answers are dropped. */
  async function loadMails(query: string) {
    if (!mail) return;
    const run = ++mailSeq.current;
    setMailBusy('list');
    setMailError('');
    try {
      const hits = await mail.search(query);
      if (run === mailSeq.current) setMailHits(hits);
    } catch (error) {
      if (run === mailSeq.current) {
        setMailHits([]);
        setMailError(error instanceof Error ? error.message : 'The mails could not be read.');
      }
    } finally {
      if (run === mailSeq.current) setMailBusy('');
    }
  }

  async function openMail() {
    if (!mail) return;
    setSourcePick(null);
    setMailOpen(true);
    setMailQuery('');
    setMailHits(null);
    await loadMails('');
  }

  /** Reads the chosen mail and puts it into the chat as an attachment (the same list and limit as files). */
  async function takeMail(id: string) {
    if (!mail || mailBusy) return;
    setMailBusy(id);
    setMailError('');
    try {
      const message = await mail.read(id);
      mergeAttachments({ files: [mailToAttachment(message)], errors: [] });
      setMailOpen(false);
      setContextOpen(false);
    } catch (error) {
      setMailError(error instanceof Error ? error.message : 'The mail could not be read.');
    } finally {
      setMailBusy('');
    }
  }

  // The popovers close on Escape or a click anywhere outside them.
  useEffect(() => {
    if (!integrationsOpen && !contextOpen) return;
    const close = () => {
      setIntegrationsOpen(false);
      setContextOpen(false);
      setMailOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && target instanceof Element && target.closest('.chip-wrap')) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [integrationsOpen, contextOpen]);
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

  const cmdMatches = slash ? commands.filter((c) => c.name.includes(slash[1].toLowerCase())).slice(0, 8) : [];
  const exactCommand = slash ? commands.some((c) => c.name === slash[1].toLowerCase()) : false;
  const pickCommand = (name: string) => setText(`/${name} `);

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
    if (onSend(t, attachments) === 'held') return;
    setText('');
    setAttachments([]);
    setAttachmentError('');
  }

  async function pickAttachments() {
    if (busy) return;
    setAttachmentError('');
    const result = await window.host?.pickChatFiles?.();
    if (!result) {
      setAttachmentError('File attachments are available in the Electron app.');
      return;
    }
    mergeAttachments(result);
  }

  function mergeAttachments(result: { files: ChatAttachment[]; errors: string[] }) {
    const merged = new Map(attachments.map((attachment) => [attachment.path, attachment]));
    for (const attachment of result.files) merged.set(attachment.path, attachment);
    const next = [...merged.values()];
    if (next.length > MAX_CHAT_ATTACHMENTS) {
      setAttachmentError(`Attach at most ${MAX_CHAT_ATTACHMENTS} files at once.`);
      setAttachments(next.slice(0, MAX_CHAT_ATTACHMENTS));
    } else {
      setAttachments(next);
      setAttachmentError(result.errors.join(' '));
    }
  }

  /** Files dropped on the composer, up to the same limit as the dialog. */
  async function dropFiles(files: FileList) {
    if (busy || !window.host?.pathsOfDroppedFiles || !window.host.addChatFiles) return;
    const paths = window.host.pathsOfDroppedFiles(files);
    if (!paths.length) return;
    if (paths.length + attachments.length > MAX_CHAT_ATTACHMENTS) {
      setAttachmentError(`Attach at most ${MAX_CHAT_ATTACHMENTS} files at once.`);
      return;
    }
    setAttachmentError('');
    mergeAttachments(await window.host.addChatFiles(paths));
  }

  return (
    <div
      className={`composer ${dragging ? 'composer-drop' : ''}`}
      onDragOver={(event) => { if (event.dataTransfer?.types?.includes('Files')) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => { if (event.dataTransfer?.files?.length) { event.preventDefault(); setDragging(false); void dropFiles(event.dataTransfer.files); } }}
    >
      {(matches.length > 0 || cmdMatches.length > 0) && (
        <div className="picker">
          {cmdMatches.map((c) => (
            <button key={`cmd-${c.name}`} className="picker-item" onClick={() => pickCommand(c.name)}>
              <span className="picker-name">/{c.name}</span>
              <span className="picker-desc">Command · {c.prompt.replace(/\{[a-z]+\}/g, '').replace(/\s+/g, ' ').trim().slice(0, 100)}</span>
            </button>
          ))}
          {matches.map((s) => (
            <button key={s.name} className="picker-item" onClick={() => pickSkill(s.name)}>
              <span className="picker-name"><SkillIcon name={s.name} />/{s.name}</span>
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
                  {attachment.kind === 'presentation' ? 'P' : attachment.kind === 'document' ? 'W' : attachment.kind === 'table' || isTableFile(attachment.name) ? 'X' : 'T'}
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
        ref={inputRef}
        className="composer-input"
        placeholder={agent ? 'Text . . .' : 'Connecting…'}
        rows={1}
        autoFocus
        value={text}
        disabled={!agent || preparingConnector}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // While the skill picker is open, Enter takes the top match.
            if (exactCommand) submit();
            else if (cmdMatches.length > 0) pickCommand(cmdMatches[0].name);
            else if (matches.length > 0) pickSkill(matches[0].name);
            else submit();
          }
        }}
      />
      <TableActions attachments={attachments} onCreateSpace={onCreateTableSpace} />
      {(attachmentError || connectorError) && (
        <div className="attachment-error">{attachmentError || connectorError}</div>
      )}
      <div className="composer-bar">
        <div className="chip-wrap">
          <button
            className={`chip chip-icon ${contextOpen ? 'chip-on' : ''}`}
            data-tip="Add context: files, a Jira ticket, a Notion page or a Slack thread"
            aria-label="Add context"
            aria-expanded={contextOpen}
            onClick={() => {
              setContextOpen((value) => !value);
              setSourcePick(null);
              setMailOpen(false);
              setIntegrationsOpen(false);
                    }}
            disabled={busy || preparingConnector}
          >
            +
          </button>
          {contextOpen && (
            <div className="menu add-context-menu" aria-label="Add context menu">
              <button
                className="menu-item"
                title={`Add up to ${MAX_CHAT_ATTACHMENTS} files: PowerPoint, Word, Excel, CSV, text or pictures (or drop them here)`}
                onClick={() => { setContextOpen(false); void pickAttachments(); }}
              >
                Files…
              </button>
              <button
                className="menu-item"
                disabled={!mail}
                title={mail ? 'Take one mail from your Gmail inbox into the chat' : mailHint || 'Connect Gmail under Connectors & Skills'}
                onClick={() => { void openMail(); }}
              >
                E-mail…
              </button>
              {CONTEXT_SOURCES.map((source) => (
                <button key={source.id} className="menu-item" onClick={() => { setSourcePick(source.id); setSourceValue(''); setMailOpen(false); }}>
                  {source.label}
                </button>
              ))}
              {mailOpen && mail && (
                <div className="mail-pick" aria-label="Pick a mail">
                  <form className="context-form" onSubmit={(event) => { event.preventDefault(); void loadMails(mailQuery); }}>
                    <input
                      autoFocus
                      className="context-input"
                      aria-label="Search your mail"
                      placeholder="Search, e.g. from:anna newer_than:7d"
                      maxLength={200}
                      value={mailQuery}
                      onChange={(event) => setMailQuery(event.target.value)}
                    />
                    <button className="menu-item menu-item-action" type="submit" disabled={mailBusy === 'list'}>Search</button>
                  </form>
                  {mailError && <div className="mail-note mail-error" role="alert">{mailError}</div>}
                  {mailBusy === 'list' && <div className="mail-note">Loading mails…</div>}
                  {mailHits && mailHits.length === 0 && !mailBusy && !mailError && <div className="mail-note">No mails found.</div>}
                  <ul className="mail-list">
                    {(mailHits ?? []).map((hit) => (
                      <li key={hit.id}>
                        <button className="mail-hit" disabled={Boolean(mailBusy)} onClick={() => { void takeMail(hit.id); }}>
                          <span className="mail-head">
                            {hit.unread && <span className="mail-unread" aria-label="unread" title="unread" />}
                            <span className="mail-from">{hit.from || '(unknown sender)'}</span>
                            <span className="mail-date">{hit.date}</span>
                          </span>
                          <span className="mail-subject">{mailBusy === hit.id ? 'Adding…' : hit.subject}</span>
                          {hit.snippet && <span className="mail-snippet">{hit.snippet}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="mail-note">The mail text is sent to Joule&apos;s model provider, like an attached file.</div>
                </div>
              )}
              {sourcePick && (
                <form
                  className="context-form"
                  onSubmit={(event) => { event.preventDefault(); addSourceContext(); }}
                >
                  <input
                    autoFocus
                    className="context-input"
                    aria-label={CONTEXT_SOURCES.find((s) => s.id === sourcePick)?.label}
                    placeholder={CONTEXT_SOURCES.find((s) => s.id === sourcePick)?.placeholder}
                    value={sourceValue}
                    onChange={(event) => setSourceValue(event.target.value)}
                  />
                  <button className="menu-item menu-item-action" type="submit" disabled={!sourceValue.trim()}>Add</button>
                </form>
              )}
            </div>
          )}
        </div>

        {starters && (
          <button
            className={`chip chip-icon tabs-toggle ${buttonsShown ? 'tabs-toggle-shown' : 'tabs-toggle-hidden'}`}
            data-tip={buttonsShown ? 'Hide the buttons under the input' : 'Show the buttons under the input'}
            aria-label={buttonsShown ? 'Hide buttons' : 'Show buttons'}
            aria-pressed={buttonsShown}
            onClick={toggleButtons}
          >
            <TabsRowIcon open={buttonsShown} />
          </button>
        )}

        <button
          className="chip chip-icon"
          data-tip={agent ? 'Pick a skill (or type / in the input)' : 'Joule is not connected yet, so skills cannot be picked (is a model key set in .env?)'}
          aria-label="Pick a skill"
          aria-pressed={!!slash}
          onClick={() => {
            // Second click closes the menu again: the menu is open exactly while the text is "/word".
            setText((current) => (/^\/\S*$/.test(current) ? '' : current.startsWith('/') ? current : '/'));
            inputRef.current?.focus();
          }}
          disabled={!agent || busy || preparingConnector}
        >
          <SkillBoltIcon />
        </button>

        {contextSlot}

        {onSaveStarter && (
          <button
            className="chip chip-icon"
            data-tip="Keep this text as a favourite prompt"
            aria-label="Save as favourite prompt"
            onClick={() => { const t = text.trim(); if (t && !t.startsWith('/')) onSaveStarter(t); }}
            disabled={!text.trim() || text.trim().startsWith('/')}
          >
            <StarIcon />
          </button>
        )}

        {onNewChat && (
          <button
            className="chip chip-icon"
            data-tip="New conversation"
            aria-label="New conversation"
            onClick={onNewChat}
            disabled={busy}
          >
            <NewChatIcon />
          </button>
        )}

        {onEmail && (
          <button
            className="chip chip-icon"
            data-tip="E-mail this conversation (opens a new message with the conversation attached)"
            aria-label="E-mail this conversation"
            onClick={onEmail}
            disabled={!canEmail || busy}
          >
            <AtIcon />
          </button>
        )}

        <div className="chip-wrap">
          <button
            className={`chip chip-icon integrations-trigger ${integrationsOpen ? 'chip-on' : ''}`}
            data-tip={`Integrations · Web Search ${webSearch ? 'on' : 'off'}`}
            aria-label="Integrations"
            aria-expanded={integrationsOpen}
            onClick={() => {
              setIntegrationsOpen((value) => !value);
              setModelOpen(false);
                    }}
          >
            <IntegrationsIcon />
          </button>
          {integrationsOpen && (
            <div className="menu integration-menu" aria-label="Integrations menu">
              {INTEGRATION_MENU_ITEMS.map((item) =>
                item.id === 'model' ? (
                  <div key={item.id}>
                    <div
                      className="integration-menu-item"
                      role="menuitem"
                      aria-expanded={modelOpen}
                      tabIndex={0}
                      onClick={() => setModelOpen((open) => !open)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setModelOpen((open) => !open);
                      }}
                    >
                      <IntegrationItemIcon id={item.id} />
                      <span className="integration-menu-label">
                        Model
                        <small className="integration-menu-sub">OpenRouter{agent?.currentModel ? ` · ${agent.currentModel}` : ''}</small>
                      </span>
                      <ChevronRightIcon />
                    </div>
                    {modelOpen && (
                      <div className="integration-submenu" role="menu" aria-label="Model provider">
                        {MODEL_PROVIDERS.filter((provider) => provider.available).map((provider) => (
                          <div
                            key={provider.id}
                            className={`integration-sub-item ${provider.available ? '' : 'integration-sub-disabled'}`}
                            role="menuitemradio"
                            aria-checked={provider.available}
                            aria-disabled={!provider.available}
                            title={provider.available ? 'Active provider' : 'Not connected in this design study'}
                          >
                            <span className="integration-menu-label">
                              {provider.label}
                              {provider.available && agent?.currentModel && <small className="integration-menu-sub">{agent.currentModel}</small>}
                              {!provider.available && <small className="integration-menu-sub">not connected</small>}
                            </span>
                            {provider.available && <CheckIcon />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    key={item.id}
                    className="integration-menu-item"
                    role="menuitemcheckbox"
                    aria-checked={webSearch}
                    tabIndex={0}
                    title="Allow the assistant to search the web in this conversation"
                    onClick={() => onWebSearchChange?.(!webSearch)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onWebSearchChange?.(!webSearch);
                      }
                    }}
                  >
                    <IntegrationItemIcon id={item.id} />
                    <span className="integration-menu-label">
                      Web Search
                      <small className="integration-menu-sub">{webSearch ? 'On for this conversation' : 'Off for this conversation'}</small>
                    </span>
                    <span className={`switch ${webSearch ? 'switch-on' : ''}`} aria-hidden="true"><span className="switch-knob" /></span>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        <span className="composer-spacer" />

        {window.host?.voice && (
          <button
            className={`mic mic-${micState}`}
            onClick={() => void toggleMic()}
            disabled={!agent || busy || micState === 'transcribing'}
            aria-pressed={micState === 'recording'}
            aria-label={micState === 'recording' ? 'Aufnahme beenden' : 'Spracheingabe'}
            title={
              micState === 'recording'
                ? 'Aufnahme beenden'
                : micState === 'transcribing'
                  ? 'Wird erkannt …'
                  : 'Spracheingabe'
            }
          >
            {micState === 'transcribing' ? <span className="mic-spinner" aria-hidden="true" /> : <MicIcon />}
          </button>
        )}

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
      {(micState === 'recording' || micError) && (
        <p className={`mic-note ${micError ? 'mic-note-error' : ''}`} role={micError ? 'alert' : 'status'}>
          {micError || 'Ich höre zu … zum Beenden das Mikrofon erneut anklicken.'}
        </p>
      )}
      {starters && buttonsShown && (
        <ChatTabs
          disabled={busy || preparingConnector || !agent}
          canAsk={connectorsChecked && hasControlTowerConnector(known.map((k) => k.name))}
          hiddenBriefing={hiddenBriefing}
          own={ownStarters}
          favorites={favoriteStarters}
          skills={catalogSkills}
          spaces={spaces}
          onPrompt={(prompt) => void submit({ text: prompt })}
          onOpen={onNavigate}
          onAsk={(prompt, connector) => void submit({ text: prompt, connector })}
        />
      )}
    </div>
  );
}

/** Two long, slightly offset pills stand for the row of chat buttons under the input. Bright and fanned out while the buttons are hidden (a click brings them back); greyed and pushed together while they are shown. */
function TabsRowIcon({ open }: { open: boolean }) {
  return (
    <span className={`tabs-pills ${open ? 'tabs-pills-shown' : ''}`} aria-hidden="true">
      <span className="tabs-pill tabs-pill-back" />
      <span className="tabs-pill tabs-pill-front" />
    </span>
  );
}

function SkillBoltIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 1.8 3.6 9h3.8L7 14.2 12.4 7H8.6z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.5l-3.8 2.1.7-4.3-3.1-3 4.3-.6z" />
    </svg>
  );
}

function AtIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" />
      <path d="M10.4 8v1.3c0 1 .8 1.7 1.7 1.7 1 0 1.7-.9 1.7-2.1V8a5.8 5.8 0 1 0-2.3 4.6" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 9v3.2c0 .7-.6 1.3-1.3 1.3H3.8c-.7 0-1.3-.6-1.3-1.3V3.8c0-.7.6-1.3 1.3-1.3H7M11.5 2.2l2.3 2.3-4.8 4.8-2.7.4.4-2.7z" />
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
  return null;
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
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
