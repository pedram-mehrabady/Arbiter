import { LLMRequest, LLMResponse, ServiceResult } from '../types/index';

// Cost per 1M tokens in USD — update when pricing changes
export const MODEL_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-opus-4-7':          { inputPer1M: 15.0,  outputPer1M: 75.0  },
  'claude-sonnet-4-6':        { inputPer1M: 3.0,   outputPer1M: 15.0  },
  'claude-haiku-4-5-20251001':{ inputPer1M: 0.25,  outputPer1M: 1.25  },
  'claude-haiku-4-5':         { inputPer1M: 0.25,  outputPer1M: 1.25  },
};

export interface LLMProvider {
  invoke(request: LLMRequest): Promise<ServiceResult<LLMResponse>>;
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_COSTS[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.inputPer1M +
         (outputTokens / 1_000_000) * pricing.outputPer1M;
}

// Rough token estimate: 1 token ≈ 4 characters
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
