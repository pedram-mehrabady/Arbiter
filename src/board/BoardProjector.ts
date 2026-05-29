import fs from 'node:fs/promises';
import path from 'node:path';

// Canonical flow (mirrors the dashboard's DEFAULT_FLOW). When arbiter/flow.json
// exists it overrides this, so projects can customize lanes/agents.
export interface FlowAgent { id: string; label: string }
export interface FlowLane { id: string; title: string; enter: 'manual' | 'auto'; gateBeforeExit?: boolean; agents: FlowAgent[] }

export const DEFAULT_FLOW: FlowLane[] = [
  { id: 'brainstorm', title: 'Brainstorm', enter: 'manual', agents: [{ id: 'ideation', label: 'Ideation' }, { id: 'reframe', label: 'Reframe' }, { id: 'research', label: 'Research' }] },
  { id: 'design', title: 'Design & Critic', enter: 'manual', gateBeforeExit: true, agents: [{ id: 'design', label: 'Design' }, { id: 'design-critic', label: 'Critic' }] },
  { id: 'plan', title: 'Integrator & Plan', enter: 'manual', gateBeforeExit: true, agents: [{ id: 'integrator', label: 'Integrator' }, { id: 'plan', label: 'Plan' }] },
  { id: 'build', title: 'Build', enter: 'auto', agents: [{ id: 'frontend', label: 'Frontend' }, { id: 'backend', label: 'Backend' }, { id: 'test-writer', label: 'Test' }] },
  { id: 'finalize', title: 'Finalize', enter: 'auto', agents: [{ id: 'debugger', label: 'Debugger' }, { id: 'reviewer', label: 'Reviewer' }, { id: 'tech-writer', label: 'Tech Writer' }] },
];

export type CardLifecycle = 'queued' | 'running' | 'needs-gate' | 'done';
export interface LaneCard { taskId: string; title: string; laneId: string; laneIndex: number; columnId: string; lifecycle: CardLifecycle; gateId?: string }
export interface TaskSnapshot { taskId: string; title: string; agentStatus: Record<string, string>; pendingGate?: { type: string; subTask?: string; gateId?: string } }
export interface BoardJson { generated: string; lanes: FlowLane[]; cards: LaneCard[] }

const GATE_LANE: Record<string, string> = { design_approval: 'design', plan_approval: 'plan', review_approval: 'finalize', ui_approval: 'build' };

/** Place one card per task at its frontier / gate / done. Mirrors the dashboard deriveCards. */
export function deriveCards(flow: FlowLane[], tasks: TaskSnapshot[]): LaneCard[] {
  const loc: Record<string, { laneId: string; columnId: string }> = {};
  flow.forEach(l => l.agents.forEach(a => { loc[a.id] = { laneId: l.id, columnId: a.id }; }));
  const lastLane = flow[flow.length - 1];
  const laneIndex = (id: string) => flow.findIndex(l => l.id === id);

  return tasks.map((t): LaneCard => {
    const base = { taskId: t.taskId, title: t.title };
    const pg = t.pendingGate;
    if (pg) {
      const sub = pg.subTask;
      if (sub && loc[sub]) return { ...base, laneId: loc[sub].laneId, laneIndex: laneIndex(loc[sub].laneId), columnId: loc[sub].columnId, lifecycle: 'needs-gate', gateId: pg.gateId };
      const lane = flow.find(l => l.id === (GATE_LANE[pg.type] ?? lastLane.id)) ?? lastLane;
      return { ...base, laneId: lane.id, laneIndex: laneIndex(lane.id), columnId: lane.agents[lane.agents.length - 1]?.id ?? 'done', lifecycle: 'needs-gate', gateId: pg.gateId };
    }
    for (const lane of flow) {
      for (const a of lane.agents) {
        const st = t.agentStatus[a.id];
        if (st && st !== 'completed') {
          const lifecycle: CardLifecycle = st === 'in_progress' ? 'running' : st === 'failed' ? 'needs-gate' : 'queued';
          return { ...base, laneId: lane.id, laneIndex: laneIndex(lane.id), columnId: a.id, lifecycle };
        }
      }
    }
    let doneLane = flow[0];
    for (const lane of flow) if (lane.agents.some(a => t.agentStatus[a.id] === 'completed')) doneLane = lane;
    return { ...base, laneId: doneLane.id, laneIndex: laneIndex(doneLane.id), columnId: 'done', lifecycle: 'done' };
  });
}

async function loadFlow(workspaceRoot: string): Promise<FlowLane[]> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, 'arbiter', 'flow.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { lanes?: FlowLane[] };
    if (Array.isArray(parsed.lanes) && parsed.lanes.length) return parsed.lanes;
  } catch { /* use default */ }
  return DEFAULT_FLOW;
}

/** Read all tasks' state + pending gates, derive cards, and write arbiter/board.json. */
export async function projectBoard(workspaceRoot: string): Promise<BoardJson> {
  const arbiterDir = path.join(workspaceRoot, 'arbiter');
  const flow = await loadFlow(workspaceRoot);

  // Pending gates by task.
  const gateByTask = new Map<string, { type: string; subTask?: string; gateId?: string }>();
  try {
    const gatesRaw = await fs.readFile(path.join(arbiterDir, 'pending-gates.json'), 'utf-8');
    for (const g of JSON.parse(gatesRaw) as Array<{ gate_id: string; task_id: string; type: string; sub_task?: string; status: string }>) {
      if (g.status === 'pending') gateByTask.set(g.task_id, { type: g.type, subTask: g.sub_task, gateId: g.gate_id });
    }
  } catch { /* none */ }

  // Per-task snapshots.
  const rank = (s: string) => (s === 'in_progress' ? 3 : s === 'failed' ? 2 : s === 'pending' ? 1 : 0);
  const snapshots: TaskSnapshot[] = [];
  let taskIds: string[] = [];
  try { taskIds = (await fs.readdir(path.join(arbiterDir, 'tasks'), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch { /* none */ }
  for (const id of taskIds) {
    try {
      const st = JSON.parse(await fs.readFile(path.join(arbiterDir, 'tasks', id, 'state.json'), 'utf-8')) as { sub_tasks?: Record<string, { agent_role: string; status: string }> };
      const agentStatus: Record<string, string> = {};
      for (const sub of Object.values(st.sub_tasks ?? {})) {
        const cur = agentStatus[sub.agent_role];
        if (!cur || rank(sub.status) > rank(cur)) agentStatus[sub.agent_role] = sub.status;
      }
      snapshots.push({ taskId: id, title: id, agentStatus, pendingGate: gateByTask.get(id) });
    } catch { /* skip unreadable task */ }
  }

  const board: BoardJson = { generated: new Date().toISOString(), lanes: flow, cards: deriveCards(flow, snapshots) };
  await fs.mkdir(arbiterDir, { recursive: true });
  // Written to lanes.json (NOT board.json — that name belongs to the legacy board format).
  await fs.writeFile(path.join(arbiterDir, 'lanes.json'), JSON.stringify(board, null, 2), 'utf-8');
  return board;
}
