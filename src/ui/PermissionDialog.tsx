import type { PermissionOption, PermissionRequest } from '../acp';
import { RISK_LABEL, describeAction } from '../approval';

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
  const action = describeAction({ title: request.title, toolName: request.toolName, rawInput: request.rawInput });

  return (
    <div className="scrim">
      <div className="dialog approval-card" role="dialog" aria-modal="true" aria-label="Approval needed">
        <div className="approval-head">
          <span className={`approval-risk approval-${action.risk}`}>{RISK_LABEL[action.risk]}</span>
          <h3 className="dialog-title">This is about to happen</h3>
        </div>
        <p className="approval-what"><b>{action.tool.replace(/_/g, ' ')}</b> in <b>{action.connector}</b></p>
        <p className="dialog-body">{request.title}</p>
        {action.params.length > 0 && (
          <dl className="approval-params">
            {action.params.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        <p className="approval-note">Nothing runs until you approve. You can switch these questions off under Individualisierung → Assistant.</p>
        <div className="dialog-actions">
          {options.map((o) => (
            <button
              key={o.optionId}
              className={`dialog-btn ${o.optionId === primary ? 'dialog-btn-primary' : ''}`}
              onClick={() => onChoose(o.optionId)}
            >
              {/allow_once|^allow$|accept/i.test(o.optionId) ? 'Approve' : /reject/i.test(o.optionId) && !/always/i.test(o.optionId) ? 'Decline' : label(o)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
