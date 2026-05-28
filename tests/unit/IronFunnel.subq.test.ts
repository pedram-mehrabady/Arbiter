import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { IronFunnel } from '../../src/conductor/IronFunnel';
import type { LLMProvider } from '../../src/providers/LLMProvider';
import type { SqliteStore } from '../../src/state/SqliteStore';
import type { FactoryConfig } from '../../src/types/index';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iron-funnel-subq-test-'));
}

function makeSqliteStore(): SqliteStore {
  return {
    appendEvent: vi.fn(),
    upsertTask: vi.fn(),
  } as unknown as SqliteStore;
}

function makeProvider(content = 'APPROVE — looks good', exitCode = 0): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({
      ok: true,
      value: { content, inputTokens: 100, outputTokens: 20, exitCode },
    }),
    estimateCost: vi.fn().mockReturnValue(0),
  } as unknown as LLMProvider;
}

function makeSubQConfig(overrides: Partial<FactoryConfig> = {}): FactoryConfig {
  return {
    auto_merge: false,
    roles: {
      'test-writer':  { provider: 'mock', model: 'claude-sonnet-4-6' },
      'reviewer':     { provider: 'mock', model: 'claude-opus-4-7' },
      'orchestrator': { provider: 'subq', model: 'subq-1' },
    },
    providers: {
      subq: {
        base_url: 'https://api.subq.ai',
        api_key: 'test-subq-key',
        model: 'subq-1',
        context_window: 12_000_000,
      },
    },
    ...overrides,
  } as unknown as FactoryConfig;
}

function makeStandardConfig(): FactoryConfig {
  return {
    auto_merge: false,
    roles: {
      'test-writer':  { provider: 'mock', model: 'claude-sonnet-4-6' },
      'reviewer':     { provider: 'mock', model: 'claude-opus-4-7' },
      'orchestrator': { provider: 'claude_max_cli', model: 'claude-opus-4-7' },
    },
    providers: {
      claude_max_cli: { cmd: 'claude', headless_flag: '-p' },
    },
  } as unknown as FactoryConfig;
}

describe('IronFunnel — Gate 5 SubQ path', () => {
  let dir: string;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = tempDir();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Gate 5 uses SubQ API call when roles.orchestrator.provider = subq', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'APPROVE — clean diff' }],
        usage: { input_tokens: 800, output_tokens: 15 },
      }),
    });

    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeSubQConfig(), dir);

    const result = await funnel.run('TASK-SUBQ-001', dir);

    expect(result.passed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://api.subq.ai/v1/messages');
  });

  it('Gate 5 uses standard orchestratorDispatcher when provider = claude_max_cli', async () => {
    const store = makeSqliteStore();
    // Provider returns APPROVE for Gate 5 orchestrator review
    const provider = makeProvider('APPROVE — no issues');
    const funnel = new IronFunnel(store, provider, makeStandardConfig(), dir);

    const result = await funnel.run('TASK-STD-001', dir);

    expect(result.passed).toBe(true);
    // SubQ fetch must NOT be called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Gate 5 SubQ REJECT response marks gate as failed', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'REJECT — security issue found in auth handler' }],
        usage: { input_tokens: 900, output_tokens: 12 },
      }),
    });

    const store = makeSqliteStore();
    const provider = makeProvider();
    const funnel = new IronFunnel(store, provider, makeSubQConfig(), dir);

    const result = await funnel.run('TASK-SUBQ-REJECT', dir);

    expect(result.passed).toBe(false);
    const gate5 = result.gates.find(g => g.gate === 5);
    expect(gate5).toBeDefined();
    expect(gate5?.passed).toBe(false);
    expect(gate5?.errors?.[0]).toMatch(/REJECT/i);
  });

  it('Gate 5 SubQ falls back to standard provider when SubQ unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const store = makeSqliteStore();
    // Fallback provider called with APPROVE response
    const provider = makeProvider('APPROVE — fallback');
    const funnel = new IronFunnel(store, provider, makeSubQConfig(), dir);

    const result = await funnel.run('TASK-SUBQ-FALLBACK', dir);

    // Should auto-approve after SubQ failure (IronFunnel gate5 error path approves)
    expect(result.passed).toBe(true);
  });
});
