import type { PermissionOption, PermissionRequest } from '../acp';

export default function PermissionDialog({
  request,
  onChoose,
}: {
  request: PermissionRequest;
  onChoose: (optionId: string) => void;
}) {
  // Prefer whatever options the agent offered; fall back so the dialog can never
  // trap the conversation with no way to answer.
  const options =
    request.options.length > 0
      ? request.options
      : [
          { optionId: 'allow', name: 'Allow' },
          { optionId: 'reject', name: 'Reject' },
        ];

  // goose sends optionIds as its labels (allow_once, reject_always…). Only
  // humanize when the name adds nothing over the id.
  const label = (o: PermissionOption) =>
    o.name && o.name !== o.optionId
      ? o.name
      : o.optionId.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

  // Exactly one primary, so the dialog has a single obvious default.
  const primary = options.find((o) => /allow_once|^allow$|accept/i.test(o.optionId))?.optionId;

  return (
    <div className="scrim">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Permission request">
        <h3 className="dialog-title">{request.title}</h3>
        <p className="dialog-body">The agent wants to run this. Allow it?</p>
        <div className="dialog-actions">
          {options.map((o) => (
            <button
              key={o.optionId}
              className={`dialog-btn ${o.optionId === primary ? 'dialog-btn-primary' : ''}`}
              onClick={() => onChoose(o.optionId)}
            >
              {label(o)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
