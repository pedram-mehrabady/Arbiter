import { AgentRole, ComplexityInputs } from '../types/index';

// Schema the plan agent MUST produce. The conductor validates this
// before allowing backend/frontend to spawn.

export interface PlanComplexityScore extends ComplexityInputs {
  weighted_total: number;
  tier: string;
  notes?: string;
}

export interface PlanSubTask {
  id: string;
  description: string;
  agent_role: AgentRole;
  files_touched: string[];
  depends_on: string[];
  estimated_tokens?: number;
  complexity_notes?: string;
}

export interface PlanOutput {
  task_id: string;
  complexity_score: PlanComplexityScore;
  sub_tasks: PlanSubTask[];
}

// Roles the plan agent is allowed to spawn granular sub-tasks for.
// Reviewer, tech-writer, design phases are fixed — only the implementation
// phase is decomposable by the plan agent.
export const DECOMPOSABLE_ROLES: AgentRole[] = ['backend', 'frontend', 'test-writer'];

// Generic placeholder sub-task IDs that the plan injection replaces.
// These exist in state after TaskInitializer but before plan runs.
export const GENERIC_IMPL_IDS = ['backend', 'frontend', 'test-writer'] as const;

// Sub-tasks that must remain in state unchanged (never replaced by plan output).
export const FIXED_PIPELINE_IDS = [
  'reframe',
  'research',
  'design',
  'design-critic',
  'integrator',
  'plan',
  'reviewer',
  'tech-writer',
] as const;
