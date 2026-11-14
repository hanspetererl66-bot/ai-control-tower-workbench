import type { ReactNode } from 'react';

/**
 * The header of the Admin console screens: the black hero of the Ontology Manager (back button, a crumb, a headline whose second half is
 * highlighted, one line of explanation). Solution register and Skill Health Monitor use it too, so the three look the same.
 * The styles are the `om-hero` ones of theme.css; the tokens come from the screen's own class (`.om`, `.sa`, `.sh`).
 */
/** Back arrow for the round hero buttons: a drawn arrow with a heavy stroke (the "←" character is hairline in most fonts). */
export function BackArrow() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 10H4.5M9.5 4.5 4 10l5.5 5.5" /></svg>;
}

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
      {onBack && <button className="om-back" onClick={onBack} aria-label={backLabel}><BackArrow /></button>}
      <div className="om-hero-text">
        <p className="om-crumb">Admin console · {screen}</p>
        <h1>{lead} <span>{accent}</span></h1>
        {lede && <p className="om-lede">{lede}</p>}
      </div>
      {children && <div className="om-hero-side">{children}</div>}
    </header>
  );
}
