import fs from 'node:fs/promises';
import path from 'node:path';
import { TaskState, SubTaskEntry, ServiceResult } from '../types/index';

const STATE_FILE = path.join('.arbiter', 'state.json');

export class StateStore {
  private readonly filePath: string;

  constructor(workspaceRoot: string) {
    this.filePath = path.join(workspaceRoot, STATE_FILE);
  }

  async read(): Promise<ServiceResult<TaskState>> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      return { ok: true, value: JSON.parse(content) as TaskState };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { ok: false, error: 'State file not found — run `arbiter init` first', code: 'ENOENT' };
      }
      return { ok: false, error: `Failed to read state: ${String(err)}`, code: 'READ_ERROR' };
    }
  }

  async write(state: TaskState): Promise<ServiceResult<void>> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      state.updated_at = new Date().toISOString();
      const tmpPath = `${this.filePath}.tmp.${process.pid}`;
      await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
      await fs.rename(tmpPath, this.filePath);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to write state: ${String(err)}`, code: 'WRITE_ERROR' };
    }
  }

  async init(taskId: string, subTasks: Record<string, SubTaskEntry>): Promise<ServiceResult<TaskState>> {
    const now = new Date().toISOString();
    const state: TaskState = {
      task_id: taskId,
      phase: 'init',
      phase_status: 'pending',
      created_at: now,
      updated_at: now,
      sub_tasks: subTasks,
    };
    const result = await this.write(state);
    if (!result.ok) return result;
    return { ok: true, value: state };
  }

  async updateSubTask(
    subTaskId: string,
    updates: Partial<SubTaskEntry>,
  ): Promise<ServiceResult<TaskState>> {
    const readResult = await this.read();
    if (!readResult.ok) return readResult;

    const state = readResult.value;
    if (!(subTaskId in state.sub_tasks)) {
      return { ok: false, error: `Sub-task "${subTaskId}" not found in state`, code: 'NOT_FOUND' };
    }

    state.sub_tasks[subTaskId] = { ...state.sub_tasks[subTaskId], ...updates };

    const writeResult = await this.write(state);
    if (!writeResult.ok) return writeResult;

    return { ok: true, value: state };
  }

  async setPhaseStatus(phase: string, status: TaskState['phase_status']): Promise<ServiceResult<TaskState>> {
    const readResult = await this.read();
    if (!readResult.ok) return readResult;

    const state = readResult.value;
    state.phase = phase;
    state.phase_status = status;

    const writeResult = await this.write(state);
    if (!writeResult.ok) return writeResult;

    return { ok: true, value: state };
  }

  exists(): Promise<boolean> {
    return fs.access(this.filePath).then(() => true).catch(() => false);
  }
}
