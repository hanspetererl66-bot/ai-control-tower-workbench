import { DEFAULT_GOOSE_MCP_HOST_CAPABILITIES, GooseClient } from '@aaif/goose-sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { ChatAttachment } from './attachments';

export type FileLocation = { path: string; line?: number };

export type ToolCall = {
  id: string;
  title: string;
  toolName?: string;
  extensionName?: string;
  rawInput?: Record<string, unknown>;
  locations?: FileLocation[];
  status: 'pending' | 'completed' | 'failed';
};

export type PermissionOption = { optionId: string; name: string; kind?: string };
export type PermissionRequest = { title: string; options: PermissionOption[] };

export type Mode = { id: string; name: string; description?: string };
export type Model = { modelId: string; name: string };

export type Handlers = {
  onChunk: (text: string) => void;
  onToolCall: (tc: ToolCall) => void;
  onToolUpdate: (id: string, patch: Partial<ToolCall>) => void;
  /** Resolve with the chosen optionId. Only fires in approve / smart_approve modes. */
  onPermission: (req: PermissionRequest) => Promise<string>;
};

/** A connector as goose reports it: `platform` ones are goose's own built-ins. */
export type Extension = {
  configKey: string;
  name: string;
  enabled: boolean;
  isPlatform: boolean;
  detail: string;
  envKeys: string[];
  config: unknown;
};

export type Agent = {
  sessionId: string;
  modes: Mode[];
  currentMode: string;
  models: Model[];
  currentModel: string;
  extensions: { name: string; success: boolean }[];
  promptCapabilities: { image: boolean; embeddedContext: boolean };
  send: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  cancel: () => Promise<void>;
  setMode: (id: string) => Promise<void>;
  listExtensions: () => Promise<Extension[]>;
  listSessionExtensions: () => Promise<SessionExtension[]>;
  removeSessionExtension: (name: string) => Promise<void>;
  addSessionExtension: (config: unknown) => Promise<void>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<McpToolResult>;
};

export type McpToolResult = {
  content?: Array<unknown>;
  structuredContent?: unknown;
  isError: boolean;
  _meta?: unknown;
};

export type SessionExtension = { name: string; isPlatform: boolean; config: unknown };

/** goosed nests tool metadata under _meta.goose.toolCall — see Phase 0 capture. */
function toolMeta(update: Record<string, any>) {
  return update?._meta?.goose?.toolCall ?? {};
}

/** The global config API returns ACP-shaped MCP servers (`command`, `env[]`,
 * `url`), while the session add API expects goose's config.yaml shape (`cmd`,
 * `envs`, `uri`). Keep that mismatch at this boundary. */
function sessionConfigFromGlobal(extension: any): unknown {
  const server = extension?.server;
  if (!server) return extension;
  const pairs = (rows: any[] = []) =>
    Object.fromEntries(
      rows.map((row) => [row?.name ?? row?.key, row?.value]).filter(([name]) => name)
    );
  if (server.command) {
    return {
      type: 'stdio',
      name: server.name,
      cmd: server.command,
      args: server.args ?? [],
      envs: pairs(server.env),
      timeout: extension.timeout ?? 300,
    };
  }
  if (server.url) {
    return {
      type: 'streamable_http',
      name: server.name,
      uri: server.url,
      headers: pairs(server.headers),
      envs: {},
      timeout: extension.timeout ?? 300,
    };
  }
  return extension;
}

/** Goose redacts configured environment values from its global extension-list
 * response. The Configure IPC already exposes the saved entry with
 * credential-shaped values redacted, so prefer that exact runtime shape when
 * a connector is later removed and re-added to a conversation. Without this,
 * non-secret values such as HOME disappear and account caches cannot be found. */
async function savedSessionConfig(configKey: string, fallback: unknown): Promise<unknown> {
  if (typeof window === 'undefined') return fallback;
  try {
    const spec = await window.host?.getConnectorSpec?.(configKey);
    const configured = spec?.config;
    return configured && typeof configured === 'object' ? configured : fallback;
  } catch {
    return fallback;
  }
}

export async function connect(url: string, cwd: string, handlers: Handlers): Promise<Agent> {
  const callbacks = () => ({
    sessionUpdate: async ({ update }: { update: Record<string, any> }) => {
      if (!update) return;
      switch (update.sessionUpdate) {
        case 'agent_message_chunk': {
          const text = update.content?.text;
          if (text) handlers.onChunk(text);
          break;
        }
        case 'tool_call': {
          const meta = toolMeta(update);
          handlers.onToolCall({
            id: update.toolCallId,
            title: update.title ?? meta.toolName ?? 'tool',
            toolName: meta.toolName,
            extensionName: meta.extensionName,
            rawInput: update.rawInput,
            locations: update.locations,
            status: 'pending',
          });
          break;
        }
        case 'tool_call_update': {
          if (!update.toolCallId) break;
          // Updates arrive out of order — a "completed" can land before a title
          // change — so only patch fields this message actually carries.
          const patch: Partial<ToolCall> = {};
          if (update.status === 'completed') patch.status = 'completed';
          else if (update.status === 'failed') patch.status = 'failed';
          if (update.title) patch.title = update.title;
          if (update.locations) patch.locations = update.locations;
          handlers.onToolUpdate(update.toolCallId, patch);
          break;
        }
      }
    },
    requestPermission: async (req: Record<string, any>) => {
      const options: PermissionOption[] = req?.options ?? [];
      const optionId = await handlers.onPermission({
        title: req?.toolCall?.title ?? 'Allow this action?',
        options,
      });
      return { outcome: { outcome: 'selected' as const, optionId } };
    },
    writeTextFile: async () => ({}),
    readTextFile: async () => ({ content: '' }),
  });

  const client = new GooseClient(callbacks, url);

  const initialization: any = await client.initialize({
    protocolVersion: PROTOCOL_VERSION,
    _meta: { 'goose/useLoginShellPath': true },
    clientCapabilities: {
      elicitation: { form: {} },
      _meta: {
        goose: {
          mcpHostCapabilities: DEFAULT_GOOSE_MCP_HOST_CAPABILITIES,
          customNotifications: true,
        },
      },
    },
    clientInfo: { name: 'werkbank', version: '0.0.0' },
  });

  const session: any = await client.newSession({ cwd, mcpServers: [] });
  const activeSessionId = session.sessionId;
  const promptCapabilities = {
    image: initialization.agentCapabilities?.promptCapabilities?.image === true,
    embeddedContext:
      initialization.agentCapabilities?.promptCapabilities?.embeddedContext === true,
  };

  return {
    sessionId: activeSessionId,
    modes: session.modes?.availableModes ?? [],
    currentMode: session.modes?.currentModeId ?? 'auto',
    models: session.models?.availableModels ?? [],
    currentModel: session.models?.currentModelId ?? '',
    extensions: session._meta?.extensionResults ?? [],
    promptCapabilities,
    async send(text: string, attachments: ChatAttachment[] = []) {
      const contextLines = attachments.map(
        (attachment) =>
          `- ${attachment.name} (${attachment.kind}, ${attachment.mimeType}) at ${attachment.path}`
      );
      const basePromptText = contextLines.length
        ? `${text}\n\nAttached files copied into this workspace:\n${contextLines.join('\n')}\nUse the attached content as primary source context.`
        : text;
      const buildPrompt = (includeImages: boolean, fallbackNotice = false) => {
        let promptText = fallbackNotice
          ? `${basePromptText}\n\nThe configured model cannot receive pixels directly. Use the attached image resource path and its embedded OCR text as fallback context; state any visual limitation.`
          : basePromptText;
        const prompt: any[] = [{ type: 'text', text: promptText }];
        for (const attachment of attachments) {
          prompt.push({
            type: 'resource_link',
            name: attachment.name,
            title: attachment.name,
            uri: attachment.uri,
            mimeType: attachment.mimeType,
            size: attachment.size,
            description: `${attachment.kind} attached by the user`,
          });

          if (
            includeImages &&
            attachment.kind === 'image' &&
            attachment.imageData &&
            promptCapabilities.image
          ) {
            prompt.push({
              type: 'image',
              data: attachment.imageData,
              mimeType: attachment.mimeType,
              uri: attachment.uri,
            });
          }
          if (attachment.extractedText) {
            if (promptCapabilities.embeddedContext) {
              prompt.push({
                type: 'resource',
                resource: {
                  uri: `${attachment.uri}#extracted-text`,
                  mimeType: 'text/plain',
                  text: `Extracted from ${attachment.name}:\n\n${attachment.extractedText}`,
                },
              });
            } else {
              promptText += `\n\n--- Extracted from ${attachment.name} ---\n${attachment.extractedText}`;
              prompt[0].text = promptText;
            }
          }
        }
        return prompt;
      };

      try {
        await client.prompt({ sessionId: activeSessionId, prompt: buildPrompt(true) });
      } catch (error: any) {
        const hasImages = attachments.some((attachment) => attachment.kind === 'image');
        const unsupportedImage = /support image input|image input|input.*image/i.test(
          error?.message ?? String(error)
        );
        if (!hasImages || !unsupportedImage) throw error;
        await client.prompt({ sessionId: activeSessionId, prompt: buildPrompt(false, true) });
      }
    },
    async cancel() {
      await client.cancel({ sessionId: activeSessionId });
    },
    async setMode(id: string) {
      await client.setSessionMode({ sessionId: activeSessionId, modeId: id });
    },
    async listExtensions() {
      const res: any = await (client as any).goose.configExtensionsList_unstable({});
      return await Promise.all((res?.extensions ?? []).map(async (row: any): Promise<Extension> => {
        const ext = row.extension ?? {};
        const server = ext.server ?? {};
        const isPlatform = ext.type === 'platform' || ext.bundled === true;
        const configKey = row.configKey ?? ext.name ?? server.name ?? '?';
        const fallbackConfig = sessionConfigFromGlobal(ext);
        return {
          configKey,
          name: ext.display_name ?? ext.name ?? server.name ?? row.configKey ?? '?',
          enabled: row.enabled !== false,
          isPlatform,
          detail:
            ext.description ??
            (server.command ? [server.command, ...(server.args ?? [])].join(' ') : ext.uri ?? ''),
          envKeys: Array.isArray(server.env)
            ? server.env.map((e: any) => (typeof e === 'string' ? e : e?.key)).filter(Boolean)
            : Object.keys(server.env ?? {}),
          config: isPlatform
            ? fallbackConfig
            : await savedSessionConfig(configKey, fallbackConfig),
        };
      }));
    },
    // Session-scoped: toggling here affects this conversation only, config.yaml
    // is untouched. `config` round-trips straight back into add().
    async listSessionExtensions() {
      const res: any = await (client as any).goose.sessionExtensionsList_unstable({
        sessionId: activeSessionId,
      });
      return (res?.extensions ?? []).map((e: any) => ({
        name: e.name,
        isPlatform: e.type === 'platform' || e.bundled === true,
        config: e,
      }));
    },
    async removeSessionExtension(name: string) {
      await (client as any).goose.sessionExtensionsRemove_unstable({
        sessionId: activeSessionId,
        name,
      });
    },
    async addSessionExtension(config: unknown) {
      await (client as any).goose.sessionExtensionsAdd_unstable({
        sessionId: activeSessionId,
        config,
      });
    },
    async callTool(name: string, args: Record<string, unknown> = {}) {
      return await (client as any).goose.toolsCall_unstable({
        sessionId: activeSessionId,
        name,
        arguments: args,
      });
    },
  };
}

const KIND_BY_EXT: Record<string, string> = {
  html: 'Web Page',
  md: 'Text File',
  txt: 'Text File',
  json: 'Data File',
  csv: 'Spreadsheet',
  xlsx: 'Spreadsheet',
  pptx: 'Presentation',
  docx: 'Document',
  pdf: 'PDF',
  abap: 'ABAP Source',
};

export function fileKind(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return KIND_BY_EXT[ext] ?? 'File';
}
