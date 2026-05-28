import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { OrchestratorDispatcher } from '../../src/orchestrator/OrchestratorDispatcher';
import type { LLMProvider } from '../../src/providers/LLMProvider';
import type { SqliteStore } from '../../src/state/SqliteStore';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-test-'));
}

function makeSqliteStore(): SqliteStore {
  const states: Record<string, { phase: string; summary: string; chat_history: string }> = {};
  return {
    getOrchestratorState: vi.fn((taskId: string) => states[taskId] ?? undefined),
    setOrchestratorState: vi.fn((taskId: string, row: { phase: string; summary: string; chat_history: string }) => {
      states[taskId] = { ...row };
    }),
    appendEvent: vi.fn(),
    upsertTask: vi.fn(),
  } as unknown as SqliteStore;
}

function makeProvider(content: string, exitCode = 0): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({
      ok: true,
      value: { content, inputTokens: 100, outputTokens: 50, rateLimitInfo: {}, exitCode },
    }),
    estimateCost: vi.fn().mockReturnValue(0),
  } as unknown as LLMProvider;
}

const APPROVE_RESPONSE = [
  'DECISION: approve',
  'SUMMARY: Feature implemented correctly',
  'LESSONS:',
  '1. Keep contracts minimal',
  '2. Test coverage matters',
  '3. Gate 1 catches drift early',
].join('\n');

const REJECT_RESPONSE = [
  'DECISION: reject',
  'REASON: contracts/api.ts missing CreateUserResponse schema',
].join('\n');

describe('OrchestratorDispatcher', () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    fs.mkdirSync(path.join(dir, 'arbiter', 'tasks', 'TASK-001'), { recursive: true });
  });

  it('calls LLM with orchestrator role', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider(APPROVE_RESPONSE);
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    await dispatcher.wake('TASK-001', 'gate5_reached', { taskMd: 'Fix login', contracts: '', prDiff: '' });

    expect(provider.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ agentRole: 'orchestrator' }),
    );
  });

  it('loads orchestrator_state from SqliteStore before calling LLM', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider(APPROVE_RESPONSE);
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    await dispatcher.wake('TASK-001', 'gate5_reached', {});

    expect(store.getOrchestratorState).toHaveBeenCalledWith('TASK-001');
  });

  it('appends response to chat_history in SqliteStore after gate5_reached', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider(APPROVE_RESPONSE);
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    await dispatcher.wake('TASK-001', 'gate5_reached', { taskMd: 'Task content', contracts: '', prDiff: '' });

    expect(store.setOrchestratorState).toHaveBeenCalledWith(
      'TASK-001',
      expect.objectContaining({ phase: 'gate5_reached' }),
    );
    const callArg = (store.setOrchestratorState as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const history = JSON.parse(callArg.chat_history) as Array<{ role: string; content: string }>;
    expect(history.length).toBeGreaterThan(0);
    expect(history.some(m => m.role === 'assistant')).toBe(true);
  });

  it('parses approve decision from Gate 5 response', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider(APPROVE_RESPONSE);
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    const response = await dispatcher.wake('TASK-001', 'gate5_reached', {});

    expect(response.decision).toBe('approve');
    expect(response.summary).toBe('Feature implemented correctly');
  });

  it('parses reject decision and reason from Gate 5 response', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider(REJECT_RESPONSE);
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    const response = await dispatcher.wake('TASK-001', 'gate5_reached', {});

    expect(response.decision).toBe('reject');
    expect(response.reason).toContain('CreateUserResponse');
  });

  it('extracts lessons from Gate 5 approve response', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider(APPROVE_RESPONSE);
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    const response = await dispatcher.wake('TASK-001', 'gate5_reached', {});

    expect(response.lessons).toHaveLength(3);
    expect(response.lessons?.[0]).toBe('Keep contracts minimal');
  });

  it('appends to chat_history for user_chat trigger', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider('Here is your answer.');
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    await dispatcher.wake('TASK-001', 'user_chat', { message: 'What is the status?' });

    expect(store.setOrchestratorState).toHaveBeenCalled();
    const callArg = (store.setOrchestratorState as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const history = JSON.parse(callArg.chat_history) as Array<{ role: string; content: string }>;
    expect(history.some(m => m.role === 'user' && m.content === 'What is the status?')).toBe(true);
  });

  it('getChatHistory returns empty array for unknown task', () => {
    const store = makeSqliteStore();
    const provider = makeProvider('');
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    const history = dispatcher.getChatHistory('NONEXISTENT');

    expect(history).toEqual([]);
  });

  it('falls back to approve when LLM call fails', async () => {
    const store = makeSqliteStore();
    const provider = {
      invoke: vi.fn().mockRejectedValue(new Error('Connection timeout')),
      estimateCost: vi.fn().mockReturnValue(0),
    } as unknown as LLMProvider;
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    const response = await dispatcher.wake('TASK-001', 'gate5_reached', {});

    expect(response.decision).toBe('approve');
  });

  it('prunes oldest history entries when token budget exceeded', async () => {
    const store = makeSqliteStore();
    // Seed very long history in the store
    const longHistory = Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'A'.repeat(500),
      timestamp: new Date().toISOString(),
    }));
    (store.getOrchestratorState as ReturnType<typeof vi.fn>).mockReturnValue({
      task_id: 'TASK-001',
      phase: 'user_chat',
      summary: '',
      chat_history: JSON.stringify(longHistory),
    });

    let capturedPrompt = '';
    const provider = {
      invoke: vi.fn().mockImplementation(async (req: { assembledPrompt: string }) => {
        capturedPrompt = req.assembledPrompt;
        return { ok: true, value: { content: APPROVE_RESPONSE, inputTokens: 100, outputTokens: 50, rateLimitInfo: {}, exitCode: 0 } };
      }),
      estimateCost: vi.fn().mockReturnValue(0),
    } as unknown as LLMProvider;
    const dispatcher = new OrchestratorDispatcher(store, provider, dir);

    await dispatcher.wake('TASK-001', 'gate5_reached', { taskMd: 'task', contracts: '', prDiff: '' });

    // Prompt should be within budget — not include all 200 history entries verbatim
    expect(capturedPrompt.length).toBeLessThan(200 * 500);
  });
});
