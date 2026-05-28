import type { LLMAdapter, ExtractedFeature } from './types';
import { ANALYSIS_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT } from './types';
import type { PlanAnalysis, ChatMessage } from '../types';

export class LocalLLMAdapter implements LLMAdapter {
  name = 'Local LLM (Ollama)';

  constructor(private baseUrl: string, private model: string) {}

  isConfigured() { return Boolean(this.baseUrl); }

  private async post(path: string, body: object): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async analyzePlan(requirements: string, existingJobs = 0): Promise<PlanAnalysis> {
    const resp = await this.post('/v1/chat/completions', {
      model: this.model,
      messages: [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: `Ticket number offset: ${50 + existingJobs}\n\nRequirements:\n${requirements}` },
      ],
      format: 'json',
      temperature: 0.3,
      stream: false,
    });
    if (!resp.ok) throw new Error(`Local LLM error: ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? '{}';
    return { ...JSON.parse(text), requirements } as PlanAnalysis;
  }

  async extractFeatures(document: string): Promise<ExtractedFeature[]> {
    const resp = await this.post('/v1/chat/completions', {
      model: this.model,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: document },
      ],
      format: 'json',
      temperature: 0.2,
      stream: false,
    });
    if (!resp.ok) throw new Error(`Local LLM error: ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? '{"features":[]}';
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.features) ? parsed.features : [];
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const resp = await this.post('/v1/chat/completions', {
      model: this.model,
      messages,
      stream: false,
    });
    if (!resp.ok) throw new Error(`Local LLM error: ${resp.status}`);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}
