import type { SourceKind } from '../requirements';

/**
 * The marks of the six tools Werkbank connects to, drawn by hand as simplified shapes in brand colours
 * (a logo is the one place where colours are not tokens). They are not the official logo files.
 * Decorative: the name always stands next to a mark. The size comes from the parent box.
 */
export default function BrandMark({ id }: { id: SourceKind }) {
  switch (id) {
    case 'jira':
      return (
        <svg viewBox="0 0 32 32" width="100%" height="100%">
          <path d="M16 2 28 14a1.4 1.4 0 0 1 0 2l-5 5-7-7-7 7-5-5a1.4 1.4 0 0 1 0-2z" fill="#2684FF" />
          <path d="M16 12l7 7-7 7-7-7z" fill="#0052CC" />
        </svg>
      );
    case 'slack':
      return (
        <svg viewBox="0 0 32 32" width="100%" height="100%">
          <rect x="13" y="3" width="6" height="12" rx="3" fill="#36C5F0" />
          <rect x="17" y="13" width="12" height="6" rx="3" fill="#2EB67D" />
          <rect x="13" y="17" width="6" height="12" rx="3" fill="#ECB22E" />
          <rect x="3" y="13" width="12" height="6" rx="3" fill="#E01E5A" />
        </svg>
      );
    case 'figma':
      return (
        <svg viewBox="0 0 32 32" width="100%" height="100%">
          <path d="M11 2h5v9h-5a4.5 4.5 0 0 1 0-9z" fill="#F24E1E" />
          <path d="M16 2h5a4.5 4.5 0 0 1 0 9h-5z" fill="#FF7262" />
          <path d="M11 11h5v9h-5a4.5 4.5 0 0 1 0-9z" fill="#A259FF" />
          <circle cx="20.5" cy="15.5" r="4.5" fill="#1ABCFE" />
          <path d="M11 20h5v4.5A4.5 4.5 0 1 1 11 20z" fill="#0ACF83" />
        </svg>
      );
    case 'teams':
      return (
        <svg viewBox="0 0 32 32" width="100%" height="100%">
          <rect x="2" y="6" width="22" height="20" rx="4" fill="#5059C9" />
          <circle cx="25" cy="10" r="3.5" fill="#7B83EB" />
          <rect x="19" y="13" width="11" height="12" rx="3" fill="#7B83EB" />
          <path d="M8 12h10M13 12v10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        </svg>
      );
    case 'notion':
      return (
        <svg viewBox="0 0 32 32" width="100%" height="100%">
          <rect x="4" y="4" width="24" height="24" rx="4" fill="#fff" stroke="#1f1f1f" strokeWidth="2" />
          <path d="M11 22V10l10 12V10" stroke="#1f1f1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 32 32" width="100%" height="100%">
          <circle cx="16" cy="16" r="14" fill="#5E6AD2" />
          <path d="M6.5 19.5 12.5 25.5M5.6 15.2 16.8 26.4M8 10.8 21.2 24M11.5 7.6 24.4 20.5M16.5 5.6 26.4 15.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" fill="none" />
        </svg>
      );
  }
}
