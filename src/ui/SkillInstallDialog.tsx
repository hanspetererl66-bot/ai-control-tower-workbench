import { PRODUCT_TITLE } from '../product';
import { useState } from 'react';

export type ConfigField = {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
  sensitive?: boolean;
  /** True when this connector already has a value in the OS keychain. */
  stored?: boolean;
  default?: string;
};

export type InstallRequest = {
  id: number;
  kind?: 'mcp';
  name: string;
  origin?: string;
  // skill
  slug?: string;
  // mcp
  remote?: boolean;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  fields?: ConfigField[];
  description?: string;
  source?: 'mcpb' | 'link' | 'example' | 'config';
  /** Sanitized effective Goose config; editable only for trusted install sources. */
  config?: unknown;
  configEditable?: boolean;
};

/** One dialog for both flows: "here is exactly what will happen, approve it". */
export default function SkillInstallDialog({
  request,
  onDecide,
  configure = false,
  initialValues,
}: {
  request: InstallRequest;
  onDecide: (
    id: number,
    approved: boolean,
    values?: Record<string, string>,
    config?: unknown
  ) => void;
  /** Editing an installed connector rather than approving a new one. */
  configure?: boolean;
  initialValues?: Record<string, string>;
}) {
  const isMcp = request.kind === 'mcp';
  const fields = request.fields ?? [];
  const configJson = configure && request.config ? JSON.stringify(request.config, null, 2) : '';
  const configEditable = configure && request.configEditable === true;
  const scrollable = fields.length > 0 || Boolean(configJson);
  const sourceLabel =
    request.source === 'mcpb'
      ? '.mcpb manifest'
      : request.source === 'link'
        ? 'Install link'
        : request.source === 'example'
          ? `${PRODUCT_TITLE} definition`
          : 'Goose config';

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initialValues?.[f.key] ?? f.default ?? '']))
  );
  const [configText, setConfigText] = useState(configJson);
  let parsedConfig: unknown;
  let configError = '';
  if (configEditable) {
    try {
      parsedConfig = JSON.parse(configText);
      if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
        configError = 'Configuration must be a JSON object.';
      }
    } catch (error: any) {
      configError = error?.message ?? 'Invalid JSON.';
    }
  }

  // When reconfiguring, a blank secret means "keep what is stored", so it is
  // not treated as missing. A missing keychain value must still block Save.
  const missing = fields.filter(
    (f) =>
      f.required &&
      !values[f.key]?.trim() &&
      !(configure && f.sensitive && f.stored)
  );

  const rows: [string, string][] = isMcp
    ? [
        ['Connector', request.name],
        request.remote
          ? ['Endpoint', request.url ?? '']
          : ['Runs', [request.command, ...(request.args ?? [])].join(' ')],
        ...(request.description ? ([['About', request.description]] as [string, string][]) : []),
        ...(configure ? ([['Settings from', sourceLabel]] as [string, string][]) : []),
      ]
    : [
        ['Repository', request.slug ?? ''],
        ['Skill', request.name],
        ['Requested by', request.origin ?? 'unknown'],
      ];

  return (
    <div className="scrim">
      <div
        className={`dialog${configure && configJson ? ' dialog-wide' : ''}${scrollable ? ' dialog-scrollable' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={configure ? 'Configure connector' : 'Install'}
      >
        <div className="dialog-head">
          <h3 className="dialog-title">
            {configure
              ? `Configure “${request.name}”`
              : isMcp
                ? `Add connector “${request.name}”?`
                : `Install skill “${request.name}”?`}
          </h3>
          <p className="dialog-body">
            {configure
              ? fields.length > 0
                ? request.source === 'mcpb'
                  ? 'These settings come from the bundle manifest. You can also edit the effective MCP JSON below. Leave a password blank to keep the one already stored.'
                  : 'Values are applied on save. Leave a password blank to keep the one already stored.'
                : configEditable
                  ? 'Edit the effective MCP JSON below. Changes are validated before they are saved. Secret environment values are moved to the OS keychain.'
                  : 'This connector declares no editable settings. Its effective Goose configuration is shown below.'
              : isMcp
                ? 'This connector runs on your machine and can act on whatever it connects to. Only add connectors you trust.'
                : 'A skill is a set of instructions the agent will follow. Only install skills from repositories you trust.'}
          </p>

          <dl className="kv">
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="dialog-scroll-content">
          {fields.length > 0 && (
            <div className="fields">
              {configure && (
                <h4 className="dialog-section-title">
                  {request.source === 'mcpb' ? 'Bundle settings (.mcpb)' : 'Connector settings'}
                </h4>
              )}
              {fields.map((f) => (
                <label key={f.key} className="field">
                  <span className="field-label">
                    {f.title}
                    {f.required && <em className="field-req"> required</em>}
                    {f.sensitive && (
                      <em className={`field-secret${configure && !f.stored ? ' field-secret-missing' : ''}`}>
                        {' '}
                        {configure
                          ? f.stored
                            ? 'stored in keychain'
                            : 'not stored — required'
                          : 'keychain-encrypted'}
                      </em>
                    )}
                  </span>
                  {f.description && <span className="field-hint">{f.description}</span>}
                  <input
                    type={f.sensitive ? 'password' : 'text'}
                    value={values[f.key] ?? ''}
                    placeholder={
                      configure && f.sensitive && f.stored
                        ? 'Stored securely — leave blank to keep'
                        : undefined
                    }
                    autoComplete={f.sensitive ? 'new-password' : 'off'}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}

          {configJson && (
            <details className="config-json" open={fields.length === 0}>
              <summary>
                Effective Goose configuration (JSON){configEditable ? ' — editable' : ''}
              </summary>
              {configEditable ? (
                <textarea
                  className="config-json-editor"
                  aria-label="Editable MCP configuration JSON"
                  value={configText}
                  spellCheck={false}
                  onChange={(event) => setConfigText(event.target.value)}
                />
              ) : (
                <pre>{configJson}</pre>
              )}
              {configError && <p className="config-json-error">Invalid JSON: {configError}</p>}
              <p>
                Credential-shaped values are redacted. New secret environment values are stored in
                the keychain, not config.yaml.
              </p>
              {request.source === 'mcpb' && fields.length > 0 && (
                <p>Bundle fields above override their matching environment values when saved.</p>
              )}
            </details>
          )}
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn" onClick={() => onDecide(request.id, false)}>
            {configure && fields.length === 0 && !configEditable ? 'Close' : 'Cancel'}
          </button>
          {(!configure || fields.length > 0 || configEditable) && (
            <button
              className="dialog-btn dialog-btn-primary"
              disabled={missing.length > 0 || Boolean(configError)}
              title={
                missing.length
                  ? `Fill in: ${missing.map((f) => f.title).join(', ')}`
                  : configError || undefined
              }
              onClick={() => onDecide(request.id, true, values, parsedConfig)}
            >
              {configure ? 'Save' : isMcp ? 'Add connector' : 'Install'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
