import { describe, it, expect } from 'vitest';
import { planPhase, phaseGroup } from './planPhase';
import type { PlanItem, Job, PendingApproval } from '../api/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function plan(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'plan-1',
    ticket: 'FEAT-52',
    title: 'Test plan',
    status: 'draft',
    priority: 0,
    planType: 'feature',
    deferred: false,
    ...overrides,
  } as PlanItem;
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'FEAT-52',
    ticket: 'FEAT-52',
    title: 'Test job',
    status: 'building',
    ...overrides,
  };
}

function approval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'appr-1',
    job_id: 'FEAT-52',
    ticket: 'FEAT-52',
    gate: 'fe-gate',
    gate_title: 'Frontend review',
    ...overrides,
  } as PendingApproval;
}

// ── planPhase() ───────────────────────────────────────────────────────────────

describe('planPhase', () => {
  it('draft plan with no job → draft', () => {
    expect(planPhase(plan({ status: 'draft' }), [], null).phase).toBe('draft');
  });

  it('ready plan with no matching job → submitted', () => {
    expect(planPhase(plan({ status: 'ready' }), [], null).phase).toBe('submitted');
  });

  it('ready plan with unrelated jobs → submitted (not building)', () => {
    const otherJob = job({ id: 'FEAT-99', ticket: 'FEAT-99' });
    expect(planPhase(plan({ status: 'ready' }), [otherJob], null).phase).toBe('submitted');
  });

  it('plan whose ticket matches a building job → building', () => {
    const j = job({ status: 'building' });
    const result = planPhase(plan({ status: 'ready' }), [j], null);
    expect(result.phase).toBe('building');
    expect(result.job).toBe(j);
  });

  it('job matched by id when ticket field is absent → building', () => {
    const j: Job = { id: 'FEAT-52', title: 'job', status: 'building' };
    expect(planPhase(plan(), [j], null).phase).toBe('building');
  });

  it('done job statuses → done', () => {
    for (const status of ['done', 'merged', 'shipped'] as const) {
      expect(planPhase(plan(), [job({ status })], null).phase).toBe('done');
    }
  });

  it('failed job → failed', () => {
    expect(planPhase(plan(), [job({ status: 'failed' })], null).phase).toBe('failed');
  });

  it('matching job + pending approval for same ticket → gate', () => {
    expect(planPhase(plan(), [job()], approval()).phase).toBe('gate');
  });

  it('pending approval for DIFFERENT ticket does not gate this plan', () => {
    const otherApproval = approval({ ticket: 'FEAT-99', job_id: 'FEAT-99' });
    expect(planPhase(plan(), [job()], otherApproval).phase).toBe('building');
  });

  it('pending approval with no matching job → gate (gate without a job)', () => {
    expect(planPhase(plan({ status: 'ready' }), [], approval()).phase).toBe('gate');
  });
});

// ── phaseGroup() ──────────────────────────────────────────────────────────────

describe('phaseGroup', () => {
  it('draft → draft group', () => expect(phaseGroup('draft')).toBe('draft'));
  it('submitted → ready group', () => expect(phaseGroup('submitted')).toBe('ready'));
  it('building → building group', () => expect(phaseGroup('building')).toBe('building'));
  it('gate → building group (shows in In Progress)', () => expect(phaseGroup('gate')).toBe('building'));
  it('done → done group', () => expect(phaseGroup('done')).toBe('done'));
  it('failed → done group', () => expect(phaseGroup('failed')).toBe('done'));
});
