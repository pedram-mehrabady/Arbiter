import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { projectBoard, deriveCards, DEFAULT_FLOW } from '../../src/board/BoardProjector';

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'board-proj-'));
}
function writeTask(root: string, id: string, subTasks: Record<string, { agent_role: string; status: string }>): void {
  const dir = path.join(root, 'arbiter', 'tasks', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ task_id: id, sub_tasks: subTasks }));
}

describe('deriveCards (engine)', () => {
  it('mirrors the dashboard: gate sub_task placement, frontier, done', () => {
    const cards = deriveCards(DEFAULT_FLOW, [
      { taskId: 'A', title: 'A', agentStatus: { design: 'completed', plan: 'in_progress' } },
      { taskId: 'B', title: 'B', agentStatus: { design: 'completed' }, pendingGate: { type: 'plan_approval', subTask: 'plan', gateId: 'g1' } },
    ]);
    expect(cards.find(c => c.taskId === 'A')).toMatchObject({ laneId: 'plan', columnId: 'plan', lifecycle: 'running' });
    expect(cards.find(c => c.taskId === 'B')).toMatchObject({ laneId: 'plan', columnId: 'plan', lifecycle: 'needs-gate', gateId: 'g1' });
  });
});

describe('projectBoard', () => {
  it('reads task states + gates and writes arbiter/lanes.json', async () => {
    const root = workspace();
    writeTask(root, 'T1', { reframe: { agent_role: 'reframe', status: 'completed' }, design: { agent_role: 'design', status: 'in_progress' } });
    writeTask(root, 'T2', { ideation: { agent_role: 'ideation', status: 'in_progress' } });
    fs.writeFileSync(path.join(root, 'arbiter', 'pending-gates.json'), JSON.stringify([
      { gate_id: 'g9', task_id: 'T1', type: 'design_approval', sub_task: 'design', status: 'pending' },
    ]));

    const board = await projectBoard(root);

    expect(board.cards).toHaveLength(2);
    expect(fs.existsSync(path.join(root, 'arbiter', 'lanes.json'))).toBe(true);
    const t2 = board.cards.find(c => c.taskId === 'T2');
    expect(t2).toMatchObject({ laneId: 'brainstorm', columnId: 'ideation' });
    const t1 = board.cards.find(c => c.taskId === 'T1');
    expect(t1?.lifecycle).toBe('needs-gate'); // pending design gate on T1
  });

  it('writes an empty card list when there are no tasks', async () => {
    const board = await projectBoard(workspace());
    expect(board.cards).toEqual([]);
  });
});
