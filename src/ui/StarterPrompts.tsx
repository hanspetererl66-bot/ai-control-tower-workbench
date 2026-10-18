import { STARTER_PROMPTS, type StarterPrompt } from '../starter-prompts';

type Props = {
  /** null while the list of connectors is still loading. */
  available: boolean | null;
  disabled: boolean;
  onPick: (prompt: StarterPrompt) => void;
  /** Stage the bundled connector for installation (opens the approve dialog). */
  onInstall?: () => void;
  /** Open the connector management view. */
  onManage?: () => void;
};

/** Suggested Control Tower questions below the composer on an empty chat. */
export default function StarterPrompts({ available, disabled, onPick, onInstall, onManage }: Props) {
  if (available === null) return null;

  if (!available) {
    return (
      <div className="starters starters-hint">
        <span>Der Connector „AI Control Tower“ fehlt oder ist nicht verbunden.</span>
        {onInstall && (
          <button className="starters-link" onClick={onInstall}>
            Jetzt installieren
          </button>
        )}
        {onManage && (
          <button className="starters-link" onClick={onManage}>
            Connectors verwalten
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
