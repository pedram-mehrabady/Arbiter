import { LLMRequest, LLMResponse, ServiceResult } from '../types/index';
import { LLMProvider, estimateTokenCount } from './LLMProvider';

export interface OllamaProviderConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_TIMEOUT_MS = 300_000;

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: OllamaProviderConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async invoke(request: LLMRequest): Promise<ServiceResult<LLMResponse>> {
    const model = request.model ?? 'llama3';
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const resp = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: request.assembledPrompt,
          stream: false,
        }),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        return {
          ok: false,
          error: `Ollama returned HTTP ${resp.status}: ${body.slice(0, 300)}`,
          code: 'API_ERROR',
        };
      }

      const data = (await resp.json()) as OllamaGenerateResponse;
      const inputTokens  = data.prompt_eval_count ?? estimateTokenCount(request.assembledPrompt);
      const outputTokens = data.eval_count        ?? estimateTokenCount(data.response);

      return {
        ok: true,
        value: {
          content: data.response,
          inputTokens,
          outputTokens,
          rateLimitInfo: {},
          exitCode: 0,
        },
      };
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        return { ok: false, error: `Agent timed out after ${timeoutMs}ms`, code: 'TIMEOUT' };
      }
      const msg = (err as Error).message ?? String(err);
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        return {
          ok: false,
          error: `Cannot reach Ollama at ${this.baseUrl} — is it running?`,
          code: 'CONNECTION_ERROR',
        };
      }
      return { ok: false, error: `Ollama error: ${msg}`, code: 'SDK_ERROR' };
    } finally {
      clearTimeout(timer);
    }
  }

  estimateCost(_model: string, _inputTokens: number, _outputTokens: number): number {
    return 0; // Ollama is local — no cost
  }
}
