import { LLMProvider } from './LLMProvider';
import { LLMRequest, LLMResponse, RateLimitInfo, ServiceResult } from '../types/index';

// Cost per 1M tokens in USD
const OPENAI_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gpt-4o':            { inputPer1M: 2.5,  outputPer1M: 10.0 },
  'gpt-4o-mini':       { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4-turbo':       { inputPer1M: 10.0, outputPer1M: 30.0 },
  'gpt-4':             { inputPer1M: 30.0, outputPer1M: 60.0 },
  'o1':                { inputPer1M: 15.0, outputPer1M: 60.0 },
  'o1-mini':           { inputPer1M: 3.0,  outputPer1M: 12.0 },
  'o3-mini':           { inputPer1M: 1.1,  outputPer1M: 4.4  },
};

const OPENAI_API_BASE = 'https://api.openai.com/v1';

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class OpenAIProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.apiKey  = opts.apiKey  ?? process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = opts.baseUrl ?? OPENAI_API_BASE;
  }

  async invoke(request: LLMRequest): Promise<ServiceResult<LLMResponse>> {
    if (!this.apiKey) {
      return { ok: false, error: 'OpenAI API key not set. Set OPENAI_API_KEY or api_key in config.' };
    }

    const body = JSON.stringify({
      model: request.model,
      messages: [{ role: 'user', content: request.assembledPrompt }],
      max_tokens: request.maxTokens,
    });

    let resp: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      return { ok: false, error: `OpenAI request failed: ${String(err)}` };
    }

    const rateLimitInfo: RateLimitInfo = {
      requestsLimit:     parseIntHeader(resp.headers.get('x-ratelimit-limit-requests')),
      requestsRemaining: parseIntHeader(resp.headers.get('x-ratelimit-remaining-requests')),
      tokensLimit:       parseIntHeader(resp.headers.get('x-ratelimit-limit-tokens')),
      tokensRemaining:   parseIntHeader(resp.headers.get('x-ratelimit-remaining-tokens')),
      resetAt:           resp.headers.get('x-ratelimit-reset-requests') ?? undefined,
    };

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      return { ok: false, error: `OpenAI API error ${resp.status}: ${text.slice(0, 300)}` };
    }

    let data: {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    try {
      data = await resp.json() as typeof data;
    } catch (err) {
      return { ok: false, error: `Failed to parse OpenAI response: ${String(err)}` };
    }

    const content = data.choices[0]?.message?.content ?? '';
    const inputTokens  = data.usage?.prompt_tokens     ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    return {
      ok: true,
      value: { content, inputTokens, outputTokens, rateLimitInfo, exitCode: 0 },
    };
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const p = OPENAI_COSTS[model];
    if (!p) return 0;
    return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
  }
}

function parseIntHeader(val: string | null): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}
