import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LLMRequest, LLMResponse, RateLimitInfo, ServiceResult } from '../types/index';
import { LLMProvider, estimateCost, estimateTokenCount } from './LLMProvider';

export interface AnthropicProviderConfig {
  cmd: string;
  headlessFlag: string;
  timeoutMs?: number;
}

const DEFAULT_CONFIG: AnthropicProviderConfig = {
  cmd: 'claude',
  headlessFlag: '-p',
  timeoutMs: 300_000,
};

// Token counts are approximated from output length when not available from the CLI.
// Rate-limit headers are scraped from stderr if the provider emits them.
const RATE_LIMIT_PATTERNS = {
  requestsLimit:     /x-ratelimit-limit-requests:\s*(\d+)/i,
  requestsRemaining: /x-ratelimit-remaining-requests:\s*(\d+)/i,
  tokensLimit:       /x-ratelimit-limit-tokens:\s*(\d+)/i,
  tokensRemaining:   /x-ratelimit-remaining-tokens:\s*(\d+)/i,
  resetAt:           /x-ratelimit-reset-requests:\s*([^\s]+)/i,
};

export class AnthropicProvider implements LLMProvider {
  private readonly config: AnthropicProviderConfig;

  constructor(config: Partial<AnthropicProviderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async invoke(request: LLMRequest): Promise<ServiceResult<LLMResponse>> {
    const tmpFile = path.join(
      os.tmpdir(),
      `arbiter-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );

    try {
      // Write prompt to a temp file to avoid shell arg-length limits
      await fs.writeFile(tmpFile, request.assembledPrompt, 'utf-8');
      return await this.spawnClaude(request, tmpFile);
    } finally {
      await fs.unlink(tmpFile).catch(() => undefined);
    }
  }

  private spawnClaude(request: LLMRequest, promptFile: string): Promise<ServiceResult<LLMResponse>> {
    return new Promise(resolve => {
      const args = [this.config.headlessFlag, `--file ${promptFile}`];
      if (request.model) args.push('--model', request.model);

      const proc = spawn(this.config.cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';
      const timeoutMs = request.timeoutMs ?? this.config.timeoutMs ?? 300_000;

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({ ok: false, error: `Agent timed out after ${timeoutMs}ms`, code: 'TIMEOUT' });
      }, timeoutMs);

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', exitCode => {
        clearTimeout(timer);

        if (exitCode !== 0) {
          resolve({
            ok: false,
            error: `Claude exited ${exitCode}: ${stderr.slice(0, 500)}`,
            code: 'NONZERO_EXIT',
          });
          return;
        }

        const inputTokens = estimateTokenCount(request.assembledPrompt);
        const outputTokens = estimateTokenCount(stdout);

        resolve({
          ok: true,
          value: {
            content: stdout.trim(),
            inputTokens,
            outputTokens,
            rateLimitInfo: this.parseRateLimitInfo(stderr),
            exitCode: exitCode ?? 0,
          },
        });
      });

      proc.on('error', err => {
        clearTimeout(timer);
        resolve({ ok: false, error: `Failed to spawn claude: ${err.message}`, code: 'SPAWN_ERROR' });
      });
    });
  }

  private parseRateLimitInfo(stderr: string): RateLimitInfo {
    const info: RateLimitInfo = {};

    for (const [key, pattern] of Object.entries(RATE_LIMIT_PATTERNS)) {
      const match = pattern.exec(stderr);
      if (match?.[1]) {
        if (key === 'resetAt') {
          info.resetAt = match[1];
        } else {
          (info as Record<string, number>)[key] = parseInt(match[1], 10);
        }
      }
    }

    return info;
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    return estimateCost(model, inputTokens, outputTokens);
  }
}
