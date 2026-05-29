import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PatchRunner } from '../../src/webhooks/PatchRunner';
import type { SqliteStore } from '../../src/state/SqliteStore';
import type { LLMProvider } from '../../src/providers/LLMProvider';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'patch-runner-test-'));
}

function makeStore(): SqliteStore {
  return { appendEvent: vi.fn(), upsertTask: vi.fn() } as unknown as SqliteStore;
}

function makeProvider(): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({
      ok: true,
      value: { content: '// edited', inputTokens: 10, outputTokens: 5, rateLimitInfo: {}, exitCode: 0 },
    }),
    estimateCost: vi.fn().mockReturnValue(0),
  } as unknown as LLMProvider;
}

describe('PatchRunner', () => {
  it('degrades gracefully (ok:false, not pushed) when the workspace is not a git repo', async () => {
    const dir = tempDir(); // no .git → reopen fails before any agent/gate work
    const runner = new PatchRunner(makeStore(), makeProvider(), dir);

    const result = await runner.applyFix({
      taskId: 'TASK-001',
      branchName: 'arbiter/TASK-001',
      agentRole: 'backend',
      model: 'claude-sonnet-4-6',
      prompt: 'fix it',
      commitMessage: 'arbiter: fix',
    });

    expect(result.ok).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.gatePassed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('does not invoke the agent when the branch cannot be reopened', async () => {
    const dir = tempDir();
    const provider = makeProvider();
    const runner = new PatchRunner(makeStore(), provider, dir);

    await runner.applyFix({
      taskId: 'TASK-002',
      branchName: 'arbiter/TASK-002',
      agentRole: 'debugger',
      model: 'claude-sonnet-4-6',
      prompt: 'debug',
      commitMessage: 'arbiter: debug',
    });

    expect(provider.invoke).not.toHaveBeenCalled();
  });
});
