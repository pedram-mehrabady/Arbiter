import fs from 'node:fs/promises';
import path from 'node:path';
import { TaskState, SubTaskEntry, ServiceResult } from '../types/index';

const QUEUE_FILE = path.join('arbiter', 'queue.json');

export interface QueuedTask {
  task_id: string;
  task_file: string;
  queued_at: string;
  priority: number;
}

export class TaskQueue {
  private readonly queuePath: string;

  constructor(workspaceRoot: string) {
    this.queuePath = path.join(workspaceRoot, QUEUE_FILE);
  }

  async enqueue(taskId: string, taskFile: string, priority = 0): Promise<ServiceResult<void>> {
    const existing = await this.readAll();
    if (!existing.ok) return existing;

    if (existing.value.some(t => t.task_id === taskId)) {
      return { ok: false, error: `Task ${taskId} already in queue`, code: 'DUPLICATE' };
    }

    existing.value.push({
      task_id: taskId,
      task_file: taskFile,
      queued_at: new Date().toISOString(),
      priority,
    });

    existing.value.sort((a, b) => b.priority - a.priority);

    return this.writeAll(existing.value);
  }

  async dequeue(): Promise<ServiceResult<QueuedTask | null>> {
    const existing = await this.readAll();
    if (!existing.ok) return existing;

    if (existing.value.length === 0) {
      return { ok: true, value: null };
    }

    const [next, ...rest] = existing.value;
    const writeResult = await this.writeAll(rest);
    if (!writeResult.ok) return writeResult;

    return { ok: true, value: next };
  }

  async peek(): Promise<ServiceResult<QueuedTask | null>> {
    const existing = await this.readAll();
    if (!existing.ok) return existing;
    return { ok: true, value: existing.value[0] ?? null };
  }

  async remove(taskId: string): Promise<ServiceResult<void>> {
    const existing = await this.readAll();
    if (!existing.ok) return existing;
    return this.writeAll(existing.value.filter(t => t.task_id !== taskId));
  }

  async list(): Promise<ServiceResult<QueuedTask[]>> {
    return this.readAll();
  }

  // Returns sub-tasks from state whose dependencies are all completed.
  // Used by the conductor to determine what to run next.
  static getEligible(state: TaskState): Array<[string, SubTaskEntry]> {
    return Object.entries(state.sub_tasks).filter(([, entry]) => {
      if (entry.status !== 'pending') return false;
      const deps = entry.depends_on ?? [];
      return deps.every(dep => state.sub_tasks[dep]?.status === 'completed');
    });
  }

  static isComplete(state: TaskState): boolean {
    return Object.values(state.sub_tasks).every(e => e.status === 'completed');
  }

  static hasFailed(state: TaskState): boolean {
    return Object.values(state.sub_tasks).some(e => e.status === 'failed');
  }

  static isDeadlocked(state: TaskState): boolean {
    const eligible = TaskQueue.getEligible(state);
    const inProgress = Object.values(state.sub_tasks).filter(e => e.status === 'in_progress');
    return eligible.length === 0 && inProgress.length === 0 && !TaskQueue.isComplete(state);
  }

  private async readAll(): Promise<ServiceResult<QueuedTask[]>> {
    try {
      const content = await fs.readFile(this.queuePath, 'utf-8');
      return { ok: true, value: JSON.parse(content) as QueuedTask[] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, value: [] };
      }
      return { ok: false, error: `Failed to read queue: ${String(err)}` };
    }
  }

  private async writeAll(tasks: QueuedTask[]): Promise<ServiceResult<void>> {
    try {
      await fs.mkdir(path.dirname(this.queuePath), { recursive: true });
      const tmp = `${this.queuePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(tmp, JSON.stringify(tasks, null, 2), 'utf-8');
      await fs.rename(tmp, this.queuePath);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to write queue: ${String(err)}` };
    }
  }
}
