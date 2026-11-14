import { ToolLogo } from './ConnectTools';
import type { SourceKind } from '../requirements';

/**
 * The mark of a requirement source (Requirement collection): the four marks of the Connectors page, plus Microsoft Teams and Notion.
 * Simplified shapes in brand colours (a logo is the one place where colours are not tokens); decorative, the name always stands next to it.
 */
export default function SourceLogo({ id, size = 20 }: { id: SourceKind; size?: number }) {
  const inner =
    id === 'teams' ? (
      <svg viewBox="0 0 32 32" width="100%" height="100%">
        <rect x="2" y="6" width="22" height="20" rx="4" fill="#5059C9" />
        <circle cx="25" cy="10" r="3.5" fill="#7B83EB" />
        <rect x="19" y="13" width="11" height="12" rx="3" fill="#7B83EB" />
        <path d="M8 12h10M13 12v10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      </svg>
    ) : id === 'notion' ? (
      <svg viewBox="0 0 32 32" width="100%" height="100%">
        <rect x="4" y="4" width="24" height="24" rx="4" fill="#fff" stroke="#1f1f1f" strokeWidth="2" />
        <path d="M11 22V10l10 12V10" stroke="#1f1f1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ) : (
      <ToolLogo id={id} />
    );
  return <span className="sx-logo" style={{ width: size, height: size }} aria-hidden="true">{inner}</span>;
}
