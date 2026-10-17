import type { Agent, Extension, SessionExtension } from './acp';
import { isMicrosoft365Backend } from './connector-presentation.ts';

export type ConnectorSelection = {
  requested: string;
  configured: Extension[];
  active: SessionExtension[];
};

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Treat "Use only <connector>" as an executable routing instruction so a
 * remounted composer or stale picker cannot silently run the prompt with the
 * wrong tool set.
 */
export function exclusiveConnectorRequest(text: string): string | null {
  return /\buse\s+only\s+([a-z0-9][a-z0-9._-]*)\b/i.exec(text)?.[1] ?? null;
}

export function requestedConnectorIsAlreadyExclusive(
  text: string,
  activeNames: Iterable<string>
): boolean {
  const requested = exclusiveConnectorRequest(text);
  if (!requested) return false;
  const active = [...activeNames];
  return active.length === 1 && normalized(active[0]) === normalized(requested);
}

/** Keep Goose platform tools, but make the requested MCP connector exclusive. */
export async function applyExclusiveConnectorRequest(
  agent: Agent,
  text: string,
  timeoutMs = 20_000
): Promise<ConnectorSelection | null> {
  const requested = exclusiveConnectorRequest(text);
  if (!requested) return null;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      selectExclusiveConnector(agent, requested),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Selecting connector "${requested}" timed out. Restart the local agent and try again.`
              )
            ),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function selectExclusiveConnector(
  agent: Agent,
  requested: string
): Promise<ConnectorSelection> {
  const configured = (await agent.listExtensions()).filter(
    (extension) => extension.enabled && !extension.isPlatform
  );
  const target = configured.find(
    (extension) =>
      normalized(extension.configKey) === normalized(requested) ||
      normalized(extension.name) === normalized(requested)
  );
  if (!target) {
    const available = configured.map((extension) => extension.configKey).join(', ') || 'none';
    throw new Error(`Connector "${requested}" is not available. Configured connectors: ${available}.`);
  }

  const live = await agent.listSessionExtensions();
  const external = live.filter((extension) => !extension.isPlatform);
  const targetNames = new Set([normalized(target.configKey), normalized(target.name)]);

  for (const extension of external) {
    if (
      !targetNames.has(normalized(extension.name)) &&
      !isMicrosoft365Backend(extension.name)
    ) {
      await agent.removeSessionExtension(extension.name);
    }
  }

  const targetIsLive = external.some((extension) => targetNames.has(normalized(extension.name)));
  if (!targetIsLive) await agent.addSessionExtension(target.config);

  const active = await agent.listSessionExtensions();
  const externalActive = active.filter(
    (extension) => !extension.isPlatform && !isMicrosoft365Backend(extension.name)
  );
  const targetIsMicrosoft365 = isMicrosoft365Backend(target.configKey) || isMicrosoft365Backend(target.name);
  const targetRemainedLive = active.some((extension) =>
    targetNames.has(normalized(extension.name))
  );
  const exclusive = targetIsMicrosoft365
    ? targetRemainedLive && externalActive.length === 0
    : targetRemainedLive &&
      externalActive.length === 1 &&
      targetNames.has(normalized(externalActive[0].name));
  if (!exclusive) {
    throw new Error(`Could not make ${target.configKey} the only active connector.`);
  }

  return { requested: target.configKey, configured, active };
}
