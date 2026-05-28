import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RateLimiter } from '../../src/queue/RateLimiter';

const makeRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-rate-'));

describe('RateLimiter', () => {
  let root: string;
  let limiter: RateLimiter;

  beforeEach(async () => {
    root = await makeRoot();
    limiter = new RateLimiter(root, { dailyCap: 10.0, pauseOnRateLimitMs: 100 });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('record', () => {
    it('records a usage entry and returns it', async () => {
      const result = await limiter.record('TASK-1', 'reframe', 'reframe', 'claude-sonnet-4-6', 1000, 500);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.task_id).toBe('TASK-1');
      expect(result.value.sub_task).toBe('reframe');
      expect(result.value.input_tokens).toBe(1000);
      expect(result.value.output_tokens).toBe(500);
      expect(typeof result.value.cost_usd).toBe('number');
    });

    it('accumulates total_cost_today_usd across multiple calls', async () => {
      await limiter.record('TASK-1', 'reframe', 'reframe', 'claude-sonnet-4-6', 1000, 500);
      const second = await limiter.record('TASK-1', 'research', 'research', 'claude-sonnet-4-6', 1000, 500);
      if (!second.ok) return;
      expect(second.value.total_cost_today_usd).toBeGreaterThan(second.value.cost_usd);
    });

    it('writes to arbiter/usage.jsonl', async () => {
      await limiter.record('TASK-1', 'reframe', 'reframe', 'claude-sonnet-4-6', 1000, 500);
      const content = await fs.readFile(path.join(root, 'arbiter', 'usage.jsonl'), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      expect(lines.length).toBe(1);
      const entry = JSON.parse(lines[0]);
      expect(entry.task_id).toBe('TASK-1');
    });

    it('sets context_warning true when contextTokens exceeds threshold', async () => {
      const result = await limiter.record('TASK-1', 'reframe', 'reframe', 'claude-sonnet-4-6', 1000, 500, 80_000);
      if (!result.ok) return;
      expect(result.value.context_warning).toBe(true);
    });

    it('does not set context_warning when contextTokens is below threshold', async () => {
      const result = await limiter.record('TASK-1', 'reframe', 'reframe', 'claude-sonnet-4-6', 1000, 500, 50_000);
      if (!result.ok) return;
      expect(result.value.context_warning).toBeFalsy();
    });
  });

  describe('checkDailyCap', () => {
    it('reports allowed=true when under cap', async () => {
      const result = await limiter.checkDailyCap();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.allowed).toBe(true);
      expect(result.value.cap).toBe(10.0);
    });

    it('reports correct cap value', async () => {
      const result = await limiter.checkDailyCap();
      if (!result.ok) return;
      expect(result.value.cap).toBe(10.0);
    });
  });

  describe('getTodayTotal', () => {
    it('returns 0 when no usage recorded', async () => {
      const total = await limiter.getTodayTotal();
      expect(total).toBe(0);
    });

    it('sums cost across multiple entries', async () => {
      await limiter.record('TASK-1', 'reframe', 'reframe', 'claude-sonnet-4-6', 1000, 500);
      await limiter.record('TASK-1', 'research', 'research', 'claude-sonnet-4-6', 2000, 1000);
      const total = await limiter.getTodayTotal();
      expect(total).toBeGreaterThan(0);
    });
  });

  describe('getHeadroom', () => {
    it('returns 1 (100%) when nothing spent', async () => {
      const headroom = await limiter.getHeadroom();
      expect(headroom).toBe(1);
    });

    it('returns value between 0 and 1 when some spent', async () => {
      // Use a very low cap so a single call noticeably reduces headroom
      const smallCap = new RateLimiter(root, { dailyCap: 0.001, pauseOnRateLimitMs: 100 });
      await smallCap.record('TASK-1', 'reframe', 'reframe', 'claude-opus-4-7', 10000, 5000);
      const headroom = await smallCap.getHeadroom();
      expect(headroom).toBeGreaterThanOrEqual(0);
      expect(headroom).toBeLessThanOrEqual(1);
    });
  });

  describe('handleRateLimitInfo', () => {
    it('returns ok when no rate limit hit', async () => {
      const result = await limiter.handleRateLimitInfo({ requestsRemaining: 100, tokensRemaining: 50000 });
      expect(result.ok).toBe(true);
    });

    it('returns ok for empty rate limit info', async () => {
      const result = await limiter.handleRateLimitInfo({});
      expect(result.ok).toBe(true);
    });
  });
});
