import fs from 'node:fs/promises';
import path from 'node:path';
import { RateLimitInfo, UsageLedgerEntry, AgentRole, ServiceResult } from '../types/index';
import { estimateCost } from '../providers/LLMProvider';

const USAGE_FILE = path.join('.arbiter', 'usage.jsonl');
const CONTEXT_WARNING_THRESHOLD = 70_000;

export interface RateLimiterConfig {
  dailyCap: number;
  pauseOnRateLimitMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  dailyCap: 30.0,
  pauseOnRateLimitMs: 60_000,
};

export class RateLimiter {
  private readonly usagePath: string;
  private readonly config: RateLimiterConfig;

  constructor(workspaceRoot: string, config: Partial<RateLimiterConfig> = {}) {
    this.usagePath = path.join(workspaceRoot, USAGE_FILE);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async record(
    taskId: string,
    subTask: string,
    agentRole: AgentRole,
    model: string,
    inputTokens: number,
    outputTokens: number,
    contextTokens?: number,
  ): Promise<ServiceResult<UsageLedgerEntry>> {
    const cost = estimateCost(model, inputTokens, outputTokens);
    const todayTotal = await this.getTodayTotal();

    const contextWarning = contextTokens !== undefined && contextTokens > CONTEXT_WARNING_THRESHOLD;
    if (contextWarning) {
      console.warn(
        `\n⚠ Context warning: ${contextTokens} tokens in assembled context for ${subTask}.` +
        `  Threshold: ${CONTEXT_WARNING_THRESHOLD}. Consider enabling ContextPruner.`,
      );
    }

    const entry: UsageLedgerEntry = {
      ts: new Date().toISOString(),
      task_id: taskId,
      sub_task: subTask,
      agent_role: agentRole,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: cost,
      total_cost_today_usd: todayTotal + cost,
      context_tokens: contextTokens,
      context_warning: contextWarning || undefined,
    };

    const writeResult = await this.appendEntry(entry);
    if (!writeResult.ok) return writeResult;

    return { ok: true, value: entry };
  }

  async checkDailyCap(): Promise<ServiceResult<{ allowed: boolean; spent: number; cap: number }>> {
    const spent = await this.getTodayTotal();
    return {
      ok: true,
      value: { allowed: spent < this.config.dailyCap, spent, cap: this.config.dailyCap },
    };
  }

  // React to rate-limit headers from the provider response
  async handleRateLimitInfo(info: RateLimitInfo): Promise<ServiceResult<void>> {
    if (info.requestsRemaining === 0 || info.tokensRemaining === 0) {
      const resetAt = info.resetAt ? new Date(info.resetAt) : null;
      const waitMs = resetAt
        ? Math.max(0, resetAt.getTime() - Date.now())
        : this.config.pauseOnRateLimitMs;

      console.log(`\nRate limit hit. Pausing ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
    }
    return { ok: true, value: undefined };
  }

  async getHeadroom(): Promise<number> {
    const capResult = await this.checkDailyCap();
    if (!capResult.ok) return 0;
    const { spent, cap } = capResult.value;
    return Math.max(0, 1 - spent / cap);
  }

  async getTodayTotal(): Promise<number> {
    const entries = await this.readTodayEntries();
    return entries.reduce((sum, e) => sum + e.cost_usd, 0);
  }

  private async readTodayEntries(): Promise<UsageLedgerEntry[]> {
    try {
      const content = await fs.readFile(this.usagePath, 'utf-8');
      const today = new Date().toISOString().slice(0, 10);
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as UsageLedgerEntry)
        .filter(e => e.ts.startsWith(today));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  private async appendEntry(entry: UsageLedgerEntry): Promise<ServiceResult<void>> {
    try {
      await fs.mkdir(path.dirname(this.usagePath), { recursive: true });
      await fs.appendFile(this.usagePath, JSON.stringify(entry) + '\n', 'utf-8');
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to append usage: ${String(err)}` };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
