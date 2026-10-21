import { useMemo } from 'react';
import controlTowerData from '../../examples/control-tower/data.json';
import { buildBriefing, type BriefingAction, type BriefingData } from '../briefing';

type Props = {
  disabled: boolean;
  /** Connector installed? The "ask" actions need it; opening a Space does not. */
  canAsk: boolean;
  onOpen: (target: { space: string; tab?: string }) => void;
  onAsk: (prompt: string, connector?: string) => void;
};

/** Proactive cards on the empty chat: what needs attention today, one click from the answer. */
export default function BriefingCards({ disabled, canAsk, onOpen, onAsk }: Props) {
  const cards = useMemo(() => buildBriefing(controlTowerData as unknown as BriefingData), []);
  if (cards.length === 0) return null;

  const run = (action: BriefingAction) => {
    if (action.kind === 'open') onOpen({ space: action.space, tab: action.tab });
    else onAsk(action.prompt, action.connector);
  };

  return (
    <section className="briefing" aria-label="Heute für dich">
      <div className="briefing-title">Heute für dich</div>
      <div className="briefing-grid">
        {cards.map((card) => (
          <article key={card.id} className={`briefing-card briefing-${card.tone}`}>
            <h3>{card.title}</h3>
            <p>{card.detail}</p>
            <div className="briefing-actions">
              {card.actions.map((action) => (
                <button
                  key={action.label}
                  className="briefing-action"
                  disabled={action.kind === 'ask' && (disabled || !canAsk)}
                  onClick={() => run(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
