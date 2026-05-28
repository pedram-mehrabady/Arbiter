import fs from 'node:fs/promises';
import path from 'node:path';
import { TriageResult, ServiceResult } from '../types/index';
import { LLMProvider } from '../providers/LLMProvider';

const TRIAGE_RULES_PATH = path.join('agents', 'triage', 'rules.md');
const TRIAGE_TOKEN_BUDGET = 4_000;

const FALLBACK: TriageResult = {
  tier: 3,
  profile: 'unknown',
  reason: 'Classification failed — defaulting to full pipeline',
  bypass_phase1: false,
  estimated_agents: 14,
  complexity_hint: 'high',
};

export class TriageRunner {
  private readonly workspaceRoot: string;
  private readonly provider: LLMProvider;

  constructor(workspaceRoot: string, provider: LLMProvider) {
    this.workspaceRoot = workspaceRoot;
    this.provider = provider;
  }

  async run(taskId: string, taskMdPath: string): Promise<ServiceResult<TriageResult>> {
    const systemPrompt = await this.loadRuleBook();
    const userPrompt = await this.buildUserPrompt(taskMdPath);

    // Enforce 4k token budget — truncate user prompt if needed
    const truncatedPrompt = this.truncateToTokenBudget(userPrompt, TRIAGE_TOKEN_BUDGET);

    let rawOutput: string;
    try {
      const result = await this.provider.invoke({
        model: 'claude-haiku-4-5-20251001',
        assembledPrompt: `${systemPrompt}\n\n${truncatedPrompt}`,
        maxTokens: 256,
        timeoutMs: 30_000,
        agentRole: 'triage',
      });

      if (!result.ok || result.value.exitCode !== 0) {
        return { ok: true, value: FALLBACK };
      }
      rawOutput = result.value.content;
    } catch {
      return { ok: true, value: FALLBACK };
    }

    const parsed = this.parseTriageJson(rawOutput);
    return { ok: true, value: parsed };
  }

  private async loadRuleBook(): Promise<string> {
    const rulebookPath = path.join(this.workspaceRoot, TRIAGE_RULES_PATH);
    try {
      return await fs.readFile(rulebookPath, 'utf-8');
    } catch {
      // Fallback to embedded minimal instructions if file missing
      return 'Classify the task into tier 1 (trivial), 2 (fix), or 3 (feature). Output only valid JSON matching the triage schema.';
    }
  }

  private async buildUserPrompt(taskMdPath: string): Promise<string> {
    const parts: string[] = [];

    try {
      const taskContent = await fs.readFile(taskMdPath, 'utf-8');
      parts.push(`# task.md\n\n${taskContent}`);
    } catch {
      parts.push('# task.md\n\n(file not found)');
    }

    const configPath = path.join(this.workspaceRoot, 'arbiter.config.json');
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      parts.push(`# arbiter.config.json\n\n${configContent}`);
    } catch {
      // Config optional for triage
    }

    return parts.join('\n\n');
  }

  private truncateToTokenBudget(text: string, tokenBudget: number): string {
    // Rough approximation: 1 token ≈ 4 characters
    const charBudget = tokenBudget * 4;
    if (text.length <= charBudget) return text;
    return text.slice(0, charBudget) + '\n\n[... truncated to fit token budget ...]';
  }

  private parseTriageJson(raw: string): TriageResult {
    // Extract JSON from the response — model may wrap it in markdown code blocks
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : raw;

    try {
      const parsed = JSON.parse(jsonStr.trim()) as Partial<TriageResult>;
      return this.validate(parsed);
    } catch {
      return FALLBACK;
    }
  }

  private validate(parsed: Partial<TriageResult>): TriageResult {
    const tier = parsed.tier;
    if (tier !== 1 && tier !== 2 && tier !== 3) return FALLBACK;

    return {
      tier,
      profile: typeof parsed.profile === 'string' ? parsed.profile : 'unknown',
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'no reason provided',
      bypass_phase1: tier !== 3,
      estimated_agents: tier === 1 ? 2 : tier === 2 ? 4 : 14,
      complexity_hint: tier === 1 ? 'low' : tier === 2 ? 'medium' : 'high',
    };
  }
}
