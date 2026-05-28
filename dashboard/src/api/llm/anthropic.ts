import Anthropic from '@anthropic-ai/sdk';
import { EXTRACTION_SYSTEM_PROMPT } from './types';
import type { ExtractedFeature } from './types';

export class AnthropicAdapter {
  name = 'Claude (Anthropic)';
  private client: Anthropic;

  constructor(private apiKey: string, private model = 'claude-opus-4-7') {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  isConfigured() { return Boolean(this.apiKey); }

  async extractFeatures(document: string): Promise<ExtractedFeature[]> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: document }],
    });
    const block = msg.content.find((b) => b.type === 'text');
    const text = block?.type === 'text' ? block.text : '{"features":[]}';
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed.features) ? parsed.features : [];
    } catch {
      return [];
    }
  }
}
