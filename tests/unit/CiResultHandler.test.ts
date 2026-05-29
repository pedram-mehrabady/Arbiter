import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { CiResultHandler } from '../../src/webhooks/CiResultHandler';
import type { SqliteStore } from '../../src/state/SqliteStore';
import type { LLMProvider } from '../../src/providers/LLMProvider';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ci-handler-test-'));
}

function makeStore(): SqliteStore {
  const tasks: Record<string, unknown> = {};
  return {
    upsertTask: vi.fn((row: { task_id: string; status?: string }) => { tasks[row.task_id] = row; }),
    appendEvent: vi.fn(),
    getEvents: vi.fn().mockReturnValue([]),
    getOrchestratorState: vi.fn().mockReturnValue(undefined),
    setOrchestratorState: vi.fn(),
  } as unknown as SqliteStore;
}

function makeProvider(): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: 'DECISION: approve\nSUMMARY: CI passed\nLESSONS:\n1. A\n2. B\n3. C',
        inputTokens: 100,
        outputTokens: 50,
        rateLimitInfo: {},
        exitCode: 0,
      },
    }),
    estimateCost: vi.fn().mockReturnValue(0),
  } as unknown as LLMProvider;
}

describe('CiResultHandler', () => {
  it('on success: updates task status to completed', async () => {
    const dir = tempDir();
    const store = makeStore();
    const handler = new CiResultHandler(store, makeProvider(), dir);

    await handler.handle('TASK-001', 'success', 'https://github.com/pr/1', 'https://github.com/run/1');

    expect(store.upsertTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 'TASK-001', status: 'completed' }),
    );
  });

  it('on success: appends ci_result event', async () => {
    const dir = tempDir();
    const store = makeStore();
    const handler = new CiResultHandler(store, makeProvider(), dir);

    await handler.handle('TASK-002', 'success', '', '');

    expect(store.appendEvent).toHaveBeenCalledWith(
      'TASK-002',
      'ci_result',
      expect.objectContaining({ conclusion: 'success' }),
    );
  });

  it('on failure: updates task status to failed', async () => {
    const dir = tempDir();
    const store = makeStore();
    const handler = new CiResultHandler(store, makeProvider(), dir);

    await handler.handle('TASK-003', 'failure', '', 'https://github.com/run/2');

    expect(store.upsertTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 'TASK-003', status: 'failed' }),
    );
  });

  it('on cancelled: updates task status to failed', async () => {
    const dir = tempDir();
    const store = makeStore();
    const handler = new CiResultHandler(store, makeProvider(), dir);

    await handler.handle('TASK-004', 'cancelled', '', '');

    expect(store.upsertTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 'TASK-004', status: 'failed' }),
    );
  });

  it('on failure: records one debugger attempt (guarded against repeats)', async () => {
    const dir = tempDir();
    const store = makeStore();
    const handler = new CiResultHandler(store, makeProvider(), dir);

    await handler.handle('TASK-007', 'failure', '', 'https://github.com/run/3');

    expect(store.appendEvent).toHaveBeenCalledWith(
      'TASK-007',
      'ci_debugger_attempt',
      expect.any(Object),
    );
  });

  it('on failure: skips the debugger when one was already attempted', async () => {
    const dir = tempDir();
    const store = makeStore();
    // Simulate a prior attempt already recorded.
    (store.getEvents as ReturnType<typeof vi.fn>).mockReturnValue([{ id: 1, event_type: 'ci_debugger_attempt', payload: '{}', created_at: '' }]);
    const handler = new CiResultHandler(store, makeProvider(), dir);

    await handler.handle('TASK-008', 'failure', '', '');

    const attemptCalls = (store.appendEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[1] === 'ci_debugger_attempt');
    expect(attemptCalls).toHaveLength(0);
    expect(store.upsertTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 'TASK-008', status: 'failed' }),
    );
  });

  it('extractTaskIdFromBranch: extracts from feat/arbiter-FEAT-001-add-login', () => {
    expect(CiResultHandler.extractTaskIdFromBranch('feat/arbiter-FEAT-001-add-login')).toBe('FEAT-001');
  });

  it('extractTaskIdFromBranch: returns empty string for non-matching branch', () => {
    expect(CiResultHandler.extractTaskIdFromBranch('main')).toBe('');
  });

  it('extractTaskIdFromBranch: handles arbiter/TASK-123 format', () => {
    expect(CiResultHandler.extractTaskIdFromBranch('arbiter/TASK-123')).toBe('TASK-123');
  });
});
