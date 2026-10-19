import { useEffect } from 'react';
import { PRODUCT_NAME } from '../product';
import CoverGrid from './CoverGrid';
import WerkbankMark from './WerkbankMark';

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
    <div className="cover" role="dialog" aria-modal="true" aria-label={`${PRODUCT_NAME} prototype`} onClick={onClose}>
      <div className="cover-body" onClick={(event) => event.stopPropagation()}>
        <CoverGrid />
        <WerkbankMark size={60} className="cover-mark" />
        <h1 className="cover-title">{PRODUCT_NAME}</h1>
        <p className="cover-kind">Prototype</p>
        <p className="cover-by">Built by Accenture</p>
        <p className="cover-note">Demo only · illustrative sample data</p>
        <button className="cover-close" onClick={onClose}>
          Close
        </button>
        <p className="cover-legal">Not SAP software and not affiliated with or endorsed by SAP.</p>
      </div>
    </div>
  );
}
