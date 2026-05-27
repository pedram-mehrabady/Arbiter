import { ComplexityInputs, ComplexityScore, ComplexityTier, ServiceResult } from '../types/index';

const TIER_THRESHOLDS: Record<ComplexityTier, [number, number]> = {
  1: [0, 5],
  2: [6, 9],
  3: [10, Infinity],
};

const MAX_ALLOWED_SCORE = 9;

export class ComplexityScorer {
  score(inputs: ComplexityInputs): ComplexityScore {
    const weighted_total =
      inputs.file_count +
      inputs.new_dependency_count * 1 +
      inputs.crypto_or_validation_logic * 2 +
      inputs.subprocess_or_migration * 3 +
      inputs.cross_module_integration * 1;

    const tier = this.toTier(weighted_total);

    return { ...inputs, weighted_total, tier };
  }

  validate(score: ComplexityScore): ServiceResult<void> {
    if (score.weighted_total > MAX_ALLOWED_SCORE) {
      return {
        ok: false,
        error: [
          `Complexity score ${score.weighted_total} exceeds maximum (${MAX_ALLOWED_SCORE}).`,
          `Tier ${score.tier} task must be split before spawning agents.`,
          `Breakdown: files=${score.file_count}, deps=${score.new_dependency_count},`,
          `  crypto/validation=${score.crypto_or_validation_logic}×2,`,
          `  subprocess/migration=${score.subprocess_or_migration}×3,`,
          `  cross_module=${score.cross_module_integration}`,
        ].join('\n'),
        code: 'COMPLEXITY_OVERLOAD',
      };
    }
    return { ok: true, value: undefined };
  }

  private toTier(total: number): ComplexityTier {
    for (const [tier, [min, max]] of Object.entries(TIER_THRESHOLDS) as Array<[string, [number, number]]>) {
      if (total >= min && total <= max) return Number(tier) as ComplexityTier;
    }
    return 3;
  }

  describe(score: ComplexityScore): string {
    return (
      `Score: ${score.weighted_total} (Tier ${score.tier}) — ` +
      `files=${score.file_count}, deps=${score.new_dependency_count}, ` +
      `crypto=${score.crypto_or_validation_logic}×2, ` +
      `subprocess=${score.subprocess_or_migration}×3, ` +
      `cross_module=${score.cross_module_integration}`
    );
  }
}
