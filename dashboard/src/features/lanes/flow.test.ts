import { describe, it, expect } from 'vitest';
import { DEFAULT_FLOW, deriveCards } from './flow';

describe('deriveCards', () => {
  it('places a fully-completed task in the last lane Done column', () => {
    const cards = deriveCards(DEFAULT_FLOW, [{
      taskId: 'T1', title: 'T1',
      agentStatus: { design: 'completed', 'design-critic': 'completed', integrator: 'completed', plan: 'completed', frontend: 'completed', 'test-writer': 'completed', reviewer: 'completed', 'tech-writer': 'completed' },
    }]);
    expect(cards[0]).toMatchObject({ taskId: 'T1', laneId: 'finalize', columnId: 'done', lifecycle: 'done' });
  });

  it('places a running task in the running agent column', () => {
    const cards = deriveCards(DEFAULT_FLOW, [{
      taskId: 'T2', title: 'T2',
      agentStatus: { design: 'completed', 'design-critic': 'completed', integrator: 'completed', plan: 'completed', frontend: 'in_progress', backend: 'pending' },
    }]);
    expect(cards[0]).toMatchObject({ laneId: 'build', columnId: 'frontend', lifecycle: 'running' });
  });

  it('places a pending gate on its exact sub_task column, needs-gate (not Done)', () => {
    const cards = deriveCards(DEFAULT_FLOW, [{
      taskId: 'T3', title: 'T3',
      agentStatus: { design: 'completed', 'design-critic': 'completed', reviewer: 'completed' },
      pendingGate: { type: 'review_approval', subTask: 'reviewer' },
    }]);
    expect(cards[0]).toMatchObject({ laneId: 'finalize', columnId: 'reviewer', lifecycle: 'needs-gate' });
  });

  it('falls back to the gate lane (last agent column) when sub_task is unknown', () => {
    const cards = deriveCards(DEFAULT_FLOW, [{
      taskId: 'T3b', title: 'T3b',
      agentStatus: { design: 'completed' },
      pendingGate: { type: 'plan_approval' },
    }]);
    expect(cards[0]).toMatchObject({ laneId: 'plan', lifecycle: 'needs-gate' });
    expect(cards[0].columnId).not.toBe('done');
  });

  it('queues a task whose first agent has not started', () => {
    const cards = deriveCards(DEFAULT_FLOW, [{
      taskId: 'T4', title: 'T4',
      agentStatus: { design: 'pending' },
    }]);
    expect(cards[0]).toMatchObject({ laneId: 'design', columnId: 'design', lifecycle: 'queued' });
  });
});
