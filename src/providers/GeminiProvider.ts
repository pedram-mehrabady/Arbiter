import { LLMProvider } from './LLMProvider';
import { LLMRequest, LLMResponse, RateLimitInfo, ServiceResult } from '../types/index';

// Cost per 1M tokens in USD (Gemini API pricing)
const GEMINI_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gemini-2.5-pro':    { inputPer1M: 1.25,  outputPer1M: 10.0 },
  'gemini-2.5-flash':  { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-2.0-flash':  { inputPer1M: 0.10,  outputPer1M: 0.40 },
  'gemini-1.5-pro':    { inputPer1M: 1.25,  outputPer1M: 5.00 },
  'gemini-1.5-flash':  { inputPer1M: 0.075, outputPer1M: 0.30 },
};

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiProviderOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class GeminiProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: GeminiProviderOptions = {}) {
    this.apiKey  = opts.apiKey  ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? '';
    this.baseUrl = opts.baseUrl ?? GEMINI_API_BASE;
  }

  async invoke(request: LLMRequest): Promise<ServiceResult<LLMResponse>> {
    if (!this.apiKey) {
      return { ok: false, error: 'Gemini API key not set. Set GEMINI_API_KEY or api_key in config.' };
    }

    const url = `${this.baseUrl}/models/${request.model}:generateContent?key=${this.apiKey}`;
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: request.assembledPrompt }] }],
      generationConfig: { maxOutputTokens: request.maxTokens },
    });

    let resp: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      return { ok: false, error: `Gemini request failed: ${String(err)}` };
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      return { ok: false, error: `Gemini API error ${resp.status}: ${text.slice(0, 300)}` };
    }

    let data: {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };
    try {
      data = await resp.json() as typeof data;
    } catch (err) {
      return { ok: false, error: `Failed to parse Gemini response: ${String(err)}` };
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const inputTokens  = data.usageMetadata?.promptTokenCount     ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    const rateLimitInfo: RateLimitInfo = {};

    return {
      ok: true,
      value: { content, inputTokens, outputTokens, rateLimitInfo, exitCode: 0 },
    };
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const p = GEMINI_COSTS[model];
    if (!p) return 0;
    return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
  }
}
