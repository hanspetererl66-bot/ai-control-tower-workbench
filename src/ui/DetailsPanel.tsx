import { fileKind } from '../acp';

export type GeneratedFile = { path: string };

type Props = {
  files: GeneratedFile[];
  onClose: () => void;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
};

export default function DetailsPanel({ files, onClose, onOpen, onReveal }: Props) {
  return (
    <aside className="details">
      <div className="details-head">
        <span className="details-title">Conversation Details</span>
        <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close details">
          ✕
        </button>
      </div>

      <div className="details-section">
        <GeneratedIcon />
        <span>Generated</span>
        <span className="details-count">{files.length}</span>
      </div>

      {files.length === 0 ? (
        <p className="details-empty">Files the agent creates in this conversation appear here.</p>
      ) : (
        <ul className="details-list">
          {files.map((f) => (
            <li key={f.path}>
              <div className="file" title={f.path}>
                <button className="file-open" onClick={() => onOpen(f.path)} title={`Open ${f.path.split('/').pop()}`}>
                  <FileIcon />
                  <span className="file-body">
                    <span className="file-name">{f.path.split('/').pop()}</span>
                    <span className="file-kind">{fileKind(f.path)}</span>
                  </span>
                </button>
                <button
                  className="file-reveal"
                  onClick={() => onReveal(f.path)}
                  title="Show in Finder"
                  aria-label={`Show ${f.path.split('/').pop()} in Finder`}
                >
                  <FolderIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.8 4.2h4l1.1 1.3h7.3v6.8H1.8z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

function GeneratedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2h5l3 3v9H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
