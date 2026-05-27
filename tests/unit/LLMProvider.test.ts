import { describe, it, expect } from 'vitest';
import { estimateCost, estimateTokenCount, MODEL_COSTS } from '../../src/providers/LLMProvider';

describe('estimateCost', () => {
  it('returns 0 for unknown model', () => {
    expect(estimateCost('unknown-model', 1_000_000, 1_000_000)).toBe(0);
  });

  it('calculates correct cost for claude-sonnet-4-6', () => {
    // 1M input at $3, 1M output at $15 = $18
    expect(estimateCost('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBeCloseTo(18.0);
  });

  it('calculates correct cost for claude-opus-4-7', () => {
    // 1M input at $15, 1M output at $75 = $90
    expect(estimateCost('claude-opus-4-7', 1_000_000, 1_000_000)).toBeCloseTo(90.0);
  });

  it('calculates correct cost for claude-haiku-4-5-20251001', () => {
    // 1M input at $0.25, 1M output at $1.25 = $1.50
    expect(estimateCost('claude-haiku-4-5-20251001', 1_000_000, 1_000_000)).toBeCloseTo(1.5);
  });

  it('scales proportionally for smaller token counts', () => {
    const cost = estimateCost('claude-sonnet-4-6', 1_000, 500);
    const expected = (1_000 / 1_000_000) * 3.0 + (500 / 1_000_000) * 15.0;
    expect(cost).toBeCloseTo(expected);
  });

  it('returns 0 when both token counts are 0', () => {
    expect(estimateCost('claude-sonnet-4-6', 0, 0)).toBe(0);
  });
});

describe('estimateTokenCount', () => {
  it('estimates 1 token per 4 chars (ceiling)', () => {
    expect(estimateTokenCount('aaaa')).toBe(1);
    expect(estimateTokenCount('aaaaa')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('returns a positive integer for typical text', () => {
    const count = estimateTokenCount('Hello, world! This is a test string.');
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });
});

describe('MODEL_COSTS', () => {
  it('has entries for all three main models', () => {
    expect(MODEL_COSTS['claude-sonnet-4-6']).toBeDefined();
    expect(MODEL_COSTS['claude-opus-4-7']).toBeDefined();
    expect(MODEL_COSTS['claude-haiku-4-5-20251001']).toBeDefined();
  });

  it('each entry has inputPer1M and outputPer1M', () => {
    for (const [, pricing] of Object.entries(MODEL_COSTS)) {
      expect(typeof pricing.inputPer1M).toBe('number');
      expect(typeof pricing.outputPer1M).toBe('number');
      expect(pricing.inputPer1M).toBeGreaterThan(0);
      expect(pricing.outputPer1M).toBeGreaterThan(0);
    }
  });
});
