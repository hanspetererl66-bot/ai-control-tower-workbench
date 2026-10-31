import type { LevelIndex, PromotionRequest } from './skill-governance.ts';

/** Who decides when a skill moves up to this level. A mockup of the roles; today one person plays all of them. */
export const APPROVER: Record<1 | 2, { role: string; sla: string }> = {
  1: { role: 'Department lead', sla: 'within 3 working days' },
  2: { role: 'Governance board (Security, Data protection, Platform owner)', sla: 'next board meeting, at most 10 working days' },
};

export type StepState = 'done' | 'active' | 'todo' | 'rejected';
export type ApprovalStep = { id: 'submit' | 'checks' | 'review' | 'publish'; title: string; who: string; state: StepState };

/**
 * The four steps of publishing a skill one level up. With a request the states follow it:
 * pending = waiting at the review step, approved = all done, rejected = stopped at the review.
 * Without a request (the preview) every step is open.
 */
export function approvalSteps(to: LevelIndex, request?: Pick<PromotionRequest, 'status'> | null, checksState?: StepState): ApprovalStep[] {
  const approver = to >= 1 ? APPROVER[to as 1 | 2].role : 'Owner';
  const base: Omit<ApprovalStep, 'state'>[] = [
    { id: 'submit', title: 'Request submitted', who: 'Skill owner' },
    { id: 'checks', title: 'Automatic checks', who: 'Platform: secrets, scripts, permissions, harness, data class' },
    { id: 'review', title: 'Review and decision', who: approver },
    { id: 'publish', title: 'Published and visible', who: 'Platform: new version for everyone on the level' },
  ];
  const states: StepState[] = !request
    ? ['todo', 'todo', 'todo', 'todo']
    : request.status === 'approved' ? ['done', 'done', 'done', 'done']
    : request.status === 'rejected' ? ['done', 'done', 'rejected', 'todo']
    : ['done', 'done', 'active', 'todo'];
  if (!request && checksState) { states[0] = 'done'; states[1] = checksState; }
  return base.map((b, i) => ({ ...b, state: states[i] }));
}
