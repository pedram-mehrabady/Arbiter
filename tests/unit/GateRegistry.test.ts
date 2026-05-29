import { describe, it, expect } from 'vitest';
import { GateRegistry, STANDARD_GATES } from '../../src/gates/GateRegistry';

describe('GateRegistry', () => {
  const registry = new GateRegistry();

  it('getSpec returns spec for known gate type', () => {
    const spec = registry.getSpec('design_approval');
    expect(spec).toBeDefined();
    expect(spec?.type).toBe('design_approval');
    expect(spec?.triggerAfterAgent).toBe('design-critic');
  });

  it('getSpec returns undefined for unknown type', () => {
    expect(registry.getSpec('nonexistent' as never)).toBeUndefined();
  });

  it('getGateAfterAgent returns gate triggered by that agent', () => {
    const spec = registry.getGateAfterAgent('plan');
    expect(spec?.type).toBe('plan_approval');
  });

  it('getGateAfterAgent returns undefined for agent with no gate', () => {
    expect(registry.getGateAfterAgent('reframe')).toBeUndefined();
  });

  it('isBlocked returns true when role is blocked by a pending gate', () => {
    expect(registry.isBlocked('backend', ['plan_approval'])).toBe(true);
  });

  it('isBlocked returns false when gate does not block the role', () => {
    expect(registry.isBlocked('reframe', ['plan_approval'])).toBe(false);
  });

  it('isBlocked returns false with empty pending list', () => {
    expect(registry.isBlocked('backend', [])).toBe(false);
  });

  it('isBlocked handles multiple pending gates', () => {
    expect(registry.isBlocked('tech-writer', ['plan_approval', 'review_approval'])).toBe(true);
  });

  it('allGateTypes returns all standard gates (incl. opt-in frontend_review)', () => {
    const types = registry.allGateTypes();
    expect(types).toHaveLength(5);
    expect(types).toContain('design_approval');
    expect(types).toContain('plan_approval');
    expect(types).toContain('frontend_review');
    expect(types).toContain('review_approval');
    expect(types).toContain('debugger_major_rewrite');
  });

  it('STANDARD_GATES export has correct length', () => {
    expect(STANDARD_GATES).toHaveLength(5);
  });
});
