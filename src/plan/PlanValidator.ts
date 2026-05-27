import { ComplexityScore, ServiceResult, SubTaskEntry } from '../types/index';
import { ComplexityScorer } from '../preflight/ComplexityScorer';
import {
  PlanOutput,
  PlanSubTask,
  PlanComplexityScore,
  DECOMPOSABLE_ROLES,
  GENERIC_IMPL_IDS,
  FIXED_PIPELINE_IDS,
} from './PlanOutput';

export interface ValidatedPlan {
  taskId: string;
  score: ComplexityScore;
  scoreMismatch: boolean;
  agentStatedTotal: number;
  injectedSubTasks: Array<[string, SubTaskEntry]>;
  reviewerDepsUpdate: string[];
  splitRecommendation?: string;
}

// Tolerance: allow the plan agent's stated total to differ from computed by
// at most this much before we log a warning. We always enforce the computed value.
const SCORE_MISMATCH_WARN_THRESHOLD = 1;

// JSON fences the plan agent may wrap its output in
const JSON_FENCE_RE = /```(?:json)?\s*\n([\s\S]*?)\n```/;

export class PlanValidator {
  private readonly scorer: ComplexityScorer;

  constructor(complexityCap?: number) {
    this.scorer = new ComplexityScorer(complexityCap);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  parseFromContent(content: string): ServiceResult<PlanOutput> {
    // 1. Try to extract JSON from a markdown code fence
    const fenceMatch = JSON_FENCE_RE.exec(content);
    const jsonStr = fenceMatch ? fenceMatch[1] : content.trim();

    let raw: unknown;
    try {
      raw = JSON.parse(jsonStr);
    } catch {
      return {
        ok: false,
        error: [
          'Plan agent output is not valid JSON.',
          'Expected either pure JSON or JSON inside a ```json ... ``` fence.',
          `First 200 chars of output: ${content.slice(0, 200)}`,
        ].join('\n'),
        code: 'PARSE_ERROR',
      };
    }

    return this.validateSchema(raw);
  }

  validate(plan: PlanOutput): ServiceResult<ValidatedPlan> {
    // ── Recompute score from raw inputs ────────────────────────────────────
    const { weighted_total: agentTotal, tier: _tier, notes: _notes, ...inputs } = plan.complexity_score;
    const computedScore = this.scorer.score(inputs);

    const scoreMismatch =
      Math.abs(computedScore.weighted_total - agentTotal) > SCORE_MISMATCH_WARN_THRESHOLD;

    // Always enforce the computed score, not the agent-stated one
    const enforced = computedScore;

    // ── Enforce complexity cap ─────────────────────────────────────────────
    const capResult = this.scorer.validate(enforced);
    if (!capResult.ok) {
      return {
        ok: false,
        error: [
          capResult.error,
          '',
          this.buildSplitRecommendation(plan),
        ].join('\n'),
        code: 'COMPLEXITY_OVERLOAD',
      };
    }

    // ── Sub-task dependency graph validation ───────────────────────────────
    const depResult = this.validateDependencyGraph(plan.sub_tasks);
    if (!depResult.ok) return depResult;

    // ── Build injection payload ────────────────────────────────────────────
    const injectedSubTasks = this.buildInjectionPayload(plan.sub_tasks, plan.task_id);

    // Determine what the reviewer should now depend on:
    // the plan-defined test-writer sub-tasks (leaves of the plan graph that
    // have no downstream plan sub-task). Fallback: the old ['test-writer'].
    const reviewerDepsUpdate = this.findReviewerDeps(plan.sub_tasks);

    return {
      ok: true,
      value: {
        taskId: plan.task_id,
        score: enforced,
        scoreMismatch,
        agentStatedTotal: agentTotal,
        injectedSubTasks,
        reviewerDepsUpdate,
      },
    };
  }

  buildSplitRecommendation(plan: PlanOutput): string {
    const s = plan.complexity_score;
    const lines = [
      '── Split Recommendation ─────────────────────────────────────────',
      `Score breakdown:`,
      `  file_count                 = ${s.file_count}`,
      `  new_dependency_count  × 1  = ${s.new_dependency_count}`,
      `  crypto_or_validation  × 2  = ${s.crypto_or_validation_logic * 2}  (raw: ${s.crypto_or_validation_logic})`,
      `  subprocess_migration  × 3  = ${s.subprocess_or_migration * 3}  (raw: ${s.subprocess_or_migration})`,
      `  cross_module          × 1  = ${s.cross_module_integration}`,
      `  ────────────────────────────────────────────────────────────────`,
      `  weighted_total             = ${this.scorer.score(s).weighted_total}  (max allowed: 9)`,
      '',
      'To reduce score, split into sub-tasks that each score ≤ 9:',
    ];

    // Group sub-tasks by the dominant cost driver
    if (s.crypto_or_validation_logic > 0 && s.subprocess_or_migration > 0) {
      lines.push('  → Separate crypto/validation work from subprocess/migration work into two tasks.');
    }
    if (s.subprocess_or_migration > 1) {
      lines.push('  → Each migration/subprocess change should be its own task (each scores +3).');
    }
    if (s.crypto_or_validation_logic > 1) {
      lines.push('  → Each crypto/validation surface should be its own task (each scores +2).');
    }
    if (s.file_count > 6) {
      lines.push(`  → Split by layer: backend data-layer changes vs. API layer vs. frontend.`);
    }
    if (s.cross_module_integration > 1) {
      lines.push('  → Separate each cross-module integration point into its own task.');
    }

    lines.push('─────────────────────────────────────────────────────────────────');
    return lines.join('\n');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private validateSchema(raw: unknown): ServiceResult<PlanOutput> {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'Plan output must be a JSON object', code: 'SCHEMA_ERROR' };
    }

    const obj = raw as Record<string, unknown>;
    const missing: string[] = [];

    if (!obj['task_id']) missing.push('task_id');
    if (!obj['complexity_score']) missing.push('complexity_score');
    if (!Array.isArray(obj['sub_tasks'])) missing.push('sub_tasks (array)');

    if (missing.length > 0) {
      return {
        ok: false,
        error: `Plan output missing required fields: ${missing.join(', ')}`,
        code: 'SCHEMA_ERROR',
      };
    }

    const cs = obj['complexity_score'] as Record<string, unknown>;
    const scoreFields = [
      'file_count',
      'new_dependency_count',
      'crypto_or_validation_logic',
      'subprocess_or_migration',
      'cross_module_integration',
      'weighted_total',
    ];
    const missingScore = scoreFields.filter(f => typeof cs[f] !== 'number');
    if (missingScore.length > 0) {
      return {
        ok: false,
        error: `complexity_score missing numeric fields: ${missingScore.join(', ')}`,
        code: 'SCHEMA_ERROR',
      };
    }

    const subTasks = obj['sub_tasks'] as unknown[];
    const stErrors: string[] = [];
    for (let i = 0; i < subTasks.length; i++) {
      const st = subTasks[i] as Record<string, unknown>;
      if (!st['id']) stErrors.push(`sub_tasks[${i}].id missing`);
      if (!st['agent_role']) stErrors.push(`sub_tasks[${i}].agent_role missing`);
      if (!Array.isArray(st['files_touched'])) stErrors.push(`sub_tasks[${i}].files_touched must be array`);
      if (!Array.isArray(st['depends_on'])) stErrors.push(`sub_tasks[${i}].depends_on must be array`);
      if (!DECOMPOSABLE_ROLES.includes(st['agent_role'] as never)) {
        stErrors.push(
          `sub_tasks[${i}].agent_role "${st['agent_role']}" is not allowed ` +
          `(allowed: ${DECOMPOSABLE_ROLES.join(', ')})`,
        );
      }
    }
    if (stErrors.length > 0) {
      return { ok: false, error: `Plan sub_task schema errors:\n${stErrors.join('\n')}`, code: 'SCHEMA_ERROR' };
    }

    return { ok: true, value: raw as PlanOutput };
  }

  private validateDependencyGraph(subTasks: PlanSubTask[]): ServiceResult<void> {
    const ids = new Set(subTasks.map(st => st.id));
    const fixedIds = new Set<string>(FIXED_PIPELINE_IDS);
    const allKnown = new Set([...ids, ...fixedIds]);
    const errors: string[] = [];

    for (const st of subTasks) {
      // Check for self-reference
      if (st.depends_on.includes(st.id)) {
        errors.push(`"${st.id}" depends on itself`);
      }
      // Check all deps are valid IDs
      for (const dep of st.depends_on) {
        if (!allKnown.has(dep) && !GENERIC_IMPL_IDS.includes(dep as never)) {
          errors.push(`"${st.id}" depends on unknown id "${dep}"`);
        }
      }
      // Reject attempts to depend on the generic placeholders that will be removed
      for (const dep of st.depends_on) {
        if (GENERIC_IMPL_IDS.includes(dep as never)) {
          errors.push(
            `"${st.id}" must not depend on generic "${dep}" — ` +
            `use "plan" or specific ids from this plan output instead`,
          );
        }
      }
    }

    // Basic cycle detection (DFS)
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const adjList = new Map<string, string[]>(subTasks.map(st => [st.id, st.depends_on]));

    const hasCycle = (node: string): boolean => {
      if (inStack.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      inStack.add(node);
      for (const dep of adjList.get(node) ?? []) {
        if (hasCycle(dep)) return true;
      }
      inStack.delete(node);
      return false;
    };

    for (const st of subTasks) {
      if (hasCycle(st.id)) {
        errors.push(`Dependency cycle detected involving "${st.id}"`);
        break;
      }
    }

    if (errors.length > 0) {
      return { ok: false, error: `Dependency graph errors:\n${errors.join('\n')}`, code: 'DEP_GRAPH_ERROR' };
    }
    return { ok: true, value: undefined };
  }

  private buildInjectionPayload(
    subTasks: PlanSubTask[],
    taskId: string,
  ): Array<[string, SubTaskEntry]> {
    void taskId;
    return subTasks.map(st => [
      st.id,
      {
        status: 'pending' as const,
        agent_role: st.agent_role,
        model: '',
        depends_on: st.depends_on.length > 0 ? st.depends_on : undefined,
        output_dir: undefined,
      },
    ]);
  }

  // Reviewer should depend on the plan-defined test-writer sub-tasks that
  // have no other plan sub-task depending on them (leaf nodes in the plan graph).
  private findReviewerDeps(subTasks: PlanSubTask[]): string[] {
    const planIds = new Set(subTasks.map(st => st.id));
    const referenced = new Set(subTasks.flatMap(st => st.depends_on));
    // Leaves: plan IDs not referenced by any other plan sub-task
    const leaves = subTasks
      .filter(st => !referenced.has(st.id))
      .map(st => st.id);

    return leaves.length > 0 ? leaves : ['test-writer'];
  }
}

// Exported helper: coerce a raw unknown plan complexity score for display
export function formatPlanScore(cs: PlanComplexityScore): string {
  const scorer = new ComplexityScorer();
  const computed = scorer.score(cs);
  return scorer.describe(computed);
}
