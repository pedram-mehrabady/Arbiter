import { anthropicCreateMessage } from '../anthropicRest';
import { EXTRACTION_SYSTEM_PROMPT } from './types';
import type { ExtractedFeature } from './types';

export class AnthropicAdapter {
  name = 'Claude (Anthropic)';

  constructor(private apiKey: string, private model = 'claude-opus-4-7') {}

  isConfigured() { return Boolean(this.apiKey); }

  async extractFeatures(document: string): Promise<ExtractedFeature[]> {
    const text = await anthropicCreateMessage({
      apiKey: this.apiKey,
      model: this.model,
      maxTokens: 4096,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: document }],
    }) || '{"features":[]}';
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed.features) ? parsed.features : [];
    } catch {
      return [];
    }
  }
}
