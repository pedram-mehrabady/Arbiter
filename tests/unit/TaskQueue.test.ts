import { describe, it, expect } from 'vitest';
import { TaskQueue } from '../../src/queue/TaskQueue';
import { TaskState, SubTaskEntry } from '../../src/types/index';

// Helper to build a minimal TaskState for static method tests
function makeState(
  subTasks: Record<string, Partial<SubTaskEntry> & { status: SubTaskEntry['status'] }>,
): TaskState {
  const now = new Date().toISOString();
  const full: Record<string, SubTaskEntry> = {};
  for (const [id, st] of Object.entries(subTasks)) {
    full[id] = { agent_role: 'reframe', model: 'test', ...st } as SubTaskEntry;
  }
  return {
    task_id: 'TEST',
    phase: 'test',
    phase_status: 'in_progress',
    created_at: now,
    updated_at: now,
    sub_tasks: full,
  };
}

describe('TaskQueue static methods', () => {
  describe('getEligible', () => {
    it('returns pending tasks with no dependencies', () => {
      const state = makeState({
        reframe: { status: 'pending' },
      });
      const eligible = TaskQueue.getEligible(state);
      expect(eligible.map(([id]) => id)).toContain('reframe');
    });

    it('excludes in_progress tasks', () => {
      const state = makeState({
        reframe: { status: 'in_progress' },
      });
      expect(TaskQueue.getEligible(state)).toHaveLength(0);
    });

    it('excludes completed tasks', () => {
      const state = makeState({
        reframe: { status: 'completed' },
      });
      expect(TaskQueue.getEligible(state)).toHaveLength(0);
    });

    it('excludes pending tasks with incomplete dependencies', () => {
      const state = makeState({
        reframe:  { status: 'pending' },
        research: { status: 'pending', depends_on: ['reframe'] },
      });
      const ids = TaskQueue.getEligible(state).map(([id]) => id);
      expect(ids).toContain('reframe');
      expect(ids).not.toContain('research');
    });

    it('includes pending tasks whose deps are all completed', () => {
      const state = makeState({
        reframe:  { status: 'completed' },
        research: { status: 'pending', depends_on: ['reframe'] },
      });
      const ids = TaskQueue.getEligible(state).map(([id]) => id);
      expect(ids).toContain('research');
    });

    it('handles multiple completed deps correctly', () => {
      const state = makeState({
        reframe:  { status: 'completed' },
        research: { status: 'completed' },
        design:   { status: 'pending', depends_on: ['reframe', 'research'] },
      });
      const ids = TaskQueue.getEligible(state).map(([id]) => id);
      expect(ids).toContain('design');
    });

    it('returns multiple eligible tasks at once', () => {
      const state = makeState({
        a: { status: 'pending' },
        b: { status: 'pending' },
      });
      expect(TaskQueue.getEligible(state)).toHaveLength(2);
    });
  });

  describe('isComplete', () => {
    it('returns true when all tasks are completed', () => {
      const state = makeState({
        reframe:  { status: 'completed' },
        research: { status: 'completed' },
      });
      expect(TaskQueue.isComplete(state)).toBe(true);
    });

    it('returns false when any task is pending', () => {
      const state = makeState({
        reframe:  { status: 'completed' },
        research: { status: 'pending' },
      });
      expect(TaskQueue.isComplete(state)).toBe(false);
    });

    it('returns false when any task is in_progress', () => {
      const state = makeState({
        reframe:  { status: 'completed' },
        research: { status: 'in_progress' },
      });
      expect(TaskQueue.isComplete(state)).toBe(false);
    });

    it('returns true for empty sub_tasks', () => {
      const state = makeState({});
      expect(TaskQueue.isComplete(state)).toBe(true);
    });
  });

  describe('hasFailed', () => {
    it('returns true when any task is failed', () => {
      const state = makeState({
        reframe:  { status: 'completed' },
        research: { status: 'failed' },
      });
      expect(TaskQueue.hasFailed(state)).toBe(true);
    });

    it('returns false when no tasks are failed', () => {
      const state = makeState({
        reframe:  { status: 'completed' },
        research: { status: 'pending' },
      });
      expect(TaskQueue.hasFailed(state)).toBe(false);
    });
  });

  describe('isDeadlocked', () => {
    it('returns false when tasks are eligible', () => {
      const state = makeState({
        reframe: { status: 'pending' },
      });
      expect(TaskQueue.isDeadlocked(state)).toBe(false);
    });

    it('returns false when tasks are in_progress', () => {
      const state = makeState({
        reframe: { status: 'in_progress' },
      });
      expect(TaskQueue.isDeadlocked(state)).toBe(false);
    });

    it('returns false when complete', () => {
      const state = makeState({
        reframe: { status: 'completed' },
      });
      expect(TaskQueue.isDeadlocked(state)).toBe(false);
    });

    it('detects deadlock: pending tasks with unsatisfiable deps', () => {
      // Both pending, each depends on the other → neither is eligible, none in progress
      const state = makeState({
        a: { status: 'pending', depends_on: ['b'] },
        b: { status: 'pending', depends_on: ['a'] },
      });
      expect(TaskQueue.isDeadlocked(state)).toBe(true);
    });

    it('detects deadlock: pending task depending on failed task', () => {
      const state = makeState({
        reframe:  { status: 'failed' },
        research: { status: 'pending', depends_on: ['reframe'] },
      });
      expect(TaskQueue.isDeadlocked(state)).toBe(true);
    });
  });
});
