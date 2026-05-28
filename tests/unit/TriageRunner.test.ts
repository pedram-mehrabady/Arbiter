import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { TriageRunner } from '../../src/triage/TriageRunner';
import type { LLMResponse } from '../../src/types/index';
import type { LLMProvider } from '../../src/providers/LLMProvider';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'triage-test-'));
}

function makeProvider(responseContent: string, exitCode = 0): LLMProvider {
  const response: LLMResponse = {
    content: responseContent,
    inputTokens: 100,
    outputTokens: 50,
    rateLimitInfo: {},
    exitCode,
  };
  return {
    invoke: vi.fn().mockResolvedValue({ ok: true, value: response }),
    estimateCost: vi.fn().mockReturnValue(0),
  } as unknown as LLMProvider;
}

function writeTaskMd(dir: string, content: string): string {
  const taskMd = path.join(dir, 'task.md');
  fs.writeFileSync(taskMd, content);
  return taskMd;
}

const VALID_TIER1_JSON = JSON.stringify({
  tier: 1,
  profile: 'css-fix',
  reason: 'Single CSS value change',
  bypass_phase1: true,
  estimated_agents: 2,
  complexity_hint: 'low',
});

const VALID_TIER3_JSON = JSON.stringify({
  tier: 3,
  profile: 'new-feature',
  reason: 'New module with DB table',
  bypass_phase1: false,
  estimated_agents: 14,
  complexity_hint: 'high',
});

describe('TriageRunner', () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
  });

  it('returns Tier 3 fallback when LLM output is malformed JSON', async () => {
    const provider = makeProvider('This is not JSON at all!');
    const taskMd = writeTaskMd(dir, 'Fix the login button');
    const runner = new TriageRunner(dir, provider);

    const result = await runner.run('TASK-001', taskMd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tier).toBe(3);
    expect(result.value.bypass_phase1).toBe(false);
  });

  it('returns Tier 3 fallback when LLM throws (timeout/error)', async () => {
    const provider = {
      invoke: vi.fn().mockRejectedValue(new Error('Connection timeout')),
      estimateCost: vi.fn().mockReturnValue(0),
    } as unknown as LLMProvider;
    const taskMd = writeTaskMd(dir, 'Add payment integration');
    const runner = new TriageRunner(dir, provider);

    const result = await runner.run('TASK-002', taskMd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tier).toBe(3);
  });

  it('returns Tier 3 fallback when LLM exit code is non-zero', async () => {
    const provider = makeProvider(VALID_TIER1_JSON, 1);
    const taskMd = writeTaskMd(dir, 'Fix typo');
    const runner = new TriageRunner(dir, provider);

    const result = await runner.run('TASK-003', taskMd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tier).toBe(3);
  });

  it('correctly parses valid Tier 1 response', async () => {
    const provider = makeProvider(VALID_TIER1_JSON);
    const taskMd = writeTaskMd(dir, 'Change button color to blue');
    const runner = new TriageRunner(dir, provider);

    const result = await runner.run('TASK-004', taskMd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tier).toBe(1);
    expect(result.value.profile).toBe('css-fix');
    expect(result.value.bypass_phase1).toBe(true);
    expect(result.value.estimated_agents).toBe(2);
    expect(result.value.complexity_hint).toBe('low');
  });

  it('correctly parses valid Tier 3 response', async () => {
    const provider = makeProvider(VALID_TIER3_JSON);
    const taskMd = writeTaskMd(dir, 'Build new payment module with Stripe');
    const runner = new TriageRunner(dir, provider);

    const result = await runner.run('TASK-005', taskMd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tier).toBe(3);
    expect(result.value.bypass_phase1).toBe(false);
    expect(result.value.estimated_agents).toBe(14);
  });

  it('correctly parses Tier 2 response', async () => {
    const tier2Json = JSON.stringify({
      tier: 2,
      profile: 'bug-fix',
      reason: 'Null pointer in UserService.ts',
      bypass_phase1: true,
      estimated_agents: 4,
      complexity_hint: 'medium',
    });
    const provider = makeProvider(tier2Json);
    const taskMd = writeTaskMd(dir, 'Fix null pointer in user login');
    const runner = new TriageRunner(dir, provider);

    const result = await runner.run('TASK-006', taskMd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tier).toBe(2);
    expect(result.value.profile).toBe('bug-fix');
    expect(result.value.bypass_phase1).toBe(true);
  });

  it('parses JSON wrapped in markdown code block', async () => {
    const wrapped = `Here is the classification:\n\`\`\`json\n${VALID_TIER1_JSON}\n\`\`\`\n`;
    const provider = makeProvider(wrapped);
    const taskMd = writeTaskMd(dir, 'Fix typo in header');
    const runner = new TriageRunner(dir, provider);

    const result = await runner.run('TASK-007', taskMd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tier).toBe(1);
  });

  it('handles missing task.md gracefully without throwing', async () => {
    const provider = makeProvider(VALID_TIER3_JSON);
    const runner = new TriageRunner(dir, provider);

    const result = await runner.run('TASK-008', '/nonexistent/task.md');

    expect(result.ok).toBe(true);
  });

  it('enforces 4k token budget by truncating long prompts', async () => {
    let capturedPrompt = '';
    const provider = {
      invoke: vi.fn().mockImplementation(async (req: { assembledPrompt: string }) => {
        capturedPrompt = req.assembledPrompt;
        return { ok: true, value: { content: VALID_TIER3_JSON, inputTokens: 100, outputTokens: 50, rateLimitInfo: {}, exitCode: 0 } };
      }),
      estimateCost: vi.fn().mockReturnValue(0),
    } as unknown as LLMProvider;

    // Write a very long task.md (> 4k tokens worth of chars)
    const longContent = 'A'.repeat(20_000);
    const taskMd = writeTaskMd(dir, longContent);
    const runner = new TriageRunner(dir, provider);

    await runner.run('TASK-009', taskMd);

    // 4k tokens * 4 chars/token = 16k chars budget for user prompt
    // Total prompt = system (rules) + user prompt — user portion should be truncated
    expect(capturedPrompt.length).toBeLessThan(50_000); // sanity bound
    expect(capturedPrompt).toContain('[... truncated');
  });
});
