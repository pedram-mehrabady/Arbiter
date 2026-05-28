import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubQProvider } from '../../src/providers/SubQProvider';
import type { LLMProvider } from '../../src/providers/LLMProvider';
import type { LLMRequest, LLMResponse, ServiceResult } from '../../src/types/index';

function makeConfig(overrides: Partial<{ base_url: string; api_key: string; model: string; context_window: number }> = {}) {
  return {
    base_url: 'https://api.subq.ai',
    api_key: 'test-key',
    model: 'subq-1',
    context_window: 12_000_000,
    ...overrides,
  };
}

function makeFallbackProvider(response: ServiceResult<LLMResponse>): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue(response),
    estimateCost: vi.fn().mockReturnValue(0),
  };
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    assembledPrompt: 'Review this code',
    agentRole: 'reviewer',
    model: 'subq-1',
    ...overrides,
  };
}

const SUBQ_SUCCESS = {
  content: [{ type: 'text', text: 'APPROVE — code looks good' }],
  usage: { input_tokens: 500, output_tokens: 20 },
};

describe('SubQProvider', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends correct request format to SubQ API', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => SUBQ_SUCCESS,
    });

    const fallback = makeFallbackProvider({ ok: true, value: { content: '', inputTokens: 0, outputTokens: 0, exitCode: 0 } });
    const provider = new SubQProvider(makeConfig(), fallback, 'claude-opus-4-7');

    await provider.invoke(makeRequest({ assembledPrompt: 'test prompt' }));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.subq.ai/v1/messages');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('subq-1');
    expect(body.messages).toEqual([{ role: 'user', content: 'test prompt' }]);
  });

  it('parses Anthropic-compatible response correctly', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'APPROVE ' }, { type: 'text', text: '— clean diff' }],
        usage: { input_tokens: 300, output_tokens: 10 },
      }),
    });

    const fallback = makeFallbackProvider({ ok: true, value: { content: '', inputTokens: 0, outputTokens: 0, exitCode: 0 } });
    const provider = new SubQProvider(makeConfig(), fallback, 'claude-opus-4-7');

    const result = await provider.invoke(makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('APPROVE — clean diff');
    expect(result.value.inputTokens).toBe(300);
    expect(result.value.outputTokens).toBe(10);
    expect(result.value.exitCode).toBe(0);
  });

  it('falls back to fallback provider when SubQ is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const fallbackResult: ServiceResult<LLMResponse> = {
      ok: true,
      value: { content: 'fallback response', inputTokens: 100, outputTokens: 10, exitCode: 0 },
    };
    const fallback = makeFallbackProvider(fallbackResult);
    const provider = new SubQProvider(makeConfig(), fallback, 'claude-opus-4-7');

    const result = await provider.invoke(makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('fallback response');
    expect(fallback.invoke).toHaveBeenCalledOnce();

    const callArg = (fallback.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as LLMRequest;
    expect(callArg.model).toBe('claude-opus-4-7');
  });

  it('falls back when SubQ returns non-OK HTTP status', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const fallbackResult: ServiceResult<LLMResponse> = {
      ok: true,
      value: { content: 'opus fallback', inputTokens: 50, outputTokens: 5, exitCode: 0 },
    };
    const fallback = makeFallbackProvider(fallbackResult);
    const provider = new SubQProvider(makeConfig(), fallback, 'claude-opus-4-7');

    const result = await provider.invoke(makeRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('opus fallback');
    expect(fallback.invoke).toHaveBeenCalledOnce();
  });

  it('estimateCost delegates to shared estimateCost function', () => {
    const fallback = makeFallbackProvider({ ok: true, value: { content: '', inputTokens: 0, outputTokens: 0, exitCode: 0 } });
    const provider = new SubQProvider(makeConfig(), fallback, 'claude-opus-4-7');
    expect(provider.estimateCost('unknown-model', 1000, 500)).toBe(0);
    expect(provider.estimateCost('claude-opus-4-7', 1_000_000, 0)).toBeGreaterThan(0);
  });
});
