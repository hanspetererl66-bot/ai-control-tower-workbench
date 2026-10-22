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
  /** The person's own starter prompts and favourite skills (settings). Sent without forcing a connector. */
  own?: StarterPrompt[];
  favorites?: StarterPrompt[];
  onPickOwn?: (prompt: StarterPrompt) => void;
};

/** Suggested Control Tower questions below the composer on an empty chat. */
export default function StarterPrompts({ available, disabled, onPick, onInstall, onManage, own = [], favorites = [], onPickOwn }: Props) {
  const mine = own.length || favorites.length ? (
    <div className="starters" role="group" aria-label="Your starters and favourite skills">
      {own.length > 0 && <div className="starters-title">My prompts</div>}
      {own.length > 0 && (
        <div className="starters-list">
          {own.map((starter) => (
            <button key={`own-${starter.label}`} className="starter" disabled={disabled} title={starter.prompt} onClick={() => onPickOwn?.(starter)}>{starter.label}</button>
          ))}
        </div>
      )}
      {favorites.length > 0 && <div className="starters-title">Favourite skills</div>}
      {favorites.length > 0 && (
        <div className="starters-list">
          {favorites.map((starter) => (
            <button key={`fav-${starter.label}`} className="starter" disabled={disabled} title={starter.prompt} onClick={() => onPickOwn?.(starter)}>{starter.label}</button>
          ))}
        </div>
      )}
    </div>
  ) : null;
  if (available === null) return mine;

  if (!available) {
    return (
      <>
      {mine}
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
      </>
    );
  }

  return (
    <>
    {mine}
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
    </>
  );
}
