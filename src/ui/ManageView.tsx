import ConnectorLogo from './ConnectorLogo';
import { isLiveConnector } from '../connector-activity';
import { useCallback, useEffect, useState } from 'react';
import type { Agent, Extension } from '../acp';
import {
  BUILT_IN_WORK_SOURCES,
  connectorDisplayName,
  connectorDisplayOrder,
  isMicrosoft365Backend,
} from '../connector-presentation';
import { listSkills, type Skill } from '../skills';
import { skillNotice } from '../skill-notice';
import SkillIcon from './SkillIcon';
import SkillGovernance from './SkillGovernance';
import { ConnectTools } from './ConnectTools';
import SkillImportDialog, { type ImportPreview } from './SkillImportDialog';
import { exportBlocker, reviewPackage } from '../skill-package';
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
  focus,
  liveConnectors = [],
}: {
  agent: Agent | null;
  onBack: () => void;
  onAgentRestarted: () => void;
  onImport: (request: Record<string, unknown>) => void;
  /** Which part to scroll to when the page opens (from the Develop tiles). */
  focus?: 'skills' | 'connectors';
  /** Normalised names of the connectors the agent is using right now (see connector-activity.ts). */
  liveConnectors?: string[];
}) {
  // Opened from a Develop tile: show only that part. Without a focus (other entry points) both parts are shown.
  const showConnectors = focus !== 'skills';
  const showSkills = focus !== 'connectors';
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => { if (focus) document.getElementById(`manage-${focus}`)?.scrollIntoView({ block: 'start' }); }, [focus]);
  const [bundled, setBundled] = useState<{ id: string; name: string; title: string; description: string; tools: number; needsSetup: boolean }[]>([]);
  useEffect(() => { void window.host?.listBundledConnectors?.().then((list) => setBundled(list ?? [])); }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [importing, setImporting] = useState<ImportPreview | null>(null);
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
  useEffect(() => window.host?.onSkillsSynced?.(() => { void refresh(); }), [refresh]);

  async function run(
    label: string,
    fn: () => Promise<unknown>,
    after = 'Done.',
    refreshAfter = true
  ) {
    setBusy(label);
    setNote(null);
    try {
      const result = await fn();
      setNote(typeof result === 'string' ? result : after);
      if (refreshAfter) await refresh();
    } catch (e: any) {
      setNote(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  function openConfigure(e: Extension) {
    return run(`cfg-${e.configKey}`, async () => {
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
    }, '');
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
          <h1 className="topbar-title">{focus === 'skills' ? 'Skills' : focus === 'connectors' ? 'Connectors' : 'Connectors & Skills'}</h1>
          <span className="topbar-sub">
            {focus === 'skills'
              ? `${skills.length} skill${skills.length === 1 ? '' : 's'}`
              : focus === 'connectors'
                ? `${connectors.length} connector${connectors.length === 1 ? '' : 's'} · ${builtins.length} built-in`
                : `${connectors.length} connector${connectors.length === 1 ? '' : 's'} · ${skills.length} skills · ${builtins.length} built-in`}
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
        {showSkills && window.host?.importSkillOpen && (
          <button
            className="ghost-btn"
            disabled={busy !== null}
            onClick={() =>
              run('import-skill', async () => {
                const r = await window.host?.importSkillOpen?.();
                if (!r) return;
                if (!r.ok) throw new Error(r.detail ?? 'Could not read the skill package.');
                setImporting({ id: r.id!, slug: r.slug!, name: r.name!, description: r.description ?? '', files: r.files ?? [], text: r.text ?? '', exists: Boolean(r.exists) });
              }, '', false)
            }
          >
            {busy === 'import-skill' ? 'Reading…' : 'Import skill…'}
          </button>
        )}
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

        {importing && (
          <SkillImportDialog
            preview={importing}
            busy={busy === 'install-skill'}
            onCancel={() => setImporting(null)}
            onInstall={(overwrite) =>
              run('install-skill', async () => {
                const r = await window.host?.importSkillInstall?.(importing.id, overwrite);
                if (!r?.ok) throw new Error(r?.detail ?? 'Install failed.');
                setImporting(null);
                const where = r.db?.ok ? 'Stored in the shared database at the level Individual.' : `Not stored in the shared database${r.db?.detail ? `: ${r.db.detail}` : '.'}`;
                return `Skill “${importing.name}” installed. ${where} Restart the agent so it picks it up.`;
              })
            }
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

        {showConnectors && (
          <>
        <ConnectTools agent={agent} extensions={extensions} busy={busy !== null} onConfigure={(key) => { const ext = extensions.find((x) => x.configKey === key); if (ext) openConfigure(ext); }} />
        <h2 className="manage-h" id="manage-connectors">Connectors</h2>
        {connectors.length === 0 && <p className="manage-empty">No connectors configured.</p>}
        {connectors.map((e) => (
          <div key={e.configKey} className={`row${isLiveConnector(liveConnectors, e.configKey) ? ' conn-live' : ''}`} data-live={isLiveConnector(liveConnectors, e.configKey) ? 'true' : undefined}>
            <div className="row-main">
              <span className="row-title">
                <ConnectorLogo name={e.configKey} />
                {connectorDisplayName(e.configKey)}
                {!e.enabled && <em className="row-off"> disabled</em>}
                {isLiveConnector(liveConnectors, e.configKey) && <em className="row-live" role="status"> in use</em>}
              </span>
              <span className="row-detail">{e.detail}</span>
            </div>
            <div className="row-actions">
              <button
                className="dialog-btn"
                disabled={busy !== null}
                onClick={() => openConfigure(e)}
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
                    <span className="row-title"><ConnectorLogo name={b.name} />{b.title} <em className="row-off">{b.tools} tools</em></span>
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

          </>
        )}

        {showSkills && (
          <>
        <h2 className="manage-h" id="manage-skills">Skills</h2>
        {skills.length === 0 && <p className="manage-empty">No skills installed.</p>}
        {skills.length > 0 && (
          <SkillGovernance
            skills={skills}
            renderRow={(s, extra) => (
              <div className="row">
                <div className="row-main">
                  <span className="row-title row-title-skill skill-name"><SkillIcon name={s.name} />{s.name}</span>
                  <span className="row-detail">{s.description}</span>
                  {(() => { const n = skillNotice(s); return n ? <span className={`skill-notice skill-notice-${n.state}`}>{n.text}</span> : null; })()}
                </div>
                <div className="row-actions">
                  {extra}
                  {window.host?.duplicateSkill && (
                    <button
                      className="dialog-btn dup-btn"
                      disabled={busy !== null}
                      title="Make an editable copy of this skill (a new local skill)"
                      onClick={() =>
                        run(`dup-skill-${s.dir}`, async () => {
                          const r = await window.host?.duplicateSkill?.(s.dir);
                          if (!r?.ok) throw new Error(r?.detail ?? 'Duplicate failed.');
                          return `Created "${r.slug}". Restart the agent to use it.`;
                        }, 'Done.', true)
                      }
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 3.5v-.4A1.6 1.6 0 0 0 8.9 1.5H3.6A1.6 1.6 0 0 0 2 3.1v5.3a1.6 1.6 0 0 0 1.6 1.6h.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                      Duplicate
                    </button>
                  )}
                  {window.host?.exportSkill && (
                    <button
                      className="dialog-btn"
                      disabled={busy !== null}
                      title="Save this skill as a .zip you can hand to others"
                      onClick={() =>
                        run(`export-skill-${s.dir}`, async () => {
                          const info = await window.host?.skillPackInfo?.(s.dir);
                          if (!info?.ok) throw new Error(info?.detail ?? 'Could not read the skill.');
                          const blocked = exportBlocker(reviewPackage(info.text ?? ''));
                          if (blocked) throw new Error(blocked);
                          const r = await window.host?.exportSkill?.(s.dir);
                          if (r?.canceled) return;
                          if (!r?.ok) throw new Error(r?.detail ?? 'Export failed.');
                          return `Exported ${r.files} file${r.files === 1 ? '' : 's'} to ${r.path}`;
                        }, 'Done.', false)
                      }
                    >
                      Export
                    </button>
                  )}
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


          </>
        )}

        {showConnectors && (
          <>
        <h2 className="manage-h">Built in</h2>
        <p className="manage-empty">
          {builtins.join(' · ') || '—'}
        </p>
          </>
        )}
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
