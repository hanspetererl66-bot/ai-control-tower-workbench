import { useMemo, useState } from 'react';
import { extraFiles, formatBytes, importBlocked, reviewPackage, type PackFile } from '../skill-package';
import { Checks } from './SkillGovernance';

export type ImportPreview = { id: string; slug: string; name: string; description: string; files: PackFile[]; text: string; exists: boolean };

/** Shows what is in an imported skill package, runs the automatic review and installs only after a click. */
export default function SkillImportDialog({ preview, busy, onInstall, onCancel }: {
  preview: ImportPreview; busy: boolean; onInstall: (overwrite: boolean) => void; onCancel: () => void;
}) {
  const review = useMemo(() => reviewPackage(preview.text), [preview.text]);
  const blocked = importBlocked(review);
  const extra = extraFiles(preview.files);
  const [replace, setReplace] = useState(false);
  const canInstall = !blocked && !busy && (!preview.exists || replace);
  return (
    <div className="scrim">
      <div className="dialog dialog-scrollable" role="dialog" aria-modal="true" aria-label="Import skill">
        <div className="dialog-head">
          <h3 className="dialog-title">Import skill “{preview.name}”?</h3>
          <p className="dialog-body">{preview.description || 'No description.'}</p>
          <p className="dialog-body">Comes from a file someone gave you. Nothing is installed until you confirm here.</p>
        </div>
        <Checks results={review} version="the package" />
        <details className="skill-files">
          <summary>{preview.files.length} file{preview.files.length === 1 ? '' : 's'}{extra.length ? ` · ${extra.length} besides the instructions` : ' · instructions only'}</summary>
          <ul>{preview.files.map((f) => <li key={f.path}><code>{f.path}</code> <small>{formatBytes(f.bytes)}</small></li>)}</ul>
        </details>
        {preview.exists && (
          <label className="skill-replace">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            <span>A skill named “{preview.slug}” is already installed. Replace it (the old version is kept as a backup).</span>
          </label>
        )}
        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" disabled={!canInstall} onClick={() => onInstall(replace)}>
            {busy ? 'Installing…' : preview.exists ? 'Replace skill' : 'Install skill'}
          </button>
        </div>
      </div>
    </div>
  );
}
