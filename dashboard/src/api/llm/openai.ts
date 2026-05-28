import OpenAI from 'openai';
import type { LLMAdapter, ExtractedFeature } from './types';
import { ANALYSIS_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT } from './types';
import type { PlanAnalysis, ChatMessage } from '../types';

export class OpenAIAdapter implements LLMAdapter {
  name = 'OpenAI';
  private client: OpenAI;

  constructor(private apiKey: string, private model: string) {
    this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  }

  isConfigured() { return Boolean(this.apiKey); }

  async analyzePlan(requirements: string, existingJobs = 0): Promise<PlanAnalysis> {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: `Ticket number offset: ${50 + existingJobs}\n\nRequirements:\n${requirements}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    const text = resp.choices[0].message.content ?? '{}';
    return { ...JSON.parse(text), requirements } as PlanAnalysis;
  }

  async extractFeatures(document: string): Promise<ExtractedFeature[]> {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: document },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
    const text = resp.choices[0].message.content ?? '{"features":[]}';
    const parsed = JSON.parse(text);
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
