import { LLMRequest, LLMResponse, ServiceResult } from '../types/index';
import { LLMProvider, estimateCost } from './LLMProvider';

export interface SubQConfig {
  base_url: string;
  api_key: string;
  model: string;
  context_window: number;
}

// SubQ is Anthropic API-compatible, so we reuse the same request/response shapes.
// When SubQ is unreachable, we fall back to the configured fallback provider + model.
export class SubQProvider implements LLMProvider {
  constructor(
    private readonly config: SubQConfig,
    private readonly fallbackProvider: LLMProvider,
    private readonly fallbackModel: string,
  ) {}

  async invoke(request: LLMRequest): Promise<ServiceResult<LLMResponse>> {
    try {
      const controller = new AbortController();
      const timeoutMs = request.timeoutMs ?? 300_000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(`${this.config.base_url}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.api_key}`,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: 'user', content: request.assembledPrompt }],
            max_tokens: request.maxTokens ?? 8192,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new Error(`SubQ HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as {
        content: Array<{ type: string; text: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };

      const content = data.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      return {
        ok: true,
        value: {
          content,
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          rateLimitInfo: {},
          exitCode: 0,
        },
      };
    } catch (err) {
      console.warn(`[SubQProvider] SubQ unavailable — falling back to ${this.fallbackModel}: ${(err as Error).message}`);
      return this.fallbackProvider.invoke({ ...request, model: this.fallbackModel });
    }
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    return estimateCost(model, inputTokens, outputTokens);
  }
}
