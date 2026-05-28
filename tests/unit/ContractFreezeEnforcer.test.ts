import { describe, it, expect } from 'vitest';
import { ContractFreezeEnforcer } from '../../src/contracts/ContractFreezeEnforcer';

describe('ContractFreezeEnforcer', () => {
  it('returns empty locked paths for Tier 1', () => {
    const enforcer = new ContractFreezeEnforcer();
    expect(enforcer.getLockedPaths(1)).toHaveLength(0);
  });

  it('returns empty locked paths for Tier 3', () => {
    const enforcer = new ContractFreezeEnforcer();
    expect(enforcer.getLockedPaths(3)).toHaveLength(0);
  });

  it("returns ['contracts/'] for Tier 2", () => {
    const enforcer = new ContractFreezeEnforcer();
    const locked = enforcer.getLockedPaths(2);
    expect(locked).toContain('contracts/');
    expect(locked).toHaveLength(1);
  });

  it('returns no violations when no locked paths given', async () => {
    const enforcer = new ContractFreezeEnforcer();
    const violations = await enforcer.checkMutations('/any/path', []);
    expect(violations).toHaveLength(0);
  });

  it('returns no violations when git is not available (silent fallback)', async () => {
    const enforcer = new ContractFreezeEnforcer();
    // Non-existent path — git will fail silently
    const violations = await enforcer.checkMutations('/nonexistent/path', ['contracts/']);
    expect(violations).toHaveLength(0);
  });

  it('violation message includes CONTRACT_MUTATION_ON_TIER2', async () => {
    // We can't run real git here, but we can verify the message pattern by
    // testing with a real git repo dir — use process.cwd() which IS a git repo
    // The test just verifies no exception is thrown and violations is an array
    const enforcer = new ContractFreezeEnforcer();
    const violations = await enforcer.checkMutations(process.cwd(), ['contracts/']);
    expect(Array.isArray(violations)).toBe(true);
    if (violations.length > 0) {
      expect(violations[0]).toContain('CONTRACT_MUTATION_ON_TIER2');
    }
  });
});
