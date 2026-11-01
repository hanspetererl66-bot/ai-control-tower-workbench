import type { ReactNode } from 'react';
import { DOC_TITLE, type AgentProject } from '../agent-project';
import { DOCK_ACTIONS, extractDocument, type DockFocus } from '../dock';

type Props = {
  /** Last answer of Joule, to offer "Apply to document". */
  lastAnswer: string;
  busy: boolean;
  focus: DockFocus | null;
  project: AgentProject | null;
  /** Joule's message list and the composer, drawn by the app so the dock shares the current conversation. */
  chat: ReactNode;
  composer: ReactNode;
  empty: boolean;
  where: 'studio' | 'manage';
  onApply: (text: string) => void;
  onConfirm: () => void;
  onAsk: (prompt: string) => void;
};

/** The Joule chat docked to the right of a working screen: the document stays in the middle, the conversation never closes. */
export default function JouleDock({ lastAnswer, busy, focus, project, chat, composer, empty, where, onApply, onConfirm, onAsk }: Props) {
  const doc = focus && project ? focus.docKey : null;
  const confirmed = doc && project ? !!project.confirmed[doc] && !project.stale.includes(doc) : false;
  const proposal = doc && !busy ? extractDocument(lastAnswer) : null;
  const same = doc && project && proposal ? proposal.trim() === (project.docs[doc] ?? '').trim() : false;
  return (
    <aside className="jdock" aria-label="Joule">
      <header className="jdock-head">
        <b>Joule</b>
        <span className="jdock-ctx">{doc ? `Working on: ${DOC_TITLE[doc]}` : where === 'manage' ? 'Skills and connectors' : 'Agent Studio'}</span>
      </header>
      {doc && (
        <div className="jdock-actions" role="group" aria-label="Quick commands">
          {DOCK_ACTIONS.map((a) => <button key={a.label} className="jdock-chip" disabled={busy} onClick={() => onAsk(a.prompt)}>{a.label}</button>)}
        </div>
      )}
      {empty ? (
        <div className="jdock-empty">
          {doc
            ? <p>Joule sees the document next to this chat. Type a command, for example <i>“add a section on data protection”</i>, or <i>“yes, confirm”</i> when the document is OK.</p>
            : <p>Ask Joule anything while you work here. {where === 'manage' ? 'For example: which skill should move up to the department?' : 'Open a project document and Joule works on it with you.'}</p>}
        </div>
      ) : chat}
      {proposal && !same && doc && (
        <div className="jdock-apply" role="group" aria-label="Proposed change">
          <span>Joule proposed a new version of the {DOC_TITLE[doc]}.</span>
          <button className="dialog-btn dialog-btn-primary" onClick={() => onApply(proposal)}>Apply to document</button>
        </div>
      )}
      {doc && !confirmed && (
        <div className="jdock-confirm" role="group" aria-label="Confirmation">
          <b>Is this document OK?</b>
          <button className="dialog-btn dialog-btn-primary" disabled={busy || !(project?.docs[doc] ?? '').trim() || !!project?.stale.includes(doc)} onClick={onConfirm}>Yes, confirm</button>
        </div>
      )}
      {doc && confirmed && <div className="jdock-confirm jdock-ok">✓ Confirmed. Change the document and it opens again.</div>}
      <div className="jdock-composer">{composer}</div>
    </aside>
  );
}
