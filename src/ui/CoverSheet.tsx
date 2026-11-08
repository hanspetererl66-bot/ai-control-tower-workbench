import { useEffect } from 'react';
import { COVER_BY, COVER_NAME, COVER_STATUS, COVER_SUBTITLE, COVER_TAGLINE, PRODUCT_TITLE } from '../product';
import CoverGrid from './CoverGrid';
import WerkbankMark from './WerkbankMark';

/**
 * Optional logo behind the "by" line: put the file at src/assets/accenture-logo.svg (or .png, .webp). Without a file
 * nothing is shown; the app does not ship or draw a brand logo itself.
 */
const LOGO = Object.values(import.meta.glob('../assets/accenture-logo.{svg,png,webp}', { eager: true, query: '?url', import: 'default' }))[0] as string | undefined;

/** Full-screen cover sheet shown when the logo in the rail is clicked. */
export default function CoverSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="cover" role="dialog" aria-modal="true" aria-label={PRODUCT_TITLE} onClick={onClose}>
      <div className="cover-body" onClick={(event) => event.stopPropagation()}>
        <CoverGrid />
        <WerkbankMark size={60} className="cover-mark" />
        <h1 className="cover-title">
          {COVER_NAME}
          <span className="cover-title-line2">{COVER_SUBTITLE}</span>
        </h1>
        <p className="cover-tagline">{COVER_TAGLINE}</p>
        <p className="cover-by">
          {COVER_BY}
          {LOGO && <img className="cover-logo" src={LOGO} alt="" />}
        </p>
        <p className="cover-author">Author: Hans-Peter Erl</p>
        <p className="cover-note">{COVER_STATUS}</p>
        <p className="cover-note" title="Git commit of the running version">Build {typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev'}</p>
        <button className="cover-close" onClick={onClose}>
          Close
        </button>
        <p className="cover-legal">Not SAP software and not affiliated with or endorsed by SAP.</p>
      </div>
    </div>
  );
}
