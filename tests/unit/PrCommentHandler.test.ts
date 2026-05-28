import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PrCommentHandler } from '../../src/webhooks/PrCommentHandler';
import type { SqliteStore } from '../../src/state/SqliteStore';
import type { LLMProvider } from '../../src/providers/LLMProvider';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-comment-test-'));
}

function makeStore(): SqliteStore {
  return {
    upsertTask: vi.fn(),
    appendEvent: vi.fn(),
    getOrchestratorState: vi.fn().mockReturnValue(undefined),
    setOrchestratorState: vi.fn(),
  } as unknown as SqliteStore;
}

function makeProvider(content: string): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({
      ok: true,
      value: { content, inputTokens: 100, outputTokens: 50, rateLimitInfo: {}, exitCode: 0 },
    }),
    estimateCost: vi.fn().mockReturnValue(0),
  } as unknown as LLMProvider;
}

describe('PrCommentHandler', () => {
  it('lgtm: marks task as completed', async () => {
    const dir = tempDir();
    const store = makeStore();
    const content = 'COMMENT_TYPE: lgtm\nRESPONSE: All looks good!';
    const handler = new PrCommentHandler(store, makeProvider(content), dir);

    await handler.handle('TASK-001', 'LGTM looks great', 42, 'reviewer', false);

    expect(store.upsertTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 'TASK-001', status: 'completed' }),
    );
  });

  it('code_change: dispatches coder fix (records pending_coder_fix event)', async () => {
    const dir = tempDir();
    const store = makeStore();
    const content = 'COMMENT_TYPE: code_change\nRESPONSE: Please fix the null check on line 42.';
    const handler = new PrCommentHandler(store, makeProvider(content), dir);

    await handler.handle('TASK-002', 'Fix the null check', 10, 'reviewer', true);

    expect(store.appendEvent).toHaveBeenCalledWith(
      'TASK-002',
      'pending_coder_fix',
      expect.any(Object),
    );
  });

  it('question: posts pr comment (records event, gh may fail silently)', async () => {
    const dir = tempDir();
    const store = makeStore();
    const content = 'COMMENT_TYPE: question\nRESPONSE: The auth token is set in the config file.';
    const handler = new PrCommentHandler(store, makeProvider(content), dir);

    // gh command will fail (not installed in test env) — should be non-fatal
    await expect(
      handler.handle('TASK-003', 'Where is the auth token set?', 5, 'reviewer', false),
    ).resolves.not.toThrow();
  });

  it('appends pr_comment_received event on every call', async () => {
    const dir = tempDir();
    const store = makeStore();
    const content = 'COMMENT_TYPE: lgtm\nRESPONSE: ok';
    const handler = new PrCommentHandler(store, makeProvider(content), dir);

    await handler.handle('TASK-004', 'LGTM', 1, 'bob', false);

    expect(store.appendEvent).toHaveBeenCalledWith(
      'TASK-004',
      'pr_comment_received',
      expect.objectContaining({ prNumber: 1, author: 'bob' }),
    );
  });

  it('appends pr_comment_classified event with type', async () => {
    const dir = tempDir();
    const store = makeStore();
    const content = 'COMMENT_TYPE: code_change\nRESPONSE: Fix it';
    const handler = new PrCommentHandler(store, makeProvider(content), dir);

    await handler.handle('TASK-005', 'Fix the bug', 7, 'alice', true);

    expect(store.appendEvent).toHaveBeenCalledWith(
      'TASK-005',
      'pr_comment_classified',
      expect.objectContaining({ commentType: 'code_change' }),
    );
  });

  it('handles LLM failure gracefully without throwing', async () => {
    const dir = tempDir();
    const store = makeStore();
    const failProvider = {
      invoke: vi.fn().mockRejectedValue(new Error('timeout')),
      estimateCost: vi.fn().mockReturnValue(0),
    } as unknown as LLMProvider;
    const handler = new PrCommentHandler(store, failProvider, dir);

    await expect(
      handler.handle('TASK-006', 'Hello', 1, 'user', false),
    ).resolves.not.toThrow();
  });
});
