import type { StarterPrompt } from '../starter-prompts';

type Props = {
  disabled: boolean;
  /** The person's own starter prompts and favourite skills (settings). Sent without forcing a connector. */
  own?: StarterPrompt[];
  favorites?: StarterPrompt[];
  onPickOwn?: (prompt: StarterPrompt) => void;
};

/** The person's own prompts and favourite skills below the composer on an empty chat. Nothing is suggested by default. */
export default function StarterPrompts({ disabled, own = [], favorites = [], onPickOwn }: Props) {
  if (!own.length && !favorites.length) return null;
  return (
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
  );
}
