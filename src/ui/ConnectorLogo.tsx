import SourceLogo from './SourceLogo';
import { brandOf } from '../connector-brand';

/**
 * The mark in front of a connector's name (Connectors list, "Add a connector" list, sources under an answer).
 * Tools we have a drawing for get their mark, every other connector a neutral plug in the text colour. Decorative.
 */
export default function ConnectorLogo({ name, size = 18 }: { name: string; size?: number }) {
  const brand = brandOf(name);
  if (brand) return <SourceLogo id={brand} size={size} />;
  return (
    <span className="sx-logo cl-plain" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3" />
      </svg>
    </span>
  );
}
