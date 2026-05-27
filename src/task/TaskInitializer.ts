import fs from 'node:fs/promises';
import path from 'node:path';
import { SubTaskEntry, TaskState, AgentRole, ServiceResult } from '../types/index';
import { StateStore } from '../state/StateStore';
import { DecisionLog } from '../decisions/DecisionLog';

// Standard pipeline order with dependency graph.
// The plan agent fills in granular implementation sub-tasks later; these are
// the 11 agent invocations that every feature goes through.
const STANDARD_PIPELINE: Array<{ id: string; role: AgentRole; dependsOn: string[] }> = [
  { id: 'reframe',       role: 'reframe',       dependsOn: [] },
  { id: 'research',      role: 'research',      dependsOn: ['reframe'] },
  { id: 'design',        role: 'design',        dependsOn: ['research'] },
  { id: 'design-critic', role: 'design-critic', dependsOn: ['design'] },
  { id: 'integrator',    role: 'integrator',    dependsOn: ['design-critic'] },
  { id: 'plan',          role: 'plan',          dependsOn: ['integrator'] },
  { id: 'backend',       role: 'backend',       dependsOn: ['plan'] },
  { id: 'frontend',      role: 'frontend',      dependsOn: ['plan'] },
  { id: 'test-writer',   role: 'test-writer',   dependsOn: ['backend', 'frontend'] },
  { id: 'reviewer',      role: 'reviewer',      dependsOn: ['test-writer'] },
  { id: 'tech-writer',   role: 'tech-writer',   dependsOn: ['reviewer'] },
];

export interface InitOptions {
  taskId: string;
  specFile: string;
  workspaceRoot: string;
  skipAgents?: AgentRole[];
}

export interface InitResult {
  taskId: string;
  taskDir: string;
  stateFile: string;
  subTaskCount: number;
  pipeline: Array<{ id: string; role: AgentRole; dependsOn: string[] }>;
}

export class TaskInitializer {
  private readonly stateStore: StateStore;
  private readonly decisionLog: DecisionLog;

  constructor(workspaceRoot: string) {
    this.stateStore = new StateStore(workspaceRoot);
    this.decisionLog = new DecisionLog(workspaceRoot);
  }

  async init(opts: InitOptions): Promise<ServiceResult<InitResult>> {
    // Guard: don't overwrite existing state unless it's a clean task
    const exists = await this.stateStore.exists();
    if (exists) {
      const existing = await this.stateStore.read();
      if (existing.ok && existing.value.task_id !== opts.taskId) {
        return {
          ok: false,
          error: `State file already exists for task "${existing.value.task_id}". Delete .arbiter/state.json to init a new task.`,
          code: 'STATE_EXISTS',
        };
      }
      if (existing.ok && existing.value.task_id === opts.taskId) {
        return {
          ok: false,
          error: `Task ${opts.taskId} already initialized. Use --resume to continue.`,
          code: 'ALREADY_INIT',
        };
      }
    }

    // Read spec file
    let specContent: string;
    try {
      specContent = await fs.readFile(opts.specFile, 'utf-8');
    } catch (err) {
      return { ok: false, error: `Cannot read spec file ${opts.specFile}: ${String(err)}` };
    }

    // Create task directory and write task.md
    const taskDir = path.join(opts.workspaceRoot, '.arbiter', 'tasks', opts.taskId);
    try {
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(path.join(taskDir, 'task.md'), specContent, 'utf-8');
    } catch (err) {
      return { ok: false, error: `Failed to create task directory: ${String(err)}` };
    }

    // Build sub-task entries
    const skipSet = new Set<string>(opts.skipAgents ?? []);
    const pipeline = STANDARD_PIPELINE.filter(s => !skipSet.has(s.role));

    const subTasks: Record<string, SubTaskEntry> = {};
    for (const step of pipeline) {
      const filteredDeps = step.dependsOn.filter(dep => {
        // Only include deps that survived the skip filter
        const depStep = STANDARD_PIPELINE.find(s => s.id === dep);
        return depStep ? !skipSet.has(depStep.role) : false;
      });

      subTasks[step.id] = {
        status: 'pending',
        agent_role: step.role,
        model: '',        // Conductor resolves from config at runtime
        depends_on: filteredDeps.length > 0 ? filteredDeps : undefined,
      };
    }

    // Write initial state
    const stateResult = await this.stateStore.init(opts.taskId, subTasks);
    if (!stateResult.ok) return stateResult;

    await this.decisionLog.append({
      task_id: opts.taskId,
      event: 'task_init',
      detail: `spec=${opts.specFile} sub_tasks=${Object.keys(subTasks).length}`,
    });

    const stateFile = path.join(opts.workspaceRoot, '.arbiter', 'state.json');
    return {
      ok: true,
      value: {
        taskId: opts.taskId,
        taskDir,
        stateFile,
        subTaskCount: Object.keys(subTasks).length,
        pipeline,
      },
    };
  }

  // Returns the standard pipeline for display purposes
  static describePipeline(skipAgents: AgentRole[] = []): string {
    const skipSet = new Set(skipAgents);
    const lines = STANDARD_PIPELINE
      .filter(s => !skipSet.has(s.role))
      .map((s, i) => {
        const deps = s.dependsOn.filter(d => {
          const step = STANDARD_PIPELINE.find(p => p.id === d);
          return step ? !skipSet.has(step.role) : false;
        });
        const depStr = deps.length > 0 ? ` (after: ${deps.join(', ')})` : '';
        return `  ${String(i + 1).padStart(2)}. ${s.id.padEnd(16)} [${s.role}]${depStr}`;
      });
    return lines.join('\n');
  }
}
