// The flow definition that drives the swim-lane board (and, later, the engine + folders).
// Lanes are horizontal phases; each lane's columns are its agents, plus a Done column.
// `enter` = how a task moves INTO this lane: 'manual' (drag from prev lane's Done) or 'auto'.

export interface FlowAgent {
  id: string;
  label: string;
  /** when present, this column only applies to tasks that match (e.g. hasFrontend). */
  when?: string;
  /** agents in the same parallelGroup may run concurrently (subject to conflict pre-check). */
  parallelGroup?: string;
}

export interface FlowLane {
  id: string;
  title: string;
  enter: 'manual' | 'auto';
  /** a human gate is required before a task leaves this lane. */
  gateBeforeExit?: boolean;
  agents: FlowAgent[];
}

// Default 5-lane flow (Pedram's design, 2026-05-29). Overridable per-project via arbiter/flow.json.
export const DEFAULT_FLOW: FlowLane[] = [
  {
    id: 'brainstorm', title: 'Brainstorm', enter: 'manual',
    agents: [{ id: 'ideation', label: 'Ideation' }],
  },
  {
    id: 'design', title: 'Design & Critic', enter: 'manual', gateBeforeExit: true,
    agents: [{ id: 'design', label: 'Design' }, { id: 'design-critic', label: 'Critic' }],
  },
  {
    id: 'plan', title: 'Integrator & Plan', enter: 'manual', gateBeforeExit: true,
    agents: [{ id: 'integrator', label: 'Integrator' }, { id: 'plan', label: 'Plan' }],
  },
  {
    id: 'build', title: 'Build', enter: 'auto',
    agents: [
      { id: 'frontend', label: 'Frontend', when: 'hasFrontend', parallelGroup: 'code' },
      { id: 'backend', label: 'Backend', when: 'hasBackend', parallelGroup: 'code' },
      { id: 'test-writer', label: 'Test' },
    ],
  },
  {
    id: 'finalize', title: 'Finalize', enter: 'auto',
    agents: [
      { id: 'debugger', label: 'Debugger' },
      { id: 'reviewer', label: 'Reviewer' },
      { id: 'tech-writer', label: 'Tech Writer' },
    ],
  },
];

export type CardLifecycle = 'queued' | 'running' | 'needs-gate' | 'done';

export interface LaneCard {
  taskId: string;
  title: string;
  laneId: string;
  /** agent column id the card currently sits in, or 'done' for the lane's Done column. */
  columnId: string;
  lifecycle: CardLifecycle;
}

export interface TaskSnapshot {
  taskId: string;
  title: string;
  /** agent_role → status, collapsed across sub-tasks. */
  agentStatus: Record<string, string>;
  /** the task's pending engine gate, if any (sub_task = the agent the gate fires after). */
  pendingGate?: { type: string; subTask?: string };
}

// Which lane a pending gate type belongs to.
const GATE_LANE: Record<string, string> = {
  design_approval: 'design',
  plan_approval: 'plan',
  review_approval: 'finalize',
  ui_approval: 'build',
};

/**
 * Place one card per task at its current position in the flow:
 * the first agent (in flow order) that isn't completed = the "frontier".
 * Pure + testable; no live data shape leaks in.
 */
export function deriveCards(flow: FlowLane[], tasks: TaskSnapshot[]): LaneCard[] {
  // agentId → {laneId, columnId}
  const loc: Record<string, { laneId: string; columnId: string }> = {};
  for (const lane of flow) {
    for (const a of lane.agents) loc[a.id] = { laneId: lane.id, columnId: a.id };
  }
  const lastLane = flow[flow.length - 1];

  return tasks.map((t): LaneCard => {
    // A pending gate dominates — place the card on the EXACT agent column it's
    // blocked on (the gate's sub_task), badged needs-gate. Never in Done.
    if (t.pendingGate) {
      const sub = t.pendingGate.subTask;
      if (sub && loc[sub]) {
        return { taskId: t.taskId, title: t.title, laneId: loc[sub].laneId, columnId: loc[sub].columnId, lifecycle: 'needs-gate' };
      }
      // Fallback: the gating lane's last agent column.
      const laneId = GATE_LANE[t.pendingGate.type] ?? lastLane.id;
      const lane = flow.find(l => l.id === laneId) ?? lastLane;
      const col = lane.agents[lane.agents.length - 1]?.id ?? 'done';
      return { taskId: t.taskId, title: t.title, laneId: lane.id, columnId: col, lifecycle: 'needs-gate' };
    }
    // Frontier = first flow agent present on the task and not completed.
    for (const lane of flow) {
      for (const a of lane.agents) {
        const st = t.agentStatus[a.id];
        if (st && st !== 'completed') {
          const lifecycle: CardLifecycle = st === 'in_progress' ? 'running' : st === 'failed' ? 'needs-gate' : 'queued';
          return { taskId: t.taskId, title: t.title, laneId: lane.id, columnId: a.id, lifecycle };
        }
      }
    }
    // All present agents completed → Done of the last lane the task touched.
    let doneLane = flow[0];
    for (const lane of flow) {
      if (lane.agents.some(a => t.agentStatus[a.id] === 'completed')) doneLane = lane;
    }
    return { taskId: t.taskId, title: t.title, laneId: doneLane.id, columnId: 'done', lifecycle: 'done' };
  });
}
