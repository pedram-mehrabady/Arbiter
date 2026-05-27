import { describe, it, expect } from 'vitest';
import { ComplexityScorer } from '../../src/preflight/ComplexityScorer';

const base = {
  file_count: 0,
  new_dependency_count: 0,
  crypto_or_validation_logic: 0,
  subprocess_or_migration: 0,
  cross_module_integration: 0,
};

describe('ComplexityScorer', () => {
  const scorer = new ComplexityScorer();

  describe('score()', () => {
    it('returns 0 for all-zero inputs', () => {
      const s = scorer.score(base);
      expect(s.weighted_total).toBe(0);
      expect(s.tier).toBe(1);
    });

    it('weights file_count at ×1', () => {
      expect(scorer.score({ ...base, file_count: 5 }).weighted_total).toBe(5);
    });

    it('weights new_dependency_count at ×1', () => {
      expect(scorer.score({ ...base, new_dependency_count: 3 }).weighted_total).toBe(3);
    });

    it('weights crypto_or_validation_logic at ×2', () => {
      expect(scorer.score({ ...base, crypto_or_validation_logic: 2 }).weighted_total).toBe(4);
    });

    it('weights subprocess_or_migration at ×3', () => {
      expect(scorer.score({ ...base, subprocess_or_migration: 2 }).weighted_total).toBe(6);
    });

    it('weights cross_module_integration at ×1', () => {
      expect(scorer.score({ ...base, cross_module_integration: 4 }).weighted_total).toBe(4);
    });

    it('sums all weights correctly', () => {
      const s = scorer.score({
        file_count: 2,
        new_dependency_count: 1,
        crypto_or_validation_logic: 1,
        subprocess_or_migration: 1,
        cross_module_integration: 1,
      });
      // 2 + 1 + 2 + 3 + 1 = 9
      expect(s.weighted_total).toBe(9);
    });

    it('assigns tier 1 for score 0–5', () => {
      expect(scorer.score({ ...base, file_count: 5 }).tier).toBe(1);
    });

    it('assigns tier 2 for score 6–9', () => {
      expect(scorer.score({ ...base, file_count: 6 }).tier).toBe(2);
      expect(scorer.score({ ...base, file_count: 9 }).tier).toBe(2);
    });

    it('assigns tier 3 for score ≥10', () => {
      expect(scorer.score({ ...base, file_count: 10 }).tier).toBe(3);
    });
  });

  describe('validate()', () => {
    it('passes when score equals default cap of 9', () => {
      const s = scorer.score({ ...base, file_count: 9 });
      expect(scorer.validate(s).ok).toBe(true);
    });

    it('fails when score exceeds default cap', () => {
      const s = scorer.score({ ...base, file_count: 10 });
      const r = scorer.validate(s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('COMPLEXITY_OVERLOAD');
    });

    it('respects custom cap', () => {
      const custom = new ComplexityScorer(5);
      const s = custom.score({ ...base, file_count: 6 });
      expect(custom.validate(s).ok).toBe(false);
    });

    it('passes at custom cap boundary', () => {
      const custom = new ComplexityScorer(5);
      const s = custom.score({ ...base, file_count: 5 });
      expect(custom.validate(s).ok).toBe(true);
    });
  });

  describe('describe()', () => {
    it('returns a string containing the weighted total and tier', () => {
      const s = scorer.score({ ...base, file_count: 3 });
      const desc = scorer.describe(s);
      expect(desc).toContain('3');
      expect(desc).toContain('Tier 1');
    });
  });
});
