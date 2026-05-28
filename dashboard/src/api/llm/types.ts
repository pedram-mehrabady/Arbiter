import type { PlanAnalysis, ChatMessage, PlanType } from '../types';

export interface LLMAdapter {
  name: string;
  isConfigured(): boolean;
  analyzePlan(requirements: string, existingJobs?: number): Promise<PlanAnalysis>;
  extractFeatures(document: string): Promise<ExtractedFeature[]>;
  chat(messages: ChatMessage[]): Promise<string>;
}

export const ANALYSIS_SYSTEM_PROMPT = `You are a senior software architect analyzing a feature request for the Foederata pipeline.
Given a feature description, respond with a JSON object:
{
  "ticket": "FEAT-XX",
  "title": "Short feature title (max 8 words)",
  "complexity": "Simple | Medium | Complex | Epic",
  "requirements": "The original requirements text",
  "estimated_stages": {
    "reframe": "Xm",
    "research": "Xm",
    "design": "Xh",
    "frontend": "Xh",
    "backend": "Xh",
    "push": "Xm"
  }
}
Complexity guide: Simple = 1 day, Medium = 2-3 days, Complex = 1 week, Epic = 2+ weeks.
Respond ONLY with the JSON object, no markdown.`;

export interface ExtractedFeature {
  key: string;
  title: string;
  description: string;
  planType: PlanType;
  complexity: 'Simple' | 'Medium' | 'Complex' | 'Epic';
}

export const EXTRACTION_SYSTEM_PROMPT = `You are a senior product analyst. Extract ALL distinct features, tasks, bugs, and improvements from the requirements document provided.

For each item return:
{
  "key": "kebab-slug-from-title",
  "title": "Short title, max 8 words",
  "description": "2–3 sentence description of exactly what this item entails",
  "planType": "feature | bug | refactor | chore",
  "complexity": "Simple | Medium | Complex | Epic"
}

planType rules:
  feature  = new functionality, new screens, new APIs
  bug      = something broken or incorrect
  refactor = code quality change, no new behaviour
  chore    = dependencies, config, tooling, documentation

Complexity: Simple = 1 day, Medium = 2–3 days, Complex = 1 week, Epic = 2+ weeks.

Extract EVERY item mentioned, even briefly. Do not skip or merge items.
Respond ONLY with: { "features": [ ... ] }`;
