import fs from 'node:fs/promises';
import path from 'node:path';
import { Conductor } from '../conductor/Conductor';
import { TaskInitializer } from '../task/TaskInitializer';
import { projectBoard } from '../board/BoardProjector';

// Roles that mean a task has been initialized into the build pipeline (not a
// brainstorm-only idea, which has just an `ideation` sub-task).
const PIPELINE_ROLES = new Set([
  'reframe', 'research', 'design', 'design-critic', 'integrator', 'plan',
  'frontend', 'backend', 'test-writer', 'reviewer', 'tech-writer', 'prd', 'push',
]);

export interface FactoryOptions {
  workspaceRoot: string;
  provider?: unknown;   // e.g. a MockProvider; undefined → Conductor's default
  maxTasks: number;     // max concurrent in-flight tasks (incl. gate-paused)
  intervalMs: number;
  log?: (msg: string) => void;
}

type SubTask = { agent_role: string; status: string };

/**
 * The factory daemon: watches arbiter/tasks/, runs the Conductor for every
 * pipeline-ready task (up to a concurrency cap), promotes flagged brainstorm
 * ideas into the pipeline, and keeps arbiter/lanes.json fresh. Tasks pause at
 * human gates (the Conductor blocks until the gate is resolved in the dashboard).
 */
export class FactoryDaemon {
  private readonly running = new Set<string>();
  private stopped = false;

  constructor(private readonly opts: FactoryOptions) {}

  private log(m: string): void { (this.opts.log ?? console.log)(`[factory] ${m}`); }
  stop(): void { this.stopped = true; }

  async watch(): Promise<void> {
    this.log(`watching ${this.opts.workspaceRoot} (maxTasks=${this.opts.maxTasks}, every ${this.opts.intervalMs}ms)`);
    while (!this.stopped) {
      await this.tick().catch(e => this.log(`tick error: ${String(e)}`));
      await sleep(this.opts.intervalMs);
    }
  }

  async tick(): Promise<void> {
    const root = this.opts.workspaceRoot;
    await this.runDecompositions(root);
    await projectBoard(root).catch(() => {});

    let ids: string[] = [];
    try {
      ids = (await fs.readdir(path.join(root, 'arbiter', 'tasks'), { withFileTypes: true }))
        .filter(d => d.isDirectory()).map(d => d.name);
    } catch { return; }

    for (const id of ids) {
      if (this.stopped) return;
      if (this.running.has(id)) continue;

      const taskDir = path.join(root, 'arbiter', 'tasks', id);
      let subs: SubTask[] = [];
      try {
        const state = JSON.parse(await fs.readFile(path.join(taskDir, 'state.json'), 'utf-8')) as { sub_tasks?: Record<string, SubTask> };
        subs = Object.values(state.sub_tasks ?? {});
      } catch { continue; }

      const isPipeline = subs.some(s => PIPELINE_ROLES.has(s.agent_role));
      const promoted = await fileExists(path.join(taskDir, 'promote.flag'));

      if (!isPipeline) {
        // Brainstorm idea: only run it once the user has promoted it (dragged → Design).
        if (promoted) await this.promote(root, id).catch(e => this.log(`promote ${id} failed: ${String(e)}`));
        continue;
      }

      const allDone = subs.length > 0 && subs.every(s => s.status === 'completed');
      if (allDone) continue;
      if (this.running.size >= this.opts.maxTasks) continue;

      void this.run(id, subs);
    }
  }

  /** Decompose any Epic flagged by the dashboard (arbiter/epics/<id>/decompose.flag). */
  private async runDecompositions(root: string): Promise<void> {
    let epicIds: string[] = [];
    try {
      epicIds = (await fs.readdir(path.join(root, 'arbiter', 'epics'), { withFileTypes: true }))
        .filter(d => d.isDirectory()).map(d => d.name);
    } catch { return; }
    for (const id of epicIds) {
      const flag = path.join(root, 'arbiter', 'epics', id, 'decompose.flag');
      if (!(await fileExists(flag))) continue;
      try {
        const { decompose } = await import('../epics/EpicStore');
        const epic = await decompose(root, id);
        await fs.rm(flag, { force: true });
        this.log(`decomposed ${id} → ${epic.stories.length} stories`);
      } catch (e) { this.log(`decompose ${id} failed: ${String(e)}`); }
    }
  }

  /** Re-initialize a flagged brainstorm idea as a full pipeline task. */
  private async promote(root: string, id: string): Promise<void> {
    const taskDir = path.join(root, 'arbiter', 'tasks', id);
    await fs.rm(path.join(taskDir, 'state.json'), { force: true });
    const res = await new TaskInitializer(root).init({ taskId: id, specFile: path.join(taskDir, 'task.md'), workspaceRoot: root });
    await fs.rm(path.join(taskDir, 'promote.flag'), { force: true });
    this.log(res.ok ? `promoted ${id} → pipeline` : `promote ${id}: ${res.error}`);
    await projectBoard(root).catch(() => {});
  }

  private async run(id: string, subs: SubTask[]): Promise<void> {
    this.running.add(id);
    const resume = subs.some(s => s.status === 'completed' || s.status === 'in_progress');
    this.log(`running ${id}${resume ? ' (resume)' : ''}`);
    try {
      const conductor = new Conductor({
        resume, shadow: false, dryRun: false,
        workspaceRoot: this.opts.workspaceRoot, maxParallel: 1,
        ...(this.opts.provider ? { provider: this.opts.provider } : {}),
      });
      const r = await conductor.conduct(id);
      this.log(r.ok ? `done ${id}` : `${id} stopped: ${r.error}`);
    } catch (e) {
      this.log(`${id} error: ${String(e)}`);
    } finally {
      this.running.delete(id);
      await projectBoard(this.opts.workspaceRoot).catch(() => {});
    }
  }
}

function fileExists(p: string): Promise<boolean> { return fs.access(p).then(() => true).catch(() => false); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
