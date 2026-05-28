import type { PlanItem, Job, PendingApproval } from '../api/types';

export type PlanPhase =
  | 'draft'       // editing brief, not yet submitted
  | 'submitted'   // sent to factory inbox, waiting for factory.sh to pick it up
  | 'building'    // factory is running agents
  | 'gate'        // conductor is blocked at a human-review checkpoint
  | 'done'        // merged / shipped
  | 'failed';     // factory failed

export type PhaseGroup = 'draft' | 'ready' | 'building' | 'done';

export function jobForPlan(plan: PlanItem, jobs: Job[]): Job | undefined {
  return jobs.find((j) => (j.ticket ?? j.id) === plan.ticket);
}

function isGateForPlan(plan: PlanItem, pendingApproval?: PendingApproval | null): boolean {
  if (!pendingApproval) return false;
  return pendingApproval.ticket === plan.ticket || pendingApproval.job_id === plan.ticket;
}

export function planPhase(
  plan: PlanItem,
  jobs: Job[],
  pendingApproval?: PendingApproval | null,
): { phase: PlanPhase; job?: Job } {
  const job = jobForPlan(plan, jobs);
  const gate = isGateForPlan(plan, pendingApproval);

  if (job) {
    if (['merged', 'done', 'shipped'].includes(job.status)) return { phase: 'done', job };
    if (job.status === 'failed') return { phase: 'failed', job };
    if (gate) return { phase: 'gate', job };
    return { phase: 'building', job };
  }
  if (gate) return { phase: 'gate' };
  if (plan.status === 'ready') return { phase: 'submitted' };
  return { phase: 'draft' };
}

export const PHASE_LABEL: Record<PlanPhase, string> = {
  draft:     'draft',
  submitted: 'submitted',
  building:  'building',
  gate:      'needs input',
  done:      'done',
  failed:    'failed',
};

export function phaseGroup(phase: PlanPhase): PhaseGroup {
  if (phase === 'draft') return 'draft';
  if (phase === 'submitted') return 'ready';
  if (phase === 'done' || phase === 'failed') return 'done';
  return 'building'; // gate + building both appear in In Progress
}
