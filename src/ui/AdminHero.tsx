import type { ReactNode } from 'react';

/**
 * The header of the Admin console screens: the black hero of the Ontology Manager (back button, a crumb, a headline whose second half is
 * highlighted, one line of explanation). Solution register and Skill Health Monitor use it too, so the three look the same.
 * The styles are the `om-hero` ones of theme.css; the tokens come from the screen's own class (`.om`, `.sa`, `.sh`).
 */
export default function AdminHero({ screen, lead, accent, lede, onBack, backLabel = 'Back to the Admin console', children }: {
  /** The name of the screen, shown after "Admin console" in the crumb, so the headline can say what the screen is for. */
  screen: string;
  lead: string;
  accent: string;
  lede?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  /** Something that sits at the right of the text (a ring, a refresh button). */
  children?: ReactNode;
}) {
  return (
    <header className={`om-hero${onBack ? '' : ' om-hero-noback'}${children ? ' om-hero-extra' : ''}`}>
      {onBack && <button className="om-back" onClick={onBack} aria-label={backLabel}>←</button>}
      <div className="om-hero-text">
        <p className="om-crumb">Admin console · {screen}</p>
        <h1>{lead} <span>{accent}</span></h1>
        {lede && <p className="om-lede">{lede}</p>}
      </div>
      {children && <div className="om-hero-side">{children}</div>}
    </header>
  );
}
