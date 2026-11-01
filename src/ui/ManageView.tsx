import { useCallback, useEffect, useState } from 'react';
import type { Agent, Extension } from '../acp';
import {
  BUILT_IN_WORK_SOURCES,
  connectorDisplayName,
  connectorDisplayOrder,
  isMicrosoft365Backend,
} from '../connector-presentation';
import { listSkills, type Skill } from '../skills';
import SkillIcon from './SkillIcon';
import SkillGovernance from './SkillGovernance';
import SkillInstallDialog, { type InstallRequest } from './SkillInstallDialog';

const LOOKS_SECRET = /password|secret|token|api[-_]?key|authorization|cookie|credential/i;

/** Connector config is useful for diagnosis, but Configure must never become a
 * credential viewer. Redact secret-shaped object keys and common CLI flags. */
function sanitizedConfig(value: unknown, key = ''): unknown {
  if (LOOKS_SECRET.test(key)) return value == null || value === '' ? value : '<redacted>';
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const previous = value[index - 1];
      return typeof previous === 'string' && LOOKS_SECRET.test(previous)
        ? '<redacted>'
        : sanitizedConfig(item);
    });
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizedConfig(child, childKey),
      ])
    );
  }
  if (typeof value === 'string') {
    return value
      .replace(/(https?:\/\/[^:/\s]+:)[^@\s]+@/gi, '$1<redacted>@')
      .replace(/(--?(?:password|secret|token|api[-_]?key)(?:=|\s+))\S+/gi, '$1<redacted>');
  }
  return value;
}

export default function ManageView({
  agent,
  onBack,
  onAgentRestarted,
  onImport,
}: {
  agent: Agent | null;
  onBack: () => void;
  onAgentRestarted: () => void;
  onImport: (request: Record<string, unknown>) => void;
}) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [bundled, setBundled] = useState<{ id: string; name: string; title: string; description: string; tools: number; needsSetup: boolean }[]>([]);
  useEffect(() => { void window.host?.listBundledConnectors?.().then((list) => setBundled(list ?? [])); }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<{
    request: InstallRequest;
    values: Record<string, string>;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (agent) {
      try {
        setExtensions(await agent.listExtensions());
        setNote((current) =>
          current?.startsWith('Could not read connectors:') ? null : current
        );
      } catch (e: any) {
        setNote(`Could not read connectors: ${e?.message ?? e}`);
      }
    }
    setSkills(await listSkills());
  }, [agent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(
    label: string,
    fn: () => Promise<unknown>,
    after = 'Done.',
    refreshAfter = true
  ) {
    setBusy(label);
    setNote(null);
    try {
      await fn();
      setNote(after);
      if (refreshAfter) await refresh();
    } catch (e: any) {
      setNote(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  const connectors = extensions
    .filter((e) => !e.isPlatform && !isMicrosoft365Backend(e.configKey))
    .sort((a, b) => connectorDisplayOrder(a.configKey) - connectorDisplayOrder(b.configKey));
  const platformBuiltins = extensions.filter((e) => e.isPlatform);
  const builtins = [
    ...BUILT_IN_WORK_SOURCES,
    ...platformBuiltins.map((extension) => extension.name),
  ];

  return (
    <main className="main">
      <header className="topbar">
        <button
          className="icon-btn topbar-back"
          onClick={onBack}
          title="Back to Develop"
          aria-label="Back to Develop"
        >
          <BackIcon />
        </button>
        <div className="topbar-stack">
          <h1 className="topbar-title">Connectors &amp; Skills</h1>
          <span className="topbar-sub">
            {connectors.length} connector{connectors.length === 1 ? '' : 's'} · {skills.length} skills
            · {builtins.length} built-in
          </span>
        </div>
        <button
          className="ghost-btn"
          disabled={busy !== null}
          onClick={() =>
            run('import', async () => {
              const result: any = await window.host?.importMcpb?.();
              if (!result) return;
              if (result.error) throw new Error(result.error);
              onImport(result);
            }, '')
          }
        >
          {busy === 'import' ? 'Reading…' : 'Import .mcpb…'}
        </button>
        <button
          className="ghost-btn"
          disabled={busy !== null}
          onClick={() =>
            run('restart', async () => {
              const r = await window.host?.restartAgent?.();
              if (r && !r.ok) throw new Error(r.detail ?? 'restart failed');
              onAgentRestarted();
            }, 'Agent restarted — reconnecting now.')
          }
        >
          {busy === 'restart' ? 'Restarting…' : 'Restart agent'}
        </button>
      </header>

      <div className="manage">
        {note && <div className="manage-note">{note}</div>}

        <h2 className="manage-h">Connectors</h2>
        {connectors.length === 0 && <p className="manage-empty">No connectors configured.</p>}
        {connectors.map((e) => (
          <div key={e.configKey} className="row">
            <div className="row-main">
              <span className="row-title">
                {connectorDisplayName(e.configKey)}
                {!e.enabled && <em className="row-off"> disabled</em>}
              </span>
              <span className="row-detail">{e.detail}</span>
            </div>
            <div className="row-actions">
              <button
                className="dialog-btn"
                disabled={busy !== null}
                onClick={() =>
                  run(`cfg-${e.configKey}`, async () => {
                    const spec: any = await window.host?.getConnectorSpec?.(e.configKey);
                    const config: any = spec?.config ?? e.config ?? {};
                    const source = spec?.source ?? 'config';
                    setConfiguring({
                      request: {
                        id: -1,
                        kind: 'mcp',
                        name: e.configKey,
                        remote: config.type === 'streamable_http',
                        url: config.uri,
                        command: config.cmd,
                        args: config.args,
                        fields: spec?.fields ?? [],
                        description: spec?.description,
                        source,
                        config: sanitizedConfig(config),
                        configEditable:
                          source === 'mcpb' || source === 'link' || source === 'config',
                      },
                      values: spec?.values ?? {},
                    });
                  }, '')
                }
              >
                Configure
              </button>
              <button
                className="dialog-btn"
                disabled={busy !== null}
                title="Reconnect just this connector"
                onClick={() =>
                  run(
                    `restart-${e.configKey}`,
                    async () => {
                      const live = await agent!.listSessionExtensions();
                      const current = live.find(
                        (candidate) =>
                          candidate.name === e.configKey || candidate.name === e.name
                      );
                      if (!current) {
                        throw new Error(
                          `${connectorDisplayName(e.configKey)} is not active in this conversation.`
                        );
                      }
                      await agent!.removeSessionExtension(current.name);
                      await agent!.addSessionExtension(current.config);
                    },
                    `${connectorDisplayName(e.configKey)} reconnected.`
                  )
                }
              >
                Restart
              </button>
              <button
                className="dialog-btn"
                disabled={busy !== null}
                title="Forget credentials stored for this connector"
                onClick={() =>
                  run(
                    `logout-${e.configKey}`,
                    async () => {
                      const r = await window.host?.forgetSecrets?.(e.configKey);
                      if (r && !r.ok) throw new Error(r.detail ?? 'logout failed');
                    },
                    `Credentials for ${connectorDisplayName(e.configKey)} forgotten — Restart to apply.`
                  )
                }
              >
                Log out
              </button>
              <button
                className="dialog-btn"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    `toggle-${e.configKey}`,
                    async () => {
                      const enabled = !e.enabled;
                      const saved = await window.host?.setConnectorEnabled?.(e.configKey, enabled);
                      if (!saved?.ok) throw new Error(saved?.detail ?? 'could not update connector');
                      try {
                        const live = await agent!.listSessionExtensions();
                        const current = live.find(
                          (candidate) =>
                            candidate.name === e.configKey || candidate.name === e.name
                        );
                        if (enabled && !current) await agent!.addSessionExtension(e.config);
                        if (!enabled && current) await agent!.removeSessionExtension(current.name);
                      } catch (error) {
                        await window.host?.setConnectorEnabled?.(e.configKey, e.enabled);
                        throw error;
                      }
                    },
                    `${connectorDisplayName(e.configKey)} ${e.enabled ? 'disabled' : 'enabled'}.`
                  )
                }
              >
                {e.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                className="dialog-btn dialog-btn-danger"
                disabled={busy !== null}
                onClick={() =>
                  run(`rm-${e.configKey}`, async () => {
                    const live = await agent!.listSessionExtensions();
                    const current = live.find(
                      (candidate) => candidate.name === e.configKey || candidate.name === e.name
                    );
                    if (current) await agent!.removeSessionExtension(current.name);
                    const removed = await window.host?.removeConnector?.(e.configKey);
                    if (!removed?.ok) {
                      if (current) await agent!.addSessionExtension(current.config);
                      throw new Error(removed?.detail ?? 'could not remove connector');
                    }
                  })
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {(() => {
          const installed = new Set(extensions.map((e) => e.configKey));
          const open = bundled.filter((b) => !installed.has(b.name));
          if (!open.length) return null;
          return (
            <>
              <h2 className="manage-h">Add a connector that comes with Werkbank</h2>
              <p className="manage-empty">Each connector does one job. Add only the ones you need; they ask for their own settings, and all of them also work with the sample data.</p>
              {open.map((b) => (
                <div key={b.id} className="row">
                  <div className="row-main">
                    <span className="row-title">{b.title} <em className="row-off">{b.tools} tools</em></span>
                    <span className="row-detail">{b.description}</span>
                  </div>
                  <div className="row-actions">
                    <button
                      className="dialog-btn dialog-btn-primary"
                      disabled={busy !== null}
                      onClick={() => run(`add-${b.id}`, async () => {
                        const result: any = await window.host?.prepareConnector?.(b.id);
                        if (!result) return;
                        if (result.error) throw new Error(result.error);
                        onImport(result);
                      }, '')}
                    >
                      {busy === `add-${b.id}` ? 'Preparing…' : 'Add'}
                    </button>
                  </div>
                </div>
              ))}
            </>
          );
        })()}

        <h2 className="manage-h">Skills</h2>
        {skills.length === 0 && <p className="manage-empty">No skills installed.</p>}
        {skills.length > 0 && (
          <SkillGovernance
            skills={skills}
            renderRow={(s, extra) => (
              <div className="row">
                <div className="row-main">
                  <span className="row-title row-title-skill"><SkillIcon name={s.name} />{s.name}</span>
                  <span className="row-detail">{s.description}</span>
                </div>
                <div className="row-actions">
                  {extra}
                  <button
                    className="dialog-btn dialog-btn-danger"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`rm-skill-${s.dir}`, async () => {
                        const r = await window.host?.removeSkill?.(s.name);
                        if (r && !r.ok) throw new Error(r.detail ?? 'remove failed');
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          />
        )}

        {configuring && (
          <SkillInstallDialog
            configure
            request={configuring.request}
            initialValues={configuring.values}
            onDecide={(_id, approved, values, config) => {
              const name = configuring.request.name;
              setConfiguring(null);
              if (!approved) return;
              run(`save-${name}`, async () => {
                const r = await window.host?.saveConnectorConfig?.(name, values ?? {}, config);
                if (r && !r.ok) throw new Error(r.detail ?? 'save failed');
                const restarted = await window.host?.restartAgent?.();
                if (restarted && !restarted.ok) {
                  throw new Error(restarted.detail ?? 'agent restart failed');
                }
                onAgentRestarted();
              }, `${name} updated — agent restarted and is reconnecting.`, false);
            }}
          />
        )}

        <h2 className="manage-h">Built in</h2>
        <p className="manage-empty">
          {builtins.join(' · ') || '—'}
        </p>
      </div>
    </main>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13 8H3M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
