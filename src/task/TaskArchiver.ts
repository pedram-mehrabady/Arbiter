import fs from 'node:fs/promises';
import path from 'node:path';
import { TaskState, ServiceResult } from '../types/index';

const ARCHIVE_DIR = path.join('arbiter', 'archive');

export interface ArchivedTaskMeta {
  task_id: string;
  archived_at: string;
  phase_status: string;
  sub_task_count: number;
}

export class TaskArchiver {
  private readonly archiveDir: string;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.archiveDir = path.join(workspaceRoot, ARCHIVE_DIR);
  }

  private taskStatePath(taskId: string): string {
    return path.join(this.workspaceRoot, 'arbiter', 'tasks', taskId, 'state.json');
  }

  // Snapshot active per-task state → archive/<task_id>.json and remove state.json from task dir.
  async archive(taskId: string): Promise<ServiceResult<ArchivedTaskMeta>> {
    const statePath = this.taskStatePath(taskId);
    let state: TaskState;
    try {
      const raw = await fs.readFile(statePath, 'utf-8');
      state = JSON.parse(raw) as TaskState;
    } catch (err) {
      return { ok: false, error: `Cannot read state for task "${taskId}": ${String(err)}` };
    }

    await fs.mkdir(this.archiveDir, { recursive: true });

    const dest = path.join(this.archiveDir, `${taskId}.json`);
    const archivedAt = new Date().toISOString();
    const snapshot = { ...state, archived_at: archivedAt };

    const tmp = `${dest}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
    await fs.rename(tmp, dest);

    // Remove per-task state.json so the task dir is no longer "active"
    await fs.unlink(statePath).catch(() => undefined);

    return {
      ok: true,
      value: {
        task_id: taskId,
        archived_at: archivedAt,
        phase_status: state.phase_status,
        sub_task_count: Object.keys(state.sub_tasks).length,
      },
    };
  }

  // Restore archive/<task_id>.json → per-task state.json.
  async restore(taskId: string): Promise<ServiceResult<TaskState>> {
    const src = path.join(this.archiveDir, `${taskId}.json`);
    let state: TaskState;
    try {
      const raw = await fs.readFile(src, 'utf-8');
      state = JSON.parse(raw) as TaskState;
    } catch {
      return { ok: false, error: `No archived task "${taskId}" found`, code: 'NOT_FOUND' };
    }

    const statePath = this.taskStatePath(taskId);
    await fs.mkdir(path.dirname(statePath), { recursive: true });

    const tmp = `${statePath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
    await fs.rename(tmp, statePath);

    return { ok: true, value: state };
  }

  // List all archived task IDs with basic metadata.
  async list(): Promise<ServiceResult<ArchivedTaskMeta[]>> {
    try {
      const dirents = await fs.readdir(this.archiveDir, { withFileTypes: true });
      const metas: ArchivedTaskMeta[] = [];
      for (const d of dirents) {
        if (!d.isFile() || !d.name.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(path.join(this.archiveDir, d.name), 'utf-8');
          const s = JSON.parse(raw) as TaskState & { archived_at?: string };
          metas.push({
            task_id: s.task_id,
            archived_at: s.archived_at ?? s.updated_at,
            phase_status: s.phase_status,
            sub_task_count: Object.keys(s.sub_tasks).length,
          });
        } catch {
          // Corrupt entry — skip silently
        }
      }
      return { ok: true, value: metas };
    } catch {
      return { ok: true, value: [] };
    }
  }
}
