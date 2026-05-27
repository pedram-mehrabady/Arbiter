import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicSdkProvider } from '../../src/providers/AnthropicSdkProvider';

// Hoist mock so it's available before imports are resolved
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  // Attach APIError so the provider can catch it
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }
  (MockAnthropic as unknown as Record<string, unknown>).APIError = APIError;
  return { default: MockAnthropic };
});

// Re-import after mock is set up
import Anthropic from '@anthropic-ai/sdk';

function getMessagesMock() {
  const instance = (Anthropic as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
    messages: { create: ReturnType<typeof vi.fn> };
  };
  return instance?.messages.create;
}

function makeSuccessResponse(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe('AnthropicSdkProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh constructor call so getMessagesMock() finds the right instance
    new AnthropicSdkProvider();
  });

  it('returns content and token counts on success', async () => {
    const provider = new AnthropicSdkProvider({ apiKey: 'test-key' });
    const mock = getMessagesMock();
    mock.mockResolvedValueOnce(makeSuccessResponse('Hello world', 200, 50));

    const result = await provider.invoke({
      assembledPrompt: 'Test prompt',
      agentRole: 'reframe',
      model: 'claude-sonnet-4-6',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Hello world');
    expect(result.value.inputTokens).toBe(200);
    expect(result.value.outputTokens).toBe(50);
    expect(result.value.exitCode).toBe(0);
  });

  it('concatenates multiple text blocks', async () => {
    const provider = new AnthropicSdkProvider({ apiKey: 'test-key' });
    const mock = getMessagesMock();
    mock.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Part 1 ' },
        { type: 'text', text: 'Part 2' },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const result = await provider.invoke({
      assembledPrompt: 'prompt',
      agentRole: 'reframe',
      model: 'claude-sonnet-4-6',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Part 1 Part 2');
  });

  it('returns RATE_LIMIT error on 429', async () => {
    const provider = new AnthropicSdkProvider({ apiKey: 'test-key' });
    const mock = getMessagesMock();
    const err = new (Anthropic as unknown as { APIError: new (s: number, m: string) => Error }).APIError(429, 'rate limited');
    mock.mockRejectedValueOnce(err);

    const result = await provider.invoke({
      assembledPrompt: 'prompt',
      agentRole: 'reframe',
      model: 'claude-sonnet-4-6',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('RATE_LIMIT');
  });

  it('returns AUTH_ERROR on 401', async () => {
    const provider = new AnthropicSdkProvider({ apiKey: 'bad-key' });
    const mock = getMessagesMock();
    const err = new (Anthropic as unknown as { APIError: new (s: number, m: string) => Error }).APIError(401, 'unauthorized');
    mock.mockRejectedValueOnce(err);

    const result = await provider.invoke({
      assembledPrompt: 'prompt',
      agentRole: 'reframe',
      model: 'claude-sonnet-4-6',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AUTH_ERROR');
  });

  it('returns API_ERROR on other HTTP errors', async () => {
    const provider = new AnthropicSdkProvider({ apiKey: 'test-key' });
    const mock = getMessagesMock();
    const err = new (Anthropic as unknown as { APIError: new (s: number, m: string) => Error }).APIError(500, 'server error');
    mock.mockRejectedValueOnce(err);

    const result = await provider.invoke({
      assembledPrompt: 'prompt',
      agentRole: 'reframe',
      model: 'claude-sonnet-4-6',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('API_ERROR');
  });

  it('returns TIMEOUT on AbortError', async () => {
    const provider = new AnthropicSdkProvider({ apiKey: 'test-key', timeoutMs: 50 });
    const mock = getMessagesMock();
    const err = new Error('aborted');
    err.name = 'AbortError';
    mock.mockRejectedValueOnce(err);

    const result = await provider.invoke({
      assembledPrompt: 'prompt',
      agentRole: 'reframe',
      model: 'claude-sonnet-4-6',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TIMEOUT');
  });

  it('estimateCost returns 0 for unknown model', () => {
    const provider = new AnthropicSdkProvider();
    expect(provider.estimateCost('unknown-model', 1000, 500)).toBe(0);
  });

  it('estimateCost returns positive value for known model', () => {
    const provider = new AnthropicSdkProvider();
    expect(provider.estimateCost('claude-sonnet-4-6', 1_000_000, 0)).toBeGreaterThan(0);
  });
});
