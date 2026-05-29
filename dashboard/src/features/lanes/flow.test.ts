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

  it('shows a pending gate as needs-gate in the gate lane', () => {
    const cards = deriveCards(DEFAULT_FLOW, [{
      taskId: 'T3', title: 'T3',
      agentStatus: { design: 'completed', 'design-critic': 'completed' },
      pendingGateType: 'plan_approval',
    }]);
    expect(cards[0]).toMatchObject({ laneId: 'plan', lifecycle: 'needs-gate' });
  });

  it('queues a task whose first agent has not started', () => {
    const cards = deriveCards(DEFAULT_FLOW, [{
      taskId: 'T4', title: 'T4',
      agentStatus: { design: 'pending' },
    }]);
    expect(cards[0]).toMatchObject({ laneId: 'design', columnId: 'design', lifecycle: 'queued' });
  });
});
