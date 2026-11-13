import { useEffect, useState } from 'react';

type Config = { configured: boolean; source: string; baseUrl: string; tokenSet: boolean; adapter: string };

/**
 * Address and read token of the monitoring access. The token is typed in, sent to the main process and forgotten here:
 * the panel never receives it back, only whether one is saved. The text says that the token may only read.
 */
export default function MonitoringPanel() {
  const host = window.host;
  const [config, setConfig] = useState<Config | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void host?.monitoringConfigGet?.().then((r) => {
      if (!live || !r) return;
      if (r.ok) { setConfig(r.data); setBaseUrl(r.data.baseUrl); } else setMessage(r.error);
    });
    return () => { live = false; };
  }, [host]);

  if (!host?.monitoringConfigGet) {
    return <div className="settings-section"><div className="settings-section-copy"><h4>Monitoring</h4><p>The monitoring connection can be set in the desktop app.</p></div></div>;
  }

  const status = !config ? 'Reading the settings …'
    : config.source === 'app' ? `Connected to ${config.baseUrl}. A token is saved.`
    : config.source === 'environment' ? 'Set through the environment variables MONITORING_BASE_URL and MONITORING_READ_TOKEN of the app.'
    : 'Not connected.';

  async function run(action: () => Promise<{ ok: true; data: any } | { ok: false; error: string } | undefined>, done: (data: any) => string) {
    setBusy(true); setMessage('');
    try {
      const r = await action();
      if (!r) setMessage('No answer from the app.');
      else if (r.ok) setMessage(done(r.data)); else setMessage(r.error);
    } finally { setBusy(false); }
  }

  return (
    <div className="settings-section settings-monitoring">
      <div className="settings-section-copy">
        <h4>Monitoring (read only)</h4>
        <p>
          The Alerts Space can load live alerts from your monitoring. Give it the address and a token that <b>may only read</b>.
          The token is stored encrypted in the keychain of this computer. It is never shown again and never sent to a Space, the chat or the assistant.
        </p>
      </div>
      <p className="voice-message" role="status">{status}</p>
      <label className="voice-option">
        <span>Address (https)</span>
        <input className="voice-key" type="url" value={baseUrl} placeholder="https://monitoring.example/api" autoComplete="off" spellCheck={false}
          onChange={(e) => setBaseUrl(e.target.value)} aria-label="Monitoring address" />
      </label>
      <div className="voice-row">
        <input className="voice-key" type="password" value={token} autoComplete="off" spellCheck={false}
          placeholder={config?.tokenSet ? 'Token saved — paste a new one to replace it' : 'Read-only token'}
          onChange={(e) => setToken(e.target.value)} aria-label="Monitoring read token" />
      </div>
      <div className="voice-row">
        <button className="ghost-btn" disabled={busy || !baseUrl.trim() || (!token.trim() && !config?.tokenSet)}
          onClick={() => run(async () => { const r = await host.monitoringConfigSet?.(baseUrl, token); setToken(''); return r; }, (d) => { setConfig(d); return 'Saved.'; })}>Save</button>
        <button className="ghost-btn" disabled={busy || !config?.configured}
          onClick={() => run(async () => host.monitoringConfigTest?.(), (d) => `The connection works: ${d.count} alert${d.count === 1 ? '' : 's'} in the last hour.`)}>Test the connection</button>
        {config?.source === 'app' && (
          <button className="ghost-btn" disabled={busy}
            onClick={() => run(async () => host.monitoringConfigClear?.(), (d) => { setConfig(d); setBaseUrl(''); setToken(''); return 'Removed.'; })}>Remove</button>
        )}
      </div>
      {message && <p className="voice-message" role="status">{message}</p>}
    </div>
  );
}
