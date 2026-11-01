import { useEffect, useState } from 'react';
import { getSyncStatus, setSyncEmail, subscribeSync, syncNow, type SyncStatus } from '../work-sync-runner';

/** One line on the Develop page: are the projects saved in the shared database, and under which e-mail. */
export default function SharedSaveLine() {
  const [s, setS] = useState<SyncStatus>(getSyncStatus());
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => subscribeSync(setS), []);
  if (s.state === 'off') return null;
  const needsEmail = s.state === 'needs-email' || (s.state === 'needs-setup' && !s.email) || editing;
  const save = async (e: React.FormEvent) => { e.preventDefault(); const err = await setSyncEmail(email); setProblem(err); if (!err) { setEditing(false); setEmail(''); } };
  return (
    <div className={`shared-save shared-save-${s.state}`} role="status">
      {needsEmail ? (
        <form onSubmit={save}>
          <label>{s.state === 'needs-email' ? 'Your e-mail, to save projects in the shared database:' : 'Your e-mail:'}{' '}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="email" required />
          </label>
          <button className="ghost-btn small" type="submit">Save</button>
          {editing && <button className="ghost-btn small" type="button" onClick={() => setEditing(false)}>Cancel</button>}
          {problem && <span className="shared-save-bad">{problem}</span>}
          {s.state === 'needs-setup' && <small className="shared-save-bad">{s.message}</small>}
        </form>
      ) : (
        <>
          <span className="shared-save-dot" aria-hidden="true" />
          <span>{s.state === 'syncing' ? 'Saving in the shared database…' : s.message || 'Connecting to the shared database…'}</span>
          {s.email && <small>as {s.email} <button className="ghost-btn small" onClick={() => setEditing(true)}>change</button></small>}
          {(s.state === 'error' || s.state === 'idle') && <button className="ghost-btn small" onClick={() => void syncNow()}>Save now</button>}
        </>
      )}
    </div>
  );
}
