import OpenAI from 'openai';
import type { LLMAdapter, ExtractedFeature } from './types';
import { ANALYSIS_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT } from './types';
import type { PlanAnalysis, ChatMessage } from '../types';

export class KimiAdapter implements LLMAdapter {
  name = 'Kimi (Moonshot)';
  private client: OpenAI;

  constructor(private apiKey: string, private model: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.moonshot.cn/v1',
      dangerouslyAllowBrowser: true,
    });
  }

  isConfigured() { return Boolean(this.apiKey); }

  async analyzePlan(requirements: string, existingJobs = 0): Promise<PlanAnalysis> {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: `Ticket number offset: ${50 + existingJobs}\n\nRequirements:\n${requirements}` },
      ],
      temperature: 0.3,
    });
    const text = resp.choices[0].message.content ?? '{}';
    // Kimi may wrap JSON in markdown
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    return { ...JSON.parse(cleaned), requirements } as PlanAnalysis;
  }

  async extractFeatures(document: string): Promise<ExtractedFeature[]> {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: document },
      ],
      temperature: 0.2,
    });
    const text = resp.choices[0].message.content ?? '{"features":[]}';
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed.features) ? parsed.features : [];
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.7,
    });
    return resp.choices[0].message.content ?? '';
  }
}
