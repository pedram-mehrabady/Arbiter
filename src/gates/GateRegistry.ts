import { AgentRole } from '../types/index';

// The 4 standard human gates in the pipeline, in order.
// Gate 1-3 are structural (always required). Gate 4 fires only when
// the debugger rewrites >20% of original output.
export type GateType =
  | 'design_approval'
  | 'plan_approval'
  | 'review_approval'
  | 'debugger_major_rewrite';

export interface GateSpec {
  type: GateType;
  label: string;
  triggerAfterAgent: AgentRole;
  description: string;
  blocksAgents: AgentRole[];
}

export const STANDARD_GATES: GateSpec[] = [
  {
    type: 'design_approval',
    label: 'Design Gate',
    triggerAfterAgent: 'design-critic',
    description: 'Review and approve the architectural design before implementation begins.',
    blocksAgents: ['integrator', 'plan', 'backend', 'frontend'],
  },
  {
    type: 'plan_approval',
    label: 'Plan Gate',
    triggerAfterAgent: 'plan',
    description: 'Approve the sub-task breakdown and complexity scores before agents spawn.',
    blocksAgents: ['backend', 'frontend'],
  },
  {
    type: 'review_approval',
    label: 'Review Gate',
    triggerAfterAgent: 'reviewer',
    description: 'Final human review of code, tests, and reviewer report before merge.',
    blocksAgents: ['tech-writer'],
  },
  {
    type: 'debugger_major_rewrite',
    label: 'Debugger Rewrite Gate',
    triggerAfterAgent: 'debugger',
    description: 'Debugger changed >20% of original output. Approve before accepting the rewrite.',
    blocksAgents: ['reviewer'],
  },
];

export class GateRegistry {
  private readonly gates = new Map<GateType, GateSpec>(
    STANDARD_GATES.map(g => [g.type, g]),
  );

  getSpec(type: GateType): GateSpec | undefined {
    return this.gates.get(type);
  }

  getGateAfterAgent(role: AgentRole): GateSpec | undefined {
    return STANDARD_GATES.find(g => g.triggerAfterAgent === role);
  }

  isBlocked(role: AgentRole, pendingGateTypes: GateType[]): boolean {
    for (const gateType of pendingGateTypes) {
      const spec = this.gates.get(gateType);
      if (spec?.blocksAgents.includes(role)) return true;
    }
    return false;
  }

  allGateTypes(): GateType[] {
    return Array.from(this.gates.keys());
  }
}
