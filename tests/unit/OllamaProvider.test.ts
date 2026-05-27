import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../../src/providers/OllamaProvider';

function mockFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: response.json ?? (() => Promise.resolve({})),
    text: response.text ?? (() => Promise.resolve('')),
  } as Response);
}

function ollamaSuccess(responseText: string, evalCount = 50, promptEvalCount = 100) {
  return {
    model: 'llama3',
    response: responseText,
    done: true,
    eval_count: evalCount,
    prompt_eval_count: promptEvalCount,
  };
}

describe('OllamaProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns content and token counts on success', async () => {
    const provider = new OllamaProvider();
    mockFetch({ ok: true, json: () => Promise.resolve(ollamaSuccess('Hello from Ollama')) });

    const result = await provider.invoke({
      assembledPrompt: 'Test prompt',
      agentRole: 'reframe',
      model: 'llama3',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Hello from Ollama');
    expect(result.value.inputTokens).toBe(100);
    expect(result.value.outputTokens).toBe(50);
    expect(result.value.exitCode).toBe(0);
  });

  it('POSTs to the correct endpoint', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    const spy = mockFetch({ ok: true, json: () => Promise.resolve(ollamaSuccess('ok')) });

    await provider.invoke({ assembledPrompt: 'p', agentRole: 'reframe', model: 'llama3' });

    expect(spy).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('llama3');
    expect(body.stream).toBe(false);
  });

  it('strips trailing slash from baseUrl', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434/' });
    const spy = mockFetch({ ok: true, json: () => Promise.resolve(ollamaSuccess('ok')) });

    await provider.invoke({ assembledPrompt: 'p', agentRole: 'reframe', model: 'llama3' });

    expect((spy.mock.calls[0][0] as string)).toBe('http://localhost:11434/api/generate');
  });

  it('returns API_ERROR on non-ok HTTP status', async () => {
    const provider = new OllamaProvider();
    mockFetch({ ok: false, status: 404, text: () => Promise.resolve('not found') });

    const result = await provider.invoke({
      assembledPrompt: 'p',
      agentRole: 'reframe',
      model: 'llama3',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('API_ERROR');
      expect(result.error).toContain('404');
    }
  });

  it('returns CONNECTION_ERROR when fetch throws ECONNREFUSED', async () => {
    const provider = new OllamaProvider();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
    );

    const result = await provider.invoke({
      assembledPrompt: 'p',
      agentRole: 'reframe',
      model: 'llama3',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CONNECTION_ERROR');
  });

  it('returns TIMEOUT on AbortError', async () => {
    const provider = new OllamaProvider({ timeoutMs: 50 });
    const err = new Error('aborted');
    err.name = 'AbortError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(err);

    const result = await provider.invoke({
      assembledPrompt: 'p',
      agentRole: 'reframe',
      model: 'llama3',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TIMEOUT');
  });

  it('falls back to estimated token counts when eval_count missing', async () => {
    const provider = new OllamaProvider();
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ model: 'llama3', response: 'short answer', done: true }),
    });

    const result = await provider.invoke({
      assembledPrompt: 'twelve char',
      agentRole: 'reframe',
      model: 'llama3',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Estimated: ceil(length / 4)
    expect(result.value.inputTokens).toBe(Math.ceil('twelve char'.length / 4));
    expect(result.value.outputTokens).toBe(Math.ceil('short answer'.length / 4));
  });

  it('estimateCost always returns 0 (local model)', () => {
    const provider = new OllamaProvider();
    expect(provider.estimateCost('llama3', 1_000_000, 1_000_000)).toBe(0);
  });
});
