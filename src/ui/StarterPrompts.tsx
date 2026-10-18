import { STARTER_PROMPTS, type StarterPrompt } from '../starter-prompts';

type Props = {
  /** null while the list of connectors is still loading. */
  available: boolean | null;
  disabled: boolean;
  onPick: (prompt: StarterPrompt) => void;
  onSetUp?: () => void;
};

/** Suggested Control Tower questions below the composer on an empty chat. */
export default function StarterPrompts({ available, disabled, onPick, onSetUp }: Props) {
  if (available === null) return null;

  if (!available) {
    return (
      <div className="starters starters-hint">
        <span>Ask about risks, agents and budget once the AI Control Tower connector is installed.</span>
        {onSetUp && (
          <button className="starters-link" onClick={onSetUp}>
            Set up connector
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="starters" role="group" aria-label="Suggested questions about the AI Control Tower">
      <div className="starters-title">AI Control Tower</div>
      <div className="starters-list">
        {STARTER_PROMPTS.map((starter) => (
          <button
            key={starter.label}
            className="starter"
            disabled={disabled}
            title={starter.prompt}
            onClick={() => onPick(starter)}
          >
            {starter.label}
          </button>
        ))}
      </div>
    </div>
  );
}
