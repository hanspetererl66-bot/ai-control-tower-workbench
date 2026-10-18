import { useCallback, useEffect, useRef, useState } from 'react';
import { connect, type Agent, type PermissionRequest, type ToolCall } from './acp';
import {
  readAppearance,
  resolveAppearance,
  writeAppearance,
  type AppearancePreference,
} from './appearance';
import type { ChatAttachment } from './attachments';
import {
  archiveConversation as archiveConversationState,
  deleteConversation as deleteConversationState,
  createConversation,
  loadConversationState,
  restoreConversation as restoreConversationState,
  saveConversationState,
} from './conversations';
import { dataGroundingContext } from './data-grounding';
import { isM365MeetingPrepPrompt, runM365MeetingPrep } from './m365-meeting-prep';
import { wantsSpace } from './space-intent';
import { listSpaces, SPACE_BRIEF, type Space } from './spaces';
import Chat, { type Message } from './ui/Chat';
import Composer from './ui/Composer';
import ConversationList from './ui/ConversationList';
import ManageView from './ui/ManageView';
import DetailsPanel, { type GeneratedFile } from './ui/DetailsPanel';
import PermissionDialog from './ui/PermissionDialog';
import Rail, { type View } from './ui/Rail';
import SkillInstallDialog, { type InstallRequest } from './ui/SkillInstallDialog';
import SettingsDialog from './ui/SettingsDialog';
import SpacesList from './ui/SpacesList';
import { loadSpaceOrder, moveSpace, nudgeSpace, orderSpaces, saveSpaceOrder } from './space-order';
import { SUB4ME_EXTENSION, SUB4ME_SPACE } from './sub4me-bridge';
import SpaceViewer, { type SpaceTabRequest } from './ui/SpaceViewer';
import WerkbankMark from './ui/WerkbankMark';
import { PRODUCT_NAME } from './product';
import CoverSheet from './ui/CoverSheet';

const WORKDIR = window.host?.workspacePath ?? '';

/** Tools whose `locations` represent something the agent produced, not merely read. */
const WRITES = /^(write|edit|patch|create|str_replace|text_editor)/i;
const AGENT_RESPONSE_TIMEOUT_MS = 5 * 60_000;

/** Cheap intent check — a wrong guess costs one extra paragraph in the prompt. */
const WANTS_PRESENTATION = /\b(powerpoint|pptx|slide deck|presentation|slides?)\b/i;
const WANTS_MEETING_DOCUMENT = /\b(fill|complete|create|save|word|docx|document|meeting brief)\b/i;
const SHIPMENT_WORKFLOW = /\b(customer shipment defects?|shipment defects?|returns?\.csv)\b/i;

export default function App() {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentEpoch, setAgentEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conversationState, setConversationState] = useState(() =>
    loadConversationState(window.localStorage)
  );
  const selectedConversation =
    conversationState.items.find((conversation) => conversation.id === conversationState.selectedId) ??
    conversationState.items[0];
  const messages = selectedConversation?.messages ?? [];
  const title = selectedConversation?.title ?? 'New Conversation';
  const files = selectedConversation?.files ?? [];
  const setMessages = useCallback(
    (update: Message[] | ((previous: Message[]) => Message[])) => {
      setConversationState((state) => ({
        ...state,
        items: state.items.map((conversation) =>
          conversation.id === state.selectedId
            ? {
                ...conversation,
                messages:
                  typeof update === 'function' ? update(conversation.messages) : update,
                updatedAt: Date.now(),
              }
            : conversation
        ),
      }));
    },
    []
  );
  const setTitle = useCallback((update: string | ((previous: string) => string)) => {
    setConversationState((state) => ({
      ...state,
      items: state.items.map((conversation) =>
        conversation.id === state.selectedId
          ? {
              ...conversation,
              title: typeof update === 'function' ? update(conversation.title) : update,
              updatedAt: Date.now(),
            }
          : conversation
      ),
    }));
  }, []);
  const setFiles = useCallback(
    (update: GeneratedFile[] | ((previous: GeneratedFile[]) => GeneratedFile[])) => {
      setConversationState((state) => ({
        ...state,
        items: state.items.map((conversation) =>
          conversation.id === state.selectedId
            ? {
                ...conversation,
                files: typeof update === 'function' ? update(conversation.files) : update,
                updatedAt: Date.now(),
              }
            : conversation
        ),
      }));
    },
    []
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [mode, setMode] = useState('auto');
  const [view, setView] = useState<View>('chat');
  const [skillRequest, setSkillRequest] = useState<InstallRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceOrder, setSpaceOrder] = useState<string[]>(() => loadSpaceOrder(window.localStorage));
  const [selectedSpace, setSelectedSpace] = useState<string | null>(null);
  const [spaceTab, setSpaceTab] = useState<SpaceTabRequest | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearance, setAppearance] = useState<AppearancePreference>(() =>
    readAppearance(window.localStorage)
  );
  const [systemUsesDark, setSystemUsesDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const resolvedTheme = resolveAppearance(appearance, systemUsesDark);

  // Streaming lands in these before React sees it, so a fast token burst can't
  // drop chunks between renders.
  const draft = useRef('');
  const tools = useRef<ToolCall[]>([]);
  // tool id -> toolName, so an out-of-order update can still tell a write from a read.
  const toolNames = useRef(new Map<string, string>());
  const paths = useRef(new Set<string>());
  const resolvePermission = useRef<((optionId: string) => void) | null>(null);
  const cancelledByUser = useRef(false);
  const lastGroundedCsvPath = useRef<string | null>(null);
  const lastGroundedCsvName = useRef<string | null>(null);
  const needsHistoryGrounding = useRef(Boolean(selectedConversation?.messages.length));

  const flush = useCallback(() => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'agent') {
        next[next.length - 1] = { ...last, text: draft.current, tools: [...tools.current] };
      }
      return next;
    });
  }, []);

  const refreshSpaces = useCallback(async () => {
    const next = await listSpaces();
    setSpaces(next);
    setSelectedSpace((cur) =>
      cur && next.some((space) => space.slug === cur) ? cur : next[0]?.slug ?? null
    );
    return next;
  }, []);

  useEffect(() => {
    refreshSpaces();
  }, [refreshSpaces]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemUsesDark(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    writeAppearance(appearance, window.localStorage);
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [appearance, resolvedTheme]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => saveConversationState(window.localStorage, conversationState),
      200
    );
    return () => window.clearTimeout(timer);
  }, [conversationState]);

  // Install deep links. main.mjs has already
  // validated and parsed these; nothing raw from the URL reaches here.
  useEffect(() => {
    const offRequest = window.host?.onSkillInstallRequest?.((p) =>
      setSkillRequest(p as unknown as InstallRequest)
    );
    const offResult = window.host?.onSkillInstallResult?.(async ({ kind, name, ok, detail }) => {
      if (!ok) {
        setToast(`Could not install “${name}”: ${detail}`);
        setTimeout(() => setToast(null), 6000);
        return;
      }

      if (kind === 'mcp') {
        setToast(`Installed connector “${name}” — restarting agent…`);
        const restarted = await window.host?.restartAgent?.();
        if (restarted && !restarted.ok) {
          setToast(`Installed “${name}”, but restart failed: ${restarted.detail ?? 'unknown error'}`);
        } else {
          reconnectAgent();
          setToast(`Installed connector “${name}” — connected.`);
        }
      } else {
        setToast(`Installed skill “${name}”`);
      }
      setTimeout(() => setToast(null), 6000);
    });
    return () => {
      offRequest?.();
      offResult?.();
    };
  }, []);

  const recordFiles = useCallback((id: string, tc: Partial<ToolCall>) => {
    const name = tc.toolName ?? toolNames.current.get(id) ?? '';
    if (!WRITES.test(name) || !tc.locations?.length) return;
    let added = false;
    for (const loc of tc.locations) {
      if (loc.path && !paths.current.has(loc.path)) {
        paths.current.add(loc.path);
        added = true;
      }
    }
    if (added) {
      setFiles([...paths.current].map((path) => ({ path })));
      setDetailsOpen(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // Falls back so the renderer also runs in a plain browser tab against a
    // separately-started `goose serve`.
    const handlers = {
      onChunk: (t: string) => {
        draft.current += t;
        flush();
      },
      onToolCall: (tc: ToolCall) => {
        if (tc.toolName) toolNames.current.set(tc.id, tc.toolName);
        tools.current = [...tools.current, tc];
        recordFiles(tc.id, tc);
        flush();
      },
      onToolUpdate: (id: string, patch: Partial<ToolCall>) => {
        tools.current = tools.current.map((t) => (t.id === id ? { ...t, ...patch } : t));
        recordFiles(id, patch);
        flush();
      },
      onPermission: (req: PermissionRequest) =>
        new Promise<string>((resolve) => {
          resolvePermission.current = resolve;
          setPermission(req);
        }),
    };

    async function open(attempt = 0) {
      try {
        const nextAgent = await connect(
          window.host?.gooseUrl ?? 'http://127.0.0.1:3299',
          WORKDIR,
          handlers
        );
        if (cancelled) return;
        setAgent(nextAgent);
        setMode(nextAgent.currentMode);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        if (attempt < 20) {
          retryTimer = setTimeout(() => open(attempt + 1), 500);
        } else {
          setError(e?.message ?? String(e));
        }
      }
    }

    open();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [flush, recordFiles, agentEpoch]);

  function reconnectAgent() {
    setAgent(null);
    setAgentEpoch((current) => current + 1);
  }

  async function send(text: string, attachments: ChatAttachment[] = []) {
    if (!agent || busy) return;
    cancelledByUser.current = false;
    const startedAt = Date.now();
    const previousSpaces = new Map(spaces.map((space) => [space.slug, space.updatedAt]));
    if (messages.length === 0) {
      setTitle((text || attachments[0]?.name || 'New Conversation').slice(0, 48));
    }
    draft.current = '';
    tools.current = [];
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        text,
        tools: [],
        attachments: attachments.map(({ name, kind, mimeType }) => ({ name, kind, mimeType })),
      },
      { role: 'agent', text: '', tools: [], startedAt },
    ]);
    setBusy(true);
    try {
      const spaceRequested = wantsSpace(text);
      const grounding = dataGroundingContext(attachments);
      const existingSpace = spaceRequested
        ? spaces.find((space) => text.toLocaleLowerCase().includes(space.title.toLocaleLowerCase()))
        : undefined;
      const spaceTarget = existingSpace
        ? `SPACE UPDATE TARGET — an existing Space with this exact title is stored at spaces/${existingSpace.slug}/. Update that folder in place; do not create a duplicate Space.`
        : '';
      const historyGrounding = needsHistoryGrounding.current
        ? `CONVERSATION BOUNDARY — ignore messages from other conversations in the agent session. Continue using only the visible conversation history below.\n\n${messages
            .slice(-10)
            .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`)
            .join('\n\n')
            .slice(-12_000)}`
        : '';
      const prompt = [historyGrounding, text, grounding, spaceTarget, spaceRequested ? SPACE_BRIEF : '']
        .filter(Boolean)
        .join('\n\n---\n');
      const attachedCsv = attachments.find((attachment) => attachment.name.toLowerCase().endsWith('.csv'));
      const attachedWord = attachments.find((attachment) => attachment.name.toLowerCase().endsWith('.docx'));
      if (attachedCsv) {
        lastGroundedCsvPath.current = attachedCsv.path;
        lastGroundedCsvName.current = attachedCsv.name;
      }
      const localType =
        attachedCsv && spaceRequested && SHIPMENT_WORKFLOW.test(`${text} ${attachedCsv.name}`)
          ? 'data-space'
          : WANTS_PRESENTATION.test(text) && SHIPMENT_WORKFLOW.test(text) && lastGroundedCsvPath.current
            ? 'shipment-deck'
            : attachedWord && /meeting brief/i.test(`${text} ${attachedWord.name}`) && WANTS_MEETING_DOCUMENT.test(text)
              ? 'meeting-brief-doc'
            : null;
      const priorAgentMessages = [...messages]
        .reverse()
        .filter((message) => message.role === 'agent' && message.text.trim());
      const priorMeetingContext =
        priorAgentMessages.find(
          (message) =>
            /\bmeeting logistics\b/i.test(message.text) &&
            /\brelationship history\b/i.test(message.text) &&
            /\bquestions? to raise\b/i.test(message.text)
        )?.text ?? priorAgentMessages[0]?.text ?? '';
      const localResult = localType
        ? await window.host?.runLocalWorkflow?.({
            type: localType,
            csvPath: attachedCsv?.path ?? lastGroundedCsvPath.current ?? undefined,
            templatePath: attachedWord?.path,
            sourceText: localType === 'meeting-brief-doc' ? priorMeetingContext : undefined,
            sourceName: attachedCsv?.name ?? lastGroundedCsvName.current ?? undefined,
            title: existingSpace?.title ?? 'Customer Shipment Defects — Board Insights',
            prompt: text,
            spaceSlug: existingSpace?.slug,
          })
        : null;

      if (isM365MeetingPrepPrompt(text)) {
        draft.current = await runM365MeetingPrep(agent, text, {
          started: (id, taskTitle, toolName, rawInput) => {
            toolNames.current.set(id, toolName);
            tools.current = [
              ...tools.current,
              { id, title: taskTitle, toolName, rawInput, status: 'pending' },
            ];
            flush();
          },
          finished: (id, status) => {
            tools.current = tools.current.map((tool) =>
              tool.id === id ? { ...tool, status } : tool
            );
            flush();
          },
        });
        flush();
      } else if (localResult?.handled) {
        tools.current = (localResult.toolCalls ?? []).map((tool, index) => ({
          id: `local-${startedAt}-${index}`,
          title: tool.title,
          toolName: tool.toolName,
          locations: tool.locations,
          status: tool.status,
        }));
        for (const tool of tools.current) recordFiles(tool.id, tool);
        draft.current = localResult.text ?? 'Completed locally from the attached data.';
        flush();
      } else {
        needsHistoryGrounding.current = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            agent.send(prompt, attachments),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => {
                void agent.cancel().catch(() => undefined);
                reject(new Error('The agent exceeded the 5-minute response limit. Try again or use Stop.'));
              }, AGENT_RESPONSE_TIMEOUT_MS);
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      }
    } catch (e: any) {
      if (!cancelledByUser.current) {
        draft.current = draft.current || `⚠️ ${e?.message ?? e}`;
        flush();
      }
    } finally {
      setBusy(false);
      const nextSpaces = await refreshSpaces();
      const spaceResult = wantsSpace(text)
        ? nextSpaces.find((space) => {
            const previousUpdatedAt = previousSpaces.get(space.slug);
            return previousUpdatedAt === undefined || space.updatedAt > previousUpdatedAt;
          })
        : undefined;
      const completedAt = Date.now();
      setMessages((previous) => {
        const next = [...previous];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index].role === 'agent') {
            next[index] = { ...next[index], completedAt, spaceResult };
            break;
          }
        }
        return next;
      });
      cancelledByUser.current = false;
    }
  }

  async function cancelCurrent() {
    if (!agent || !busy) return;
    cancelledByUser.current = true;
    try {
      await agent.cancel();
    } catch (e: any) {
      cancelledByUser.current = false;
      draft.current = draft.current || `⚠️ Could not stop: ${e?.message ?? e}`;
      flush();
    }
  }

  function choosePermission(optionId: string) {
    resolvePermission.current?.(optionId);
    resolvePermission.current = null;
    setPermission(null);
  }

  async function changeMode(id: string) {
    const previous = mode;
    setMode(id);
    try {
      await agent?.setMode(id);
    } catch {
      setMode(previous);
    }
  }

  /** One click: stage the bundled connector and show the usual approve dialog (URL and key are optional there). */
  async function installControlTowerConnector() {
    const result: any = await window.host?.prepareControlTowerConnector?.();
    if (!result || result.error) {
      setToast(result?.error ?? 'The connector can only be installed from the desktop app.');
      setTimeout(() => setToast(null), 6000);
      return;
    }
    setSkillRequest(result as unknown as InstallRequest);
  }

  const empty = messages.length === 0;
  const composer = (
    <Composer
      onSend={send}
      agent={agent}
      busy={busy}
      workdir={WORKDIR}
      mode={mode}
      onModeChange={changeMode}
      onCancel={cancelCurrent}
      onManageConnectors={() => setView('manage')}
      onInstallConnector={installControlTowerConnector}
      starters={empty}
    />
  );
  const disclaimer = (
    <p className="disclaimer">
      {PRODUCT_NAME} uses AI. Verify results. <a href="#">AI Guidance</a>
    </p>
  );
  const space = spaces.find((s) => s.slug === selectedSpace) ?? null;
  const orderedSpaces = orderSpaces(spaces, spaceOrder);

  /** Reorder starting from what is on screen, so Spaces without a saved position get one too. */
  function changeSpaceOrder(change: (slugs: string[]) => string[]) {
    const next = change(orderedSpaces.map((item) => item.slug));
    setSpaceOrder(next);
    saveSpaceOrder(window.localStorage, next);
  }
  const showDetails = detailsOpen && view === 'chat';

  function resetConversationSurface(conversationFiles: GeneratedFile[] = []) {
    setDetailsOpen(false);
    setView('chat');
    draft.current = '';
    tools.current = [];
    toolNames.current.clear();
    paths.current = new Set(conversationFiles.map((file) => file.path));
    lastGroundedCsvPath.current = null;
    lastGroundedCsvName.current = null;
  }

  function newConversation() {
    if (busy) return;
    const conversation = createConversation();
    setConversationState((state) => ({
      selectedId: conversation.id,
      items: [conversation, ...state.items],
    }));
    needsHistoryGrounding.current = true;
    resetConversationSurface();
  }

  function selectConversation(id: string) {
    if (busy || id === conversationState.selectedId) return;
    const conversation = conversationState.items.find((item) => item.id === id);
    if (!conversation) return;
    setConversationState((state) => ({ ...state, selectedId: id }));
    needsHistoryGrounding.current = true;
    resetConversationSurface(conversation.files);
  }

  function archiveConversation(id: string) {
    if (busy) return;
    const replacement = createConversation();
    const archivingSelected = id === conversationState.selectedId;
    const nextSelected = conversationState.items.find(
      (conversation) => conversation.id !== id && !conversation.archived
    ) ?? replacement;
    setConversationState((state) => archiveConversationState(state, id, replacement));
    if (archivingSelected) {
      needsHistoryGrounding.current = true;
      resetConversationSurface(nextSelected.files);
    }
  }

  function deleteConversation(id: string) {
    if (busy) return;
    const replacement = createConversation();
    const deletingSelected = id === conversationState.selectedId;
    const nextSelected = conversationState.items.find(
      (conversation) => conversation.id !== id && !conversation.archived
    ) ?? replacement;
    setConversationState((state) => deleteConversationState(state, id, replacement));
    if (deletingSelected) {
      needsHistoryGrounding.current = true;
      resetConversationSurface(nextSelected.files);
    }
  }

  function restoreConversation(id: string) {
    if (busy) return;
    const conversation = conversationState.items.find((item) => item.id === id);
    if (!conversation) return;
    setConversationState((state) => restoreConversationState(state, id));
    needsHistoryGrounding.current = true;
    resetConversationSurface(conversation.files);
  }

  return (
    <div className={`app ${showDetails ? 'app-details' : ''}`}>
      <Rail
        view={view}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCover={() => setCoverOpen(true)}
        onView={(v) => {
          setView(v);
          if (v === 'spaces') refreshSpaces();
        }}
      />

      {view === 'chat' && (
        <ConversationList
          conversations={conversationState.items}
          selectedId={conversationState.selectedId}
          disabled={busy}
          onSelect={selectConversation}
          onNew={newConversation}
          onArchive={archiveConversation}
          onRestore={restoreConversation}
          onDelete={deleteConversation}
        />
      )}
      {view === 'spaces' && (
        <SpacesList
          spaces={orderedSpaces}
          selected={selectedSpace}
          onSelect={setSelectedSpace}
          onReorder={(from, to, after) => changeSpaceOrder((current) => moveSpace(current, from, to, after))}
          onNudge={(slug, direction) => changeSpaceOrder((current) => nudgeSpace(current, slug, direction))}
        />
      )}
      {view === 'manage' && (
        <ConversationList
          conversations={conversationState.items}
          selectedId={conversationState.selectedId}
          disabled={busy}
          onSelect={selectConversation}
          onNew={newConversation}
          onArchive={archiveConversation}
          onRestore={restoreConversation}
          onDelete={deleteConversation}
        />
      )}

      {view === 'manage' ? (
        <ManageView
          agent={agent}
          onBack={() => setView('chat')}
          onAgentRestarted={reconnectAgent}
          onImport={(request) => setSkillRequest(request as unknown as InstallRequest)}
        />
      ) : view === 'spaces' ? (
        space ? (
          <SpaceViewer
            key={`${space.slug}-${space.updatedAt}`}
            space={space}
            tabRequest={space.slug === 'ai-control-tower' ? spaceTab : null}
            bridgeEnabled={space.slug === SUB4ME_SPACE}
            bridge={agent ? (tool, args) => agent.callTool(`${SUB4ME_EXTENSION}__${tool}`, args) : undefined}
          />
        ) : (
          <main className="main">
            <div className="empty">
              <h2 className="empty-title">No space selected</h2>
              <p className="disclaimer">
                Ask in a conversation for a dashboard and it shows up here.
              </p>
            </div>
          </main>
        )
      ) : (
        <main className="main">
          <header className="topbar">
            <button className="icon-btn topbar-leading" title="Conversations" aria-label="Conversations">
              <ListIcon />
            </button>
            <h1 className="topbar-title">{title}</h1>
            {(files.length > 0 || detailsOpen) && (
              <button
                className={`icon-btn topbar-details ${detailsOpen ? 'icon-btn-on' : ''}`}
                onClick={() => setDetailsOpen((v) => !v)}
                title="Conversation details"
                aria-label="Conversation details"
              >
                <DetailsIcon />
              </button>
            )}
            <button className="icon-btn topbar-more" title="More" aria-label="More">
              ···
            </button>
          </header>

          {empty ? (
            <div className="empty">
              <WerkbankMark size={44} className="diamond" />
              <h2 className="empty-title">
                How can I help
                <br />
                to get things done?
              </h2>
              {composer}
              {disclaimer}
            </div>
          ) : (
            <>
              <Chat
                messages={messages}
                busy={busy}
                onOpenSpace={(slug) => {
                  setSelectedSpace(slug);
                  setView('spaces');
                }}
                onOpenView={(target) => {
                  if (!spaces.some((candidate) => candidate.slug === target.space)) {
                    setToast('The AI Control Tower space is not installed yet (npm run install:control-tower).');
                    setTimeout(() => setToast(null), 6000);
                    return;
                  }
                  setSelectedSpace(target.space);
                  setSpaceTab({ tab: target.tab, nonce: Date.now() });
                  setView('spaces');
                }}
              />
              <div className="composer-dock">
                {composer}
                {disclaimer}
              </div>
            </>
          )}

          {error && <div className="banner-error">Could not reach the agent: {error}</div>}
        </main>
      )}

      {showDetails && (
        <DetailsPanel
          files={files}
          onClose={() => setDetailsOpen(false)}
          onOpen={(p) => window.host?.openFile?.(p)}
          onReveal={(p) => window.host?.revealFile?.(p)}
        />
      )}

      {permission && <PermissionDialog request={permission} onChoose={choosePermission} />}

      {coverOpen && <CoverSheet onClose={() => setCoverOpen(false)} />}

      {settingsOpen && (
        <SettingsDialog
          appearance={appearance}
          resolvedTheme={resolvedTheme}
          onChange={setAppearance}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {skillRequest && (
        <SkillInstallDialog
          request={skillRequest}
          onDecide={(id, approved, values) => {
            window.host?.decideSkillInstall?.(id, approved, values);
            setSkillRequest(null);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DetailsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 3.1h5.2l2.3 2.3v7.5H5z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M10.2 3.1v2.4h2.3M2.8 5.2v7.7h6.8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
