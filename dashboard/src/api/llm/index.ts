import { AnthropicAdapter } from './anthropic';
import type { AppSettings } from '../types';

export function createLLMAdapter(settings: AppSettings): AnthropicAdapter {
  return new AnthropicAdapter(settings.anthropicApiKey ?? '');
}

export { AnthropicAdapter };
export type { ExtractedFeature } from './types';
