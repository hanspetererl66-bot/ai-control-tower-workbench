import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connect, type Agent, type PermissionRequest, type ToolCall } from './acp';
import {
 
  resolveAppearance,
  writeAppearance,
  type AppearancePreference,
} from './appearance';
import type { ChatAttachment } from './attachments';
import { isWebTool, webSearchNote, WEB_SEARCH_BLOCKED_NOTE } from './web-search';
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
import SidePanel, { memorySummary, type ContextItem, type GeneratedFile, type SidePanelTab } from './ui/SidePanel';
import PermissionDialog from './ui/PermissionDialog';
import Rail, { type View } from './ui/Rail';
import SkillInstallDialog, { type InstallRequest } from './ui/SkillInstallDialog';
import SettingsDialog from './ui/SettingsDialog';
import { activeHarness, allHarnesses, chooseHarness, checkToolCall, harnessBlockedNote, harnessNote, harnessStepsNote, harnessSummary, memoryFor, rejectOption, requiresApproval, stepsExceeded } from './harness';
import { loadMemory, saveMemory, addMemory, memoryNote, suggestMemory, MEMORY_KINDS, type MemoryState } from './memory';
import { ACTIVE_GROUP_KEY, createGroupClient, groupNote, loadIdentity, type GroupDetail, type Identity } from './groups';
import SpacesList from './ui/SpacesList';
import { deleteSpaceFolder, importSpaceFile } from './space-share';
import { isDue, loadSchedules, saveSchedules, type Schedule } from './schedules';
import { loadSpaceOrder, moveSpace, nudgeSpace, orderSpaces, saveSpaceOrder } from './space-order';
import { SUB4ME_EXTENSION, SUB4ME_SPACE, parseToolResult } from './sub4me-bridge';
import { addDomain, archiveSpace, restoreSpace, splitArchived, applySpaceTitles, assignDomain, assignParent, assistantNote, deleteDomain, forgetSpace, renameSpace, domainNames, effectiveDomain, parentCandidates, parentOf, loadPreferences, pinFirst, renameDomain, savePreferences, sanitizePreferences, startSpace, togglePin, type Preferences } from './preferences';
import { buildPreferenceCss } from './preferences-style';
import { listSkills, type Skill } from './skills';
import { CONTROL_TOWER_CONNECTOR } from './starter-prompts';
import SpaceViewer, { type SpaceTabRequest } from './ui/SpaceViewer';
import type { Handoff, IncomingHandoff } from './space-handoff';
import WerkbankMark from './ui/WerkbankMark';
import { PRODUCT_TITLE } from './product';
import CoverSheet from './ui/CoverSheet';
import N8nView from './ui/N8nView';
import { writeSpaceScale, type SpaceScale } from './space-scale';
import { DEFAULT_VOICE, ReplySpeaker, type VoiceSettings } from './voice';
import { parseNavCommand } from './voice-commands';

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
  const webSearch = selectedConversation?.webSearch !== false;
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
  const [sideTab, setSideTab] = useState<SidePanelTab>('memory');
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [mode, setMode] = useState('auto');
  const [schedules, setSchedules] = useState<Schedule[]>(() => loadSchedules(window.localStorage));
  const updateSchedules = useCallback((next: Schedule[]) => {
    setSchedules(next);
    saveSchedules(next, window.localStorage);
  }, []);
  const [view, setView] = useState<View>('chat');
  const [skillRequest, setSkillRequest] = useState<InstallRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rawSpaces, setSpaces] = useState<Space[]>([]);
  const [spaceOrder, setSpaceOrder] = useState<string[]>(() => loadSpaceOrder(window.localStorage));
  const [selectedSpace, setSelectedSpace] = useState<string | null>(null);
  const [spaceTab, setSpaceTab] = useState<SpaceTabRequest | null>(null);
  // Hand-over between Spaces: the working state of each Space (in memory) and work waiting for a Space to open.
  const spaceStates = useRef<Record<string, Record<string, unknown>>>({});
  const [incoming, setIncoming] = useState<Record<string, IncomingHandoff[]>>({});
  const handoffNonce = useRef(0);
  const [coverOpen, setCoverOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(() => {
    const loaded = loadPreferences(window.localStorage);
    return loaded;
  });
  const updatePrefs = useCallback((change: (current: Preferences) => Preferences) => {
    setPrefs((current) => sanitizePreferences(change(current)));
  }, []);
  const spaces = useMemo(() => applySpaceTitles(rawSpaces, prefs), [rawSpaces, prefs]);
  const { active: activeSpaces, archived: archivedSpaces } = useMemo(() => splitArchived(spaces, prefs), [spaces, prefs]);
  const spaceScale = prefs.spaceScale as SpaceScale;
  function changeSpaceScale(scale: SpaceScale) {
    updatePrefs((c) => ({ ...c, spaceScale: scale }));
  }
  const [skillList, setSkillList] = useState<Skill[]>([]);
  const [extensionNames, setExtensionNames] = useState<string[]>([]);
  const [syncState, setSyncState] = useState({ busy: false, message: '' });
  // Groups: who the person says they are, which group's rules the chat uses, and that group as last read from the server.
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity(window.localStorage));
  const [activeGroupId, setActiveGroupId] = useState<string | null>(() => { try { return window.localStorage.getItem(ACTIVE_GROUP_KEY); } catch { return null; } });
  const [activeGroup, setActiveGroup] = useState<GroupDetail | null>(null);
  // Personal memory: notes kept on this computer; the assistant may suggest an entry, the person decides.
  const [memory, setMemoryState] = useState<MemoryState>(() => loadMemory(window.localStorage));
  const [memorySuggestion, setMemorySuggestion] = useState<ReturnType<typeof suggestMemory>>(null);
  const changeMemory = useCallback((next: MemoryState) => { setMemoryState(next); saveMemory(window.localStorage, next); }, []);
  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);
  const speaker = useRef<ReplySpeaker | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  useEffect(() => {
    void window.host?.voice?.getSettings().then(setVoice).catch(() => undefined);
    return () => speaker.current?.stop();
  }, []);
  async function saveVoice(patch: Partial<Omit<VoiceSettings, 'hasKey'>> & { key?: string }) {
    const result = await window.host?.voice?.saveSettings(patch);
    if (result?.ok && result.settings) setVoice(result.settings);
    if (!patch.speak) speaker.current?.stop();
    return result;
  }
  const appearance = prefs.appearance as AppearancePreference;
  const setAppearance = (value: AppearancePreference) => updatePrefs((c) => ({ ...c, appearance: value }));
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
  const webSearchRef = useRef(true);
  const askBeforeActionsRef = useRef(prefs.chat.askBeforeActions);
  askBeforeActionsRef.current = prefs.chat.askBeforeActions;
  // Working profile (harness): checked on every tool call and approval request of the running answer.
  const harness = activeHarness(prefs.harness);
  const harnessRef = useRef(harness);
  harnessRef.current = harness;
  const harnessStepCount = useRef(0);
  const harnessBlock = useRef<string | null>(null);
  const blockedWebTool = useRef(false);
  const agentRef = useRef<Agent | null>(null);
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

  // Personal look: stored, applied as CSS on the app, zoom for the app size.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      savePreferences(prefs, window.localStorage);
      writeSpaceScale(prefs.spaceScale as SpaceScale, window.localStorage);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [prefs]);
  useEffect(() => {
    let style = document.getElementById('werkbank-preferences') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'werkbank-preferences';
      document.head.appendChild(style);
    }
    style.textContent = buildPreferenceCss(prefs);
    document.documentElement.dataset.density = prefs.density;
    window.host?.setZoomFactor?.(prefs.appScale);
  }, [prefs]);
  useEffect(() => {
    void listSkills().then(setSkillList).catch(() => undefined);
  }, [settingsOpen]);
  useEffect(() => {
    if (!agent || !settingsOpen) return;
    void agent.listExtensions().then((list) => setExtensionNames(list.filter((e) => e.enabled && !e.isPlatform).map((e) => e.name))).catch(() => undefined);
  }, [agent, settingsOpen]);

  // Start view: once, as soon as the Spaces are known.
  const startApplied = useRef(false);
  useEffect(() => {
    if (startApplied.current || !activeSpaces.length) return;
    startApplied.current = true;
    let last: string | null = null;
    try { last = window.localStorage.getItem('werkbank.lastSpace'); } catch { /* ignore */ }
    const target = startSpace(prefs, activeSpaces.map((x) => x.slug), last);
    if (target) {
      setSelectedSpace(target);
      setView('spaces');
    }
  }, [activeSpaces, prefs]);
  useEffect(() => {
    if (!selectedSpace) return;
    try { window.localStorage.setItem('werkbank.lastSpace', selectedSpace); } catch { /* ignore */ }
  }, [selectedSpace]);

  const groupCall = useMemo(() => (agent && extensionNames.includes(CONTROL_TOWER_CONNECTOR)
    ? async (tool: string, args: Record<string, unknown>) => parseToolResult(await agent.callTool(`${CONTROL_TOWER_CONNECTOR}__${tool}`, args))
    : null), [agent, extensionNames]);
  const chooseActiveGroup = useCallback((id: string | null) => {
    setActiveGroupId(id);
    if (!id) setActiveGroup(null);
    try { if (id) window.localStorage.setItem(ACTIVE_GROUP_KEY, id); else window.localStorage.removeItem(ACTIVE_GROUP_KEY); } catch { /* ignore */ }
  }, []);
  // The group used in chat is read again every minute, so rules a colleague adds apply without a restart.
  useEffect(() => {
    if (!groupCall || !identity || !activeGroupId) return undefined;
    const client = createGroupClient(groupCall, identity.email);
    let stopped = false;
    const read = () => { client.get(activeGroupId).then((d) => { if (!stopped) setActiveGroup(d); }).catch(() => { if (!stopped) setActiveGroup(null); }); };
    read();
    const timer = window.setInterval(read, 60_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [groupCall, identity, activeGroupId]);

  async function syncSave() {
    if (!agent) return;
    setSyncState({ busy: true, message: '' });
    try {
      const data = { ...prefs, sync: undefined };
      const out = parseToolResult(await agent.callTool(`${CONTROL_TOWER_CONNECTOR}__save_preferences`, { key: prefs.sync.key, data }));
      setSyncState({ busy: false, message: out?.updatedAt ? `Saved to Supabase (${out.updatedAt}).` : 'Saved to Supabase.' });
    } catch (error) {
      setSyncState({ busy: false, message: `Saving failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const syncLoad = useCallback(async () => {
    if (!agent) return;
    setSyncState({ busy: true, message: '' });
    try {
      const out = parseToolResult(await agent.callTool(`${CONTROL_TOWER_CONNECTOR}__get_preferences`, { key: prefs.sync.key }));
      if (!out || !out.data) {
        setSyncState({ busy: false, message: 'Nothing stored under this key yet.' });
        return;
      }
      updatePrefs((c) => ({ ...sanitizePreferences(out.data), sync: c.sync }));
      setSyncState({ busy: false, message: 'Loaded from Supabase.' });
    } catch (error) {
      setSyncState({ busy: false, message: `Loading failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }, [agent, prefs.sync.key, updatePrefs]);
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!agent || autoLoaded.current || !prefs.sync.auto) return;
    autoLoaded.current = true;
    void syncLoad();
  }, [agent, prefs.sync.auto, syncLoad]);

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
      setSideTab('context');
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
        speaker.current?.feed(t);
        flush();
      },
      onToolCall: (tc: ToolCall) => {
        const profile = harnessRef.current;
        harnessStepCount.current += 1;
        const verdict = checkToolCall(profile, tc);
        if (!verdict.ok || stepsExceeded(profile, harnessStepCount.current)) {
          // The working profile does not allow this call (connector, rights) or the step limit is reached: stop the answer here.
          harnessBlock.current ??= verdict.ok ? harnessStepsNote(profile) : harnessBlockedNote(verdict.reason);
          void agentRef.current?.cancel().catch(() => undefined);
        }
        if (!webSearchRef.current && isWebTool(tc)) {
          // Web Search is off for this conversation: stop the turn as soon as a web tool is announced.
          blockedWebTool.current = true;
          void agentRef.current?.cancel().catch(() => undefined);
        }
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
          // A request the working profile refuses is declined without asking; the person sees why in the answer.
          const verdict = checkToolCall(harnessRef.current, req);
          if (!verdict.ok) {
            harnessBlock.current ??= harnessBlockedNote(verdict.reason);
            resolve(rejectOption(req.options));
            return;
          }
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
        agentRef.current = nextAgent;
        setAgent(nextAgent);
        setMode(nextAgent.currentMode);
        if (askBeforeActionsRef.current && nextAgent.currentMode === 'auto') {
          nextAgent.setMode('smart_approve').then(() => setMode('smart_approve')).catch(() => undefined);
        }
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

  useEffect(() => {
    webSearchRef.current = webSearch;
  }, [webSearch]);

  function changeWebSearch(enabled: boolean) {
    setConversationState((state) => ({
      ...state,
      items: state.items.map((conversation) =>
        conversation.id === state.selectedId ? { ...conversation, webSearch: enabled } : conversation
      ),
    }));
  }

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
    setMemorySuggestion(suggestMemory(text, memory));
    harnessStepCount.current = 0;
    harnessBlock.current = null;
    draft.current = '';
    tools.current = [];
    speaker.current?.stop();
    speaker.current = voiceRef.current.speak ? new ReplySpeaker(voiceRef.current.language) : null;
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
      blockedWebTool.current = false;
      const prompt = [historyGrounding, text, assistantNote(prefs), harnessNote(harnessRef.current), memoryNote(memoryFor(harnessRef.current, memory)), groupNote(activeGroup), webSearchNote(webSearch), grounding, spaceTarget, spaceRequested ? SPACE_BRIEF : '']
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
      speaker.current?.finish();
      if (harnessBlock.current) {
        if (!cancelledByUser.current) draft.current += harnessBlock.current;
        harnessBlock.current = null;
        flush();
      }
      if (blockedWebTool.current) {
        blockedWebTool.current = false;
        if (!cancelledByUser.current) draft.current += WEB_SEARCH_BLOCKED_NOTE;
        flush();
      }
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
    speaker.current?.stop();
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

  /** Choosing a profile that limits actions switches the agent to asking before changes; it never switches it back by itself. */
  function changeHarness(id: string) {
    updatePrefs((current) => ({ ...current, harness: chooseHarness(current.harness, id) }));
  }
  useEffect(() => {
    if (agent && requiresApproval(harness) && mode === 'auto') void changeMode('smart_approve');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, harness.id, harness.permission, mode]);

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

  /** "Joule fragen" in a Space: switch to the chat and send the question, unless the agent is busy or missing. */
  function askFromSpace(prompt: string) {
    if (!agent || busy) {
      setToast(!agent ? 'Der Agent ist noch nicht verbunden.' : 'Joule antwortet gerade noch, bitte kurz warten.');
      setTimeout(() => setToast(null), 5000);
      return;
    }
    setView('chat');
    void send(prompt);
  }

  /** Open a Space (and optionally one of its tabs); used by spoken commands and briefing cards. */
  function navigateTo(target: { space: string; tab?: string; label?: string }) {
    const label = target.label ?? target.space;
    const notify = (message: string) => {
      setToast(message);
      setTimeout(() => setToast(null), 4000);
    };
    if (!spaces.some((candidate) => candidate.slug === target.space)) {
      notify(`${label}: Space ist noch nicht installiert.`);
      return;
    }
    speaker.current?.stop();
    setSelectedSpace(target.space);
    setSpaceTab(target.tab ? { tab: target.tab, nonce: Date.now(), space: target.space } : null);
    setView('spaces');
    notify(`Öffne ${label}`);
  }

  /** A spoken "Zeig mir die Risiken" opens the matching Space and tab instead of asking the agent. */
  function handleVoiceCommand(text: string): boolean {
    const target = parseNavCommand(text);
    if (!target) return false;
    navigateTo(target);
    return true;
  }

  /** Install a Space file somebody sent: ask before replacing one with the same name. */
  async function importSpace(file: File) {
    const say = (message: string) => { setToast(message); setTimeout(() => setToast(null), 6000); };
    try {
      let result = await importSpaceFile(file);
      if ('exists' in result) {
        const replace = window.confirm(`A Space "${result.title}" already exists.\nOK = replace it, Cancel = import as a copy.`);
        result = await importSpaceFile(file, replace ? 'replace' : 'new');
      }
      if ('exists' in result) return;
      const next = await refreshSpaces();
      void next;
      setSelectedSpace(result.slug);
      say(`Imported Space "${result.title}".`);
    } catch (e: any) {
      say(e?.message ?? 'The Space could not be imported.');
    }
  }

  /** A Space hands work to another Space: queue it, open that Space unless told not to, and show the notice. */
  function handOff(fromSlug: string, handoff: Handoff) {
    const target = spaces.find((x) => x.slug === handoff.to);
    if (!target) { setToast('The Space for this hand-over is not installed.'); setTimeout(() => setToast(null), 6000); return; }
    handoffNonce.current += 1;
    setIncoming((current) => ({ ...current, [handoff.to]: [...(current[handoff.to] ?? []), { from: fromSlug, payload: handoff.payload, nonce: handoffNonce.current }].slice(-20) }));
    if (handoff.open) { setSelectedSpace(handoff.to); setView('spaces'); }
    if (handoff.notice) { setToast(handoff.notice); setTimeout(() => setToast(null), 8000); }
  }

  /** Rename a Space or subspace: the new name is kept in the settings, the folder name stays. */
  function renameSpaceTitle(slug: string, title: string) {
    const original = rawSpaces.find((x) => x.slug === slug)?.title ?? slug;
    updatePrefs((c) => renameSpace(c, slug, title, original));
  }

  /** Delete a Space for good. SpacesList has already asked the person to confirm. */
  async function deleteSpace(slug: string) {
    const say = (message: string) => { setToast(message); setTimeout(() => setToast(null), 6000); };
    const title = spaces.find((x) => x.slug === slug)?.title ?? slug;
    try {
      await deleteSpaceFolder(slug);
      updatePrefs((c) => forgetSpace(c, slug, rawSpaces));
      setSpaceOrder((current) => {
        const next = current.filter((x) => x !== slug);
        saveSpaceOrder(window.localStorage, next);
        return next;
      });
      await refreshSpaces();
      say(`Deleted Space "${title}".`);
    } catch (e: any) {
      say(e?.message ?? 'The Space could not be deleted.');
    }
  }

  /** Archive hides a Space from the list without touching its files; Restore brings it back. */
  function archiveOne(slug: string) {
    const title = spaces.find((x) => x.slug === slug)?.title ?? slug;
    updatePrefs((c) => archiveSpace(c, slug, rawSpaces));
    if (selectedSpace === slug) setSelectedSpace(activeSpaces.find((x) => x.slug !== slug)?.slug ?? null);
    setToast(`Archived "${title}". Find it under Archived Spaces.`);
    setTimeout(() => setToast(null), 6000);
  }

  function restoreOne(slug: string) {
    const title = spaces.find((x) => x.slug === slug)?.title ?? slug;
    updatePrefs((c) => restoreSpace(c, slug));
    setToast(`Restored "${title}".`);
    setTimeout(() => setToast(null), 6000);
  }

  /** "Save as Space": the agent turns one answer into a Space. */
  function saveAnswerAsSpace(index: number) {
    const answer = messages[index];
    if (!answer || answer.role !== 'agent' || !answer.text.trim()) return;
    void send(`Create a Space from your answer below. Give it a short, fitting title.\n\n${answer.text.slice(0, 8000)}`);
  }

  // Recurring briefings: while the app is open, run a due one when the chat is idle (also catches up to six hours).
  const dueTick = useRef<() => void>(() => undefined);
  dueTick.current = () => {
    if (!agent || busy) return;
    const now = new Date();
    const due = schedules.find((s) => isDue(s, now));
    if (!due) return;
    updateSchedules(schedules.map((s) => (s.id === due.id ? { ...s, lastRun: now.toISOString() } : s)));
    setView('chat');
    void send(`${due.prompt}\n\n(Recurring briefing, ${due.time})`);
  };
  useEffect(() => {
    const id = window.setInterval(() => dueTick.current(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const empty = messages.length === 0;
  const composer = (
    <Composer
      onSend={send}
      agent={agent}
      busy={busy}
      workdir={WORKDIR}
      mode={mode}
      onModeChange={changeMode}
      harnesses={allHarnesses(prefs.harness).map(({ id, name, description }) => ({ id, name, description }))}
      harnessId={harness.id}
      onHarnessChange={changeHarness}
      webSearch={webSearch}
      onWebSearchChange={changeWebSearch}
      onCancel={cancelCurrent}
      onManageConnectors={() => setView('manage')}
      onInstallConnector={installControlTowerConnector}
      starters={empty}
      voice={voice}
      onOpenSettings={() => setSettingsOpen(true)}
      onStopSpeaking={() => speaker.current?.stop()}
      onVoiceCommand={handleVoiceCommand}
      onNavigate={navigateTo}
      ownStarters={prefs.starters}
      hiddenStarters={prefs.chat.hiddenStarters}
      hiddenBriefing={prefs.chat.hiddenBriefing}
      schedules={schedules}
      onSchedulesChange={updateSchedules}
      favoriteStarters={prefs.favoriteSkills.map((name) => ({ label: name, prompt: `Nutze den Skill ${name}.` }))}
    />
  );
  const suggestionBar = memorySuggestion && (
    <div className="memory-suggest" role="status">
      <span>Remember “{memorySuggestion.text}” ({MEMORY_KINDS.find((k) => k.id === memorySuggestion.kind)?.title.toLowerCase()})?</span>
      <button className="ghost-btn" onClick={() => { const r = addMemory(memory, memorySuggestion.kind, memorySuggestion.text); if (!r.error) changeMemory(r.state); setMemorySuggestion(null); }}>Remember</button>
      <button className="ghost-btn" onClick={() => setMemorySuggestion(null)}>No thanks</button>
    </div>
  );
  const disclaimer = (
    <p className="disclaimer">
      {PRODUCT_TITLE} uses AI. Verify results. <a href="#">AI Guidance</a>
    </p>
  );
  const space = activeSpaces.find((s) => s.slug === selectedSpace) ?? null;
  const orderedSpaces = pinFirst(orderSpaces(activeSpaces, spaceOrder), prefs.pinnedSpaces);

  /** Reorder starting from what is on screen, so Spaces without a saved position get one too. */
  function changeSpaceOrder(change: (slugs: string[]) => string[]) {
    const next = change(orderedSpaces.map((item) => item.slug));
    setSpaceOrder(next);
    saveSpaceOrder(window.localStorage, next);
  }
  const showDetails = detailsOpen && view === 'chat';
  const activeSchedules = schedules.filter((x) => x.enabled).length;
  const instructionsSet = Boolean(assistantNote(prefs));
  const contextItems: ContextItem[] = [
    { id: 'memory', label: 'Memory', detail: memory.enabled ? memorySummary(memory) : 'Switched off', on: memory.enabled && memory.entries.length > 0, tab: 'memory' },
    { id: 'instructions', label: 'Instructions', detail: instructionsSet ? 'Language, length, tone or standing instructions set' : 'All at their defaults', on: instructionsSet, tab: 'instructions' },
    { id: 'harness', label: 'Working profile', detail: harnessSummary(harness), on: harness.id !== 'standard', tab: 'instructions' },
    { id: 'web', label: 'Web search', detail: webSearch ? 'The assistant may search the web' : 'Switched off for this conversation', on: webSearch },
    { id: 'group', label: 'Group', detail: activeGroup ? activeGroup.group.name : 'No group selected', on: Boolean(activeGroup) },
    { id: 'schedule', label: 'Schedule', detail: activeSchedules ? `${activeSchedules} recurring ${activeSchedules === 1 ? 'briefing' : 'briefings'} active` : 'No recurring briefings', on: activeSchedules > 0, tab: 'schedule' },
  ];

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
        appearance={appearance}
        onAppearance={setAppearance}
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
          pinned={prefs.pinnedSpaces}
          onTogglePin={(slug) => updatePrefs((c) => ({ ...c, pinnedSpaces: togglePin(c.pinnedSpaces, slug) }))}
          domains={domainNames(activeSpaces, prefs)}
          domainOf={(slug) => effectiveDomain(spaces.find((x) => x.slug === slug) ?? { slug }, spaces, prefs)}
          onAssign={(slug, name) => updatePrefs((c) => { const sp = spaces.find((x) => x.slug === slug) ?? { slug }; return assignDomain(assignParent(c, sp, spaces, ''), sp, name); })}
          parentOf={(slug) => parentOf(spaces.find((x) => x.slug === slug) ?? { slug }, spaces, prefs)}
          parentCandidates={(slug) => parentCandidates(spaces.find((x) => x.slug === slug) ?? { slug }, spaces, prefs)}
          onSetParent={(slug, parent) => updatePrefs((c) => assignParent(c, spaces.find((x) => x.slug === slug) ?? { slug }, spaces, parent))}
          onAddDomain={(name) => updatePrefs((c) => addDomain(c, name))}
          onRenameDomain={(from, to) => updatePrefs((c) => renameDomain(c, spaces, from, to))}
          onDeleteDomain={(name) => updatePrefs((c) => deleteDomain(c, name))}
          onImportSpace={(file) => void importSpace(file)}
          onRenameSpace={renameSpaceTitle}
          originalTitle={(slug) => rawSpaces.find((x) => x.slug === slug)?.title ?? slug}
          onDeleteSpace={(slug) => void deleteSpace(slug)}
          onArchiveSpace={archiveOne}
          archived={archivedSpaces}
          onRestoreSpace={restoreOne}
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

      {view === 'n8n' ? (
        <N8nView
          theme={resolvedTheme}
          visible={!settingsOpen && !coverOpen && !skillRequest && !permission}
          onRestartAgent={async () => {
            await window.host?.restartAgent?.();
            reconnectAgent();
          }}
        />
      ) : view === 'manage' ? (
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
            tabRequest={spaceTab && (spaceTab.space ?? 'ai-control-tower') === space.slug ? spaceTab : null}
            textScale={spaceScale}
            theme={resolvedTheme}
            prefs={prefs}
            bridgeEnabled={space.slug === SUB4ME_SPACE}
            onAsk={askFromSpace}
            onHandoff={(handoff) => handOff(space.slug, handoff)}
            onSpaceState={(state) => { spaceStates.current[space.slug] = state; }}
            savedState={spaceStates.current[space.slug]}
            incoming={incoming[space.slug]}
            onIncomingDelivered={() => setIncoming((current) => { const { [space.slug]: _gone, ...rest } = current; return rest; })}
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
            <button
              className={`icon-btn topbar-details ${detailsOpen ? 'icon-btn-on' : ''}`}
              onClick={() => setDetailsOpen((v) => !v)}
              title="Memory, context, instructions and schedule"
              aria-label="Memory, context, instructions and schedule"
              aria-expanded={detailsOpen}
            >
              <DetailsIcon />
            </button>
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
              {suggestionBar}
              {composer}
              {disclaimer}
            </div>
          ) : (
            <>
              <Chat
                messages={messages}
                busy={busy}
                onAsk={askFromSpace}
                onSaveAsSpace={saveAnswerAsSpace}
                chatTools={prefs.chat}
                meta={{ privacy: { webSearch, connectors: extensionNames, model: agent?.currentModel ?? '', mode }, title }}
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
                {suggestionBar}
                {composer}
                {disclaimer}
              </div>
            </>
          )}

          {error && <div className="banner-error">Could not reach the agent: {error}</div>}
        </main>
      )}

      {showDetails && (
        <SidePanel
          tab={sideTab}
          onTab={setSideTab}
          files={files}
          memory={memory}
          onMemoryChange={changeMemory}
          prefs={prefs}
          onPrefs={updatePrefs}
          schedules={schedules}
          onSchedules={updateSchedules}
          context={contextItems}
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
          spaceScale={spaceScale}
          onSpaceScaleChange={changeSpaceScale}
          voice={voice}
          onVoiceChange={saveVoice}
          personalize={{
            prefs,
            update: updatePrefs,
            spaces: spaces.map((x) => ({ slug: x.slug, title: x.title })),
            skills: skillList.map((x) => ({ name: x.name, description: x.description })),
            connectors: extensionNames,
            syncAvailable: Boolean(agent) && extensionNames.includes(CONTROL_TOWER_CONNECTOR),
            sync: syncState,
            onSyncSave: () => void syncSave(),
            onSyncLoad: () => void syncLoad(),
            memory: { memory, onChange: changeMemory },
            groups: {
              call: groupCall,
              identity,
              onIdentity: setIdentity,
              spaces: spaces.map((x) => ({ slug: x.slug, title: x.title })),
              activeId: activeGroupId,
              onActive: chooseActiveGroup,
              onSpaceInstalled: (slug: string) => { void refreshSpaces().then(() => setSelectedSpace(slug)); },
              onDetail: setActiveGroup,
            },
          }}
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
