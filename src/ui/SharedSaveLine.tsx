import { useEffect, useState } from 'react';
import { getSyncStatus, subscribeSync, syncNow, type SyncStatus } from '../work-sync-runner';

/**
 * One line on the Develop page: are the projects saved in the shared database. The e-mail is no longer asked for:
 * the window saves under the default person (electron/work-store.mjs) until a real sign-in exists.
 */
export default function SharedSaveLine() {
  const [s, setS] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => subscribeSync(setS), []);
  if (s.state === 'off') return null;
  return (
    <div className={`shared-save shared-save-${s.state}`} role="status">
      <span className="shared-save-dot" aria-hidden="true" />
      <span className={s.state === 'needs-setup' || s.state === 'error' ? 'shared-save-bad' : undefined}>
        {s.state === 'syncing' ? 'Saving in the shared database…' : s.message || 'Connecting to the shared database…'}
      </span>
      {(s.state === 'error' || s.state === 'idle') && <button className="ghost-btn small" onClick={() => void syncNow()}>Save now</button>}
    </div>
  );
}
