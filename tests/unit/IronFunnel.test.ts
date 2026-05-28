import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { IronFunnel } from '../../src/conductor/IronFunnel';
import type { LLMProvider } from '../../src/providers/LLMProvider';
import type { SqliteStore } from '../../src/state/SqliteStore';
import type { FactoryConfig } from '../../src/types/index';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iron-funnel-test-'));
}

function makeSqliteStore(): SqliteStore {
  const events: Array<{ taskId: string; type: string; payload: unknown }> = [];
  const tasks: Array<unknown> = [];

  return {
    appendEvent: vi.fn((taskId: string, eventType: string, payload: unknown) => {
      events.push({ taskId, type: eventType, payload });
    }),
    upsertTask: vi.fn((row: unknown) => {
      tasks.push(row);
    }),
  } as unknown as SqliteStore;
}

function makeProvider(content = '', exitCode = 0): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({
      ok: true,
      value: { content, inputTokens: 100, outputTokens: 50, rateLimitInfo: {}, exitCode },
    }),
    estimateCost: vi.fn().mockReturnValue(0),
  } as unknown as LLMProvider;
}

function makeConfig(): FactoryConfig {
  return {
    auto_merge: false,
    roles: {
      'test-writer': { provider: 'mock', model: 'claude-sonnet-4-6' },
      'reviewer': { provider: 'mock', model: 'claude-opus-4-7' },
    },
    providers: {},
  } as unknown as FactoryConfig;
}

describe('IronFunnel', () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
  });

  it('passes all gates for a clean empty directory (no tests, no tsconfig)', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    const result = await funnel.run('TASK-001', dir);

    expect(result.passed).toBe(true);
    expect(result.gates.some(g => g.gate === 5)).toBe(true);
  });

  it('Gate 1 fail stops the funnel and returns failureGate:1', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    // Write a file with a forbidden pattern — triggers Gate 1 failure every attempt
    fs.writeFileSync(path.join(dir, 'bad.ts'), 'eval("x")');

    const result = await funnel.run('TASK-002', dir);

    expect(result.passed).toBe(false);
    expect(result.failureGate).toBe(1);
  });

  it('Gate 5 stub auto-approves and logs the event', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    const result = await funnel.run('TASK-003', dir);

    expect(result.passed).toBe(true);
    const g5 = result.gates.find(g => g.gate === 5);
    expect(g5).toBeDefined();
    expect(g5?.passed).toBe(true);

    expect(store.appendEvent).toHaveBeenCalledWith(
      'TASK-003',
      'gate5_result',
      expect.objectContaining({ stub: true }),
    );
  });

  it('writes gate_started event to SqliteStore on run', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    await funnel.run('TASK-004', dir);

    expect(store.appendEvent).toHaveBeenCalledWith(
      'TASK-004',
      'gate_started',
      expect.objectContaining({ gate: 'iron_funnel' }),
    );
  });

  it('returns elapsed_ms as a positive number', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    const result = await funnel.run('TASK-005', dir);

    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('Gate 2 is attempted when Gate 1 passes', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    await funnel.run('TASK-006', dir);

    expect(store.appendEvent).toHaveBeenCalledWith(
      'TASK-006',
      'gate2_result',
      expect.any(Object),
    );
  });

  it('Gate 3 is attempted when Gate 2 passes', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    await funnel.run('TASK-007', dir);

    // Gate 3 result should be in events (via appendEvent)
    expect(store.appendEvent).toHaveBeenCalledWith(
      'TASK-007',
      'gate3_result',
      expect.any(Object),
    );
  });

  it('Gate 4 not triggered when Gate 3 passes', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    // Empty dir — Gate 3 returns unknown runner (passes)
    await funnel.run('TASK-008', dir);

    expect(store.appendEvent).not.toHaveBeenCalledWith(
      'TASK-008',
      'gate4_result',
      expect.any(Object),
    );
  });

  it('Gate 1 retry writes .arbiter-gate1-retry.json', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    // Write a forbidden pattern so Gate 1 always fails
    fs.writeFileSync(path.join(dir, 'bad.ts'), 'eval("x")');

    await funnel.run('TASK-009', dir);

    const retryFile = path.join(dir, '.arbiter-gate1-retry.json');
    expect(fs.existsSync(retryFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(retryFile, 'utf-8'));
    expect(content.gate).toBe('gate1');
    expect(Array.isArray(content.errors)).toBe(true);
  });

  it('retryCount increments on Gate 1 failures', async () => {
    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeConfig());

    fs.writeFileSync(path.join(dir, 'bad.ts'), 'eval("x")');

    const result = await funnel.run('TASK-010', dir);

    expect(result.retryCount).toBeGreaterThan(0);
  });
});
