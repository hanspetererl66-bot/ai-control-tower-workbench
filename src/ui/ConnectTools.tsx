import { useState } from 'react';
import type { Agent } from '../acp';
import { TOOL_CARDS, cardState, checkToolName, readCheck, type CheckOutcome, type ToolId } from '../connect-tools';

/**
 * "Connect your tools": Jira, Slack and Linear as cards with logo, status and a connection test.
 * The test calls the connector's own `<tool>_check_connection`; it reads only.
 */
export function ConnectTools({ agent, extensions, busy, onConfigure }: {
  agent: Agent | null;
  extensions: { configKey: string; enabled: boolean }[];
  busy: boolean;
  onConfigure: (configKey: string) => void;
}) {
  const [testing, setTesting] = useState<ToolId | null>(null);
  const [outcome, setOutcome] = useState<Partial<Record<ToolId, CheckOutcome>>>({});

  async function test(id: ToolId, configKey: string) {
    if (!agent) return;
    setTesting(id);
    try {
      const answer = readCheck(await agent.callTool(checkToolName(id, configKey)));
      setOutcome((o) => ({ ...o, [id]: answer }));
    } catch (e: any) {
      const answer = readCheck({ isError: true, content: [{ text: e?.message ?? String(e) }] });
      setOutcome((o) => ({ ...o, [id]: answer }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <section className="ct-cards" aria-label="Connect your tools">
      <h2 className="manage-h" id="manage-connect-tools">Connect your tools</h2>
      <p className="manage-empty">Where your requirements live. Everything is read first; a change to Jira, Slack or Linear happens only after you confirmed it.</p>
      <div className="ct-grid">
        {TOOL_CARDS.map((card) => {
          const { state, configKey } = cardState(card.id, extensions);
          const result = outcome[card.id];
          const dot = result ? (result.ok ? 'ok' : 'bad') : state === 'connected' ? 'idle' : 'off';
          const label = result ? (result.ok ? 'Connection works' : 'Connection failed')
            : state === 'connected' ? 'Added, not tested' : state === 'off' ? 'Added, switched off' : 'Not added yet';
          return (
            <article key={card.id} className="ct-card" data-tool={card.id}>
              <header className="ct-head">
                <span className="ct-logo" aria-hidden="true"><ToolLogo id={card.id} /></span>
                <div className="ct-title">
                  <h3>{card.name}</h3>
                  <span className="ct-status"><i className={`ct-dot ct-dot-${dot}`} aria-hidden="true" />{label}</span>
                </div>
              </header>
              <p className="ct-line"><b>Reads</b> {card.reads}</p>
              <p className="ct-line"><b>Writes</b> {card.writes}</p>
              <p className="ct-line ct-key"><b>Key</b> {card.key}</p>
              {result && <p className={`ct-result ct-result-${result.ok ? 'ok' : 'bad'}`} role="status">{result.text}</p>}
              {state === 'not-added' && <p className="ct-line ct-cmd">Add it with <code>{card.addCommand}</code>, then restart the app.</p>}
              <div className="ct-actions">
                {configKey && (
                  <button className="dialog-btn" disabled={busy} onClick={() => onConfigure(configKey)}>Enter key</button>
                )}
                {configKey && (
                  <button className="dialog-btn dialog-btn-primary" disabled={busy || testing !== null || !agent || state === 'off'} onClick={() => test(card.id, configKey)}
                    title={state === 'off' ? 'Switch the connector on first' : 'Calls the read-only connection check of the connector'}>
                    {testing === card.id ? 'Testing…' : 'Test connection'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Simplified marks of the three products, in their brand colours (a logo is the one place where colours are not tokens). */
export function ToolLogo({ id }: { id: ToolId }) {
  if (id === 'jira') {
    return (
      <svg viewBox="0 0 32 32" width="32" height="32">
        <path d="M16 2 28 14a1.4 1.4 0 0 1 0 2l-5 5-7-7-7 7-5-5a1.4 1.4 0 0 1 0-2z" fill="#2684FF" />
        <path d="M16 12l7 7-7 7-7-7z" fill="#0052CC" />
      </svg>
    );
  }
  if (id === 'slack') {
    return (
      <svg viewBox="0 0 32 32" width="32" height="32">
        <rect x="13" y="3" width="6" height="12" rx="3" fill="#36C5F0" />
        <rect x="17" y="13" width="12" height="6" rx="3" fill="#2EB67D" />
        <rect x="13" y="17" width="6" height="12" rx="3" fill="#ECB22E" />
        <rect x="3" y="13" width="12" height="6" rx="3" fill="#E01E5A" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="14" fill="#5E6AD2" />
      <path d="M6.5 19.5 12.5 25.5M5.6 15.2 16.8 26.4M8 10.8 21.2 24M11.5 7.6 24.4 20.5M16.5 5.6 26.4 15.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" fill="none" />
    </svg>
  );
}
