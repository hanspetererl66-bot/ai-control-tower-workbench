import { useState } from 'react';
import type { Agent } from '../acp';
import BrandMark from './BrandMark';
import { TOOL_CARDS, cardState, checkToolName, readCheck, type CheckOutcome, type ToolId } from '../connect-tools';

/**
 * "Connect your tools": Jira, Slack, Linear, Figma, Notion and Microsoft Teams as cards with logo, status and a connection test.
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
      <p className="manage-empty">Where your requirements live. Everything is read first; a change to Jira, Slack or Linear happens only after you confirmed it, and Figma is read only.</p>
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

/** The card's mark: the hand-drawn mark of the tool (see BrandMark), in the 32 px box of the card. */
export function ToolLogo({ id }: { id: ToolId }) {
  return <span style={{ display: 'inline-grid', width: 32, height: 32 }}><BrandMark id={id} /></span>;
}
