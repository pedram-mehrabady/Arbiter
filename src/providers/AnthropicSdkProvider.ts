import Anthropic from '@anthropic-ai/sdk';
import { LLMRequest, LLMResponse, RateLimitInfo, ServiceResult } from '../types/index';
import { LLMProvider, estimateCost } from './LLMProvider';

export interface AnthropicSdkProviderConfig {
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 300_000;

export class AnthropicSdkProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly timeoutMs: number;

  constructor(config: AnthropicSdkProviderConfig = {}) {
    this.client = new Anthropic({
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      maxRetries: config.maxRetries ?? 2,
    });
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async invoke(request: LLMRequest): Promise<ServiceResult<LLMResponse>> {
    const model = request.model ?? 'claude-sonnet-4-6';
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const message = await this.client.messages.create(
        {
          model,
          max_tokens: 8192,
          messages: [{ role: 'user', content: request.assembledPrompt }],
        },
        { signal: abortController.signal },
      );

      const content = message.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('');

      const inputTokens  = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;

      return {
        ok: true,
        value: {
          content,
          inputTokens,
          outputTokens,
          rateLimitInfo: this.extractRateLimitInfo(message),
          exitCode: 0,
        },
      };
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        return { ok: false, error: `Agent timed out after ${timeoutMs}ms`, code: 'TIMEOUT' };
      }
      if (err instanceof Anthropic.APIError) {
        const status = err.status;
        if (status === 429) {
          return { ok: false, error: `Rate limit exceeded: ${err.message}`, code: 'RATE_LIMIT' };
        }
        if (status === 401) {
          return { ok: false, error: 'Invalid API key (ANTHROPIC_API_KEY)', code: 'AUTH_ERROR' };
        }
        return { ok: false, error: `Anthropic API error ${status}: ${err.message}`, code: 'API_ERROR' };
      }
      return { ok: false, error: `SDK error: ${String(err)}`, code: 'SDK_ERROR' };
    } finally {
      clearTimeout(timer);
    }
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    return estimateCost(model, inputTokens, outputTokens);
  }

  private extractRateLimitInfo(message: Anthropic.Message): RateLimitInfo {
    // The SDK doesn't expose raw headers directly on the message object.
    // Rate limit info is available via response headers in streaming mode.
    // For non-streaming, we rely on the usage object and retry logic.
    void message;
    return {};
  }
}
