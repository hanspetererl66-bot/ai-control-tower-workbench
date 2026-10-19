import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type Settings = { url: string; chatConnected: boolean };

/**
 * n8n Cloud inside the app. The page itself is a native view managed by the main process
 * (own session, navigation limited to the instance); this component only tells it where to sit.
 */
export default function N8nView({
  visible,
  theme,
  onRestartAgent,
}: {
  /** False while a dialog is open: a native view would paint over it. */
  visible: boolean;
  /** The app's resolved theme; n8n is shown in the same one. */
  theme: 'light' | 'dark';
  /** Called after the chat connection changed, so goose reloads its extensions. */
  onRestartAgent: () => Promise<void> | void;
}) {
  const host = window.host?.n8n;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void host?.getSettings().then(setSettings).catch(() => setSettings({ url: '', chatConnected: false }));
  }, [host]);

  useEffect(() => {
    void host?.setTheme(theme);
  }, [host, theme]);

  const showing = Boolean(host && settings?.url && !editing && visible);

  useLayoutEffect(() => {
    if (!host) return;
    if (!showing) {
      void host.hide();
      return;
    }
    const element = slot.current;
    if (!element) return;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = element.getBoundingClientRect();
        void host.show({ x: box.left, y: box.top, width: box.width, height: box.height });
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', place);
      void host.hide();
    };
  }, [host, showing, settings?.url]);

  async function save() {
    if (!host) return;
    setBusy(true);
    setMessage('');
    const result = await host.saveSettings(draft);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.detail ?? 'Speichern fehlgeschlagen.');
      return;
    }
    setSettings({ url: result.url ?? '', chatConnected: result.chatConnected ?? false });
    setEditing(false);
  }

  async function toggleChat() {
    if (!host || !settings) return;
    setBusy(true);
    setMessage('');
    const result = settings.chatConnected ? await host.disconnectChat() : await host.connectChat();
    if (!result.ok) {
      setBusy(false);
      setMessage(result.detail ?? 'Verbindung fehlgeschlagen.');
      return;
    }
    await onRestartAgent();
    const next = await host.getSettings();
    setSettings(next);
    setBusy(false);
    setMessage(
      next.chatConnected
        ? 'Chat ist mit n8n verbunden. Beim ersten Zugriff fragt n8n im Browser nach deiner Freigabe (OAuth).'
        : 'Verbindung zum Chat getrennt.'
    );
  }

  if (!host) {
    return (
      <main className="main n8n-main">
        <div className="empty">
          <h2 className="empty-title">n8n</h2>
          <p className="disclaimer">Die n8n-Ansicht gibt es nur in der Desktop-App.</p>
        </div>
      </main>
    );
  }

  const needsUrl = settings !== null && (!settings.url || editing);

  return (
    <main className="main n8n-main">
      <header className="n8n-bar">
        <h1 className="topbar-title">n8n</h1>
        {settings?.url && !editing && <span className="n8n-host">{new URL(settings.url).host}</span>}
        <span className="composer-spacer" />
        {settings?.url && !editing && (
          <>
            <button className="ghost-btn" onClick={() => void host.reload()}>
              Neu laden
            </button>
            <button className="ghost-btn" disabled={busy} onClick={() => void toggleChat()}>
              {settings.chatConnected ? 'Chat-Verbindung trennen' : 'Mit Chat verbinden'}
            </button>
            <button
              className="ghost-btn"
              onClick={() => {
                setDraft(settings.url);
                setEditing(true);
              }}
            >
              Adresse ändern
            </button>
          </>
        )}
      </header>
      {message && (
        <p className="n8n-message" role="status">
          {message}
        </p>
      )}
      {needsUrl ? (
        <div className="n8n-setup">
          <h2>n8n Cloud verbinden</h2>
          <p>
            Trage die Adresse deiner n8n-Cloud-Instanz ein, zum Beispiel <code>firma.app.n8n.cloud</code>. Die
            Anmeldung läuft direkt bei n8n; es wird kein Passwort und kein Token von uns gespeichert.
          </p>
          <div className="voice-row">
            <input
              className="voice-key"
              value={draft}
              placeholder="https://firma.app.n8n.cloud"
              spellCheck={false}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void save()}
              aria-label="n8n-Adresse"
            />
            <button className="ghost-btn" disabled={busy || !draft.trim()} onClick={() => void save()}>
              Speichern
            </button>
            {editing && (
              <button className="ghost-btn" onClick={() => setEditing(false)}>
                Abbrechen
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="n8n-slot" ref={slot} aria-label="n8n" />
      )}
    </main>
  );
}
