import { describe, it, expect } from 'vitest';
import { PlanValidator } from '../../src/plan/PlanValidator';
import { PlanOutput } from '../../src/plan/PlanOutput';

const validator = new PlanValidator();

function validPlan(overrides: Partial<PlanOutput> = {}): PlanOutput {
  return {
    task_id: 'TEST-1',
    complexity_score: {
      file_count: 2,
      new_dependency_count: 0,
      crypto_or_validation_logic: 0,
      subprocess_or_migration: 0,
      cross_module_integration: 0,
      weighted_total: 2,
      tier: 'low',
    },
    sub_tasks: [
      {
        id: 'backend-api',
        description: 'Add REST endpoint',
        agent_role: 'backend',
        files_touched: ['src/api.ts'],
        depends_on: ['plan'],
      },
      {
        id: 'test-api',
        description: 'Write tests',
        agent_role: 'test-writer',
        files_touched: ['tests/api.test.ts'],
        depends_on: ['backend-api'],
      },
    ],
    ...overrides,
  };
}

describe('PlanValidator.parseFromContent', () => {
  it('parses raw JSON', () => {
    const result = validator.parseFromContent(JSON.stringify(validPlan()));
    expect(result.ok).toBe(true);
  });

  it('parses JSON inside a ```json fence', () => {
    const content = '```json\n' + JSON.stringify(validPlan()) + '\n```';
    const result = validator.parseFromContent(content);
    expect(result.ok).toBe(true);
  });

  it('parses JSON inside a plain ``` fence', () => {
    const content = '```\n' + JSON.stringify(validPlan()) + '\n```';
    const result = validator.parseFromContent(content);
    expect(result.ok).toBe(true);
  });

  it('returns PARSE_ERROR for non-JSON', () => {
    const result = validator.parseFromContent('this is not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PARSE_ERROR');
  });

  it('returns SCHEMA_ERROR when task_id missing', () => {
    const plan = { ...validPlan(), task_id: undefined } as unknown as PlanOutput;
    const result = validator.parseFromContent(JSON.stringify(plan));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SCHEMA_ERROR');
  });

  it('returns SCHEMA_ERROR when sub_tasks is not array', () => {
    const plan = { ...validPlan(), sub_tasks: {} } as unknown as PlanOutput;
    const result = validator.parseFromContent(JSON.stringify(plan));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SCHEMA_ERROR');
  });

  it('returns SCHEMA_ERROR when complexity_score has non-numeric field', () => {
    const plan = validPlan();
    (plan.complexity_score as Record<string, unknown>).file_count = 'many';
    const result = validator.parseFromContent(JSON.stringify(plan));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SCHEMA_ERROR');
  });

  it('returns SCHEMA_ERROR for disallowed agent_role', () => {
    const plan = validPlan();
    plan.sub_tasks[0].agent_role = 'reviewer' as never;
    const result = validator.parseFromContent(JSON.stringify(plan));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SCHEMA_ERROR');
      expect(result.error).toContain('not allowed');
    }
  });
});

describe('PlanValidator.validate', () => {
  it('validates a correct low-complexity plan', () => {
    const plan = validPlan();
    const parseResult = validator.parseFromContent(JSON.stringify(plan));
    if (!parseResult.ok) throw new Error(parseResult.error);
    const result = validator.validate(parseResult.value);
    expect(result.ok).toBe(true);
  });

  it('rejects plan with complexity score exceeding cap', () => {
    const plan = validPlan({
      complexity_score: {
        file_count: 5,
        new_dependency_count: 0,
        crypto_or_validation_logic: 0,
        subprocess_or_migration: 3,
        cross_module_integration: 2,
        weighted_total: 16,
        tier: 'high',
      },
    });
    const result = validator.validate(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('COMPLEXITY_OVERLOAD');
  });

  it('detects self-referential dependency', () => {
    const plan = validPlan();
    plan.sub_tasks[0].depends_on = ['backend-api'];
    const result = validator.validate(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DEP_GRAPH_ERROR');
      expect(result.error).toContain('itself');
    }
  });

  it('detects dependency on unknown id', () => {
    const plan = validPlan();
    plan.sub_tasks[0].depends_on = ['nonexistent-id'];
    const result = validator.validate(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DEP_GRAPH_ERROR');
  });

  it('rejects dependency on generic placeholder ids', () => {
    const plan = validPlan();
    plan.sub_tasks[0].depends_on = ['frontend'];
    const result = validator.validate(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DEP_GRAPH_ERROR');
      expect(result.error).toContain('generic');
    }
  });

  it('builds correct injection payload', () => {
    const plan = validPlan();
    const parseResult = validator.parseFromContent(JSON.stringify(plan));
    if (!parseResult.ok) throw new Error(parseResult.error);
    const result = validator.validate(parseResult.value);
    if (!result.ok) throw new Error(result.error);

    const ids = result.value.injectedSubTasks.map(([id]) => id);
    expect(ids).toContain('backend-api');
    expect(ids).toContain('test-api');
  });

  it('reviewer deps are the leaf nodes of the plan graph', () => {
    const plan = validPlan();
    const parseResult = validator.parseFromContent(JSON.stringify(plan));
    if (!parseResult.ok) throw new Error(parseResult.error);
    const result = validator.validate(parseResult.value);
    if (!result.ok) throw new Error(result.error);

    // test-api has no sub-tasks depending on it → it's the leaf
    expect(result.value.reviewerDepsUpdate).toContain('test-api');
    expect(result.value.reviewerDepsUpdate).not.toContain('backend-api');
  });

  it('sets scoreMismatch true when agent total diverges by more than threshold', () => {
    const plan = validPlan();
    plan.complexity_score.weighted_total = 99; // wildly wrong
    const result = validator.validate(plan);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.scoreMismatch).toBe(true);
  });
});

describe('PlanValidator.buildSplitRecommendation', () => {
  it('returns a non-empty string', () => {
    const rec = validator.buildSplitRecommendation(validPlan());
    expect(typeof rec).toBe('string');
    expect(rec.length).toBeGreaterThan(0);
  });
});
