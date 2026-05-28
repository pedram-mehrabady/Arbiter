import fs from 'node:fs/promises';
import path from 'node:path';
import { SubTaskEntry, TaskState, AgentRole, PipelineName, ServiceResult } from '../types/index';
import { StateStore } from '../state/StateStore';
import { DecisionLog } from '../decisions/DecisionLog';

type PipelineStep = { id: string; role: AgentRole; dependsOn: string[] };

// Standard 11-agent pipeline — deep research, architecture gates, full review chain.
const STANDARD_PIPELINE: PipelineStep[] = [
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

// Fast 5-agent pipeline — prd gathers requirements, then frontend + backend
// run in parallel, test-writer covers both, push validates and finalises.
// Same gates, receipts, and evidence generation as standard — just fewer agents.
const FAST_PIPELINE: PipelineStep[] = [
  { id: 'prd',         role: 'prd',         dependsOn: [] },
  { id: 'frontend',    role: 'frontend',    dependsOn: ['prd'] },
  { id: 'backend',     role: 'backend',     dependsOn: ['prd'] },
  { id: 'test-writer', role: 'test-writer', dependsOn: ['frontend', 'backend'] },
  { id: 'push',        role: 'push',        dependsOn: ['test-writer'] },
];

const PIPELINES: Record<PipelineName, PipelineStep[]> = {
  standard: STANDARD_PIPELINE,
  fast:     FAST_PIPELINE,
  full:     STANDARD_PIPELINE,
  speed:    FAST_PIPELINE,
};

export interface InitOptions {
  taskId: string;
  specFile: string;
  workspaceRoot: string;
  skipAgents?: AgentRole[];
  pipeline?: PipelineName;
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
    const pipelineName: PipelineName = opts.pipeline ?? 'standard';
    // Use per-task state path so multiple tasks can coexist without conflict.
    const taskStateStore = new StateStore(opts.workspaceRoot, opts.taskId);

    // Guard: don't overwrite an existing state for the same task id
    const exists = await taskStateStore.exists();
    if (exists) {
      return {
        ok: false,
        error: `Task ${opts.taskId} already initialized. Use --resume to continue.`,
        code: 'ALREADY_INIT',
      };
    }

    // Read spec file
    let specContent: string;
    try {
      specContent = await fs.readFile(opts.specFile, 'utf-8');
    } catch (err) {
      return { ok: false, error: `Cannot read spec file ${opts.specFile}: ${String(err)}` };
    }

    // Create task directory and write task.md
    const taskDir = path.join(opts.workspaceRoot, 'arbiter', 'tasks', opts.taskId);
    try {
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(path.join(taskDir, 'task.md'), specContent, 'utf-8');
    } catch (err) {
      return { ok: false, error: `Failed to create task directory: ${String(err)}` };
    }

    // Build sub-task entries from the selected pipeline
    const sourcePipeline = PIPELINES[pipelineName];
    const skipSet = new Set<string>(opts.skipAgents ?? []);
    const pipeline = sourcePipeline.filter(s => !skipSet.has(s.role));

    const subTasks: Record<string, SubTaskEntry> = {};
    for (const step of pipeline) {
      const filteredDeps = step.dependsOn.filter(dep => {
        const depStep = sourcePipeline.find(s => s.id === dep);
        return depStep ? !skipSet.has(depStep.role) : false;
      });

      subTasks[step.id] = {
        status: 'pending',
        agent_role: step.role,
        model: '',
        depends_on: filteredDeps.length > 0 ? filteredDeps : undefined,
      };
    }

    // Write initial state to the task-scoped path
    const stateResult = await taskStateStore.init(opts.taskId, subTasks);
    if (!stateResult.ok) return stateResult;

    await this.decisionLog.append({
      task_id: opts.taskId,
      event: 'task_init',
      detail: `spec=${opts.specFile} pipeline=${pipelineName} sub_tasks=${Object.keys(subTasks).length}`,
    });

    return {
      ok: true,
      value: {
        taskId: opts.taskId,
        taskDir,
        stateFile: taskStateStore.filePath,
        subTaskCount: Object.keys(subTasks).length,
        pipeline,
      },
    };
  }

  static describePipeline(skipAgents: AgentRole[] = [], pipelineName: PipelineName = 'standard'): string {
    const sourcePipeline = PIPELINES[pipelineName];
    const skipSet = new Set(skipAgents);
    const lines = sourcePipeline
      .filter(s => !skipSet.has(s.role))
      .map((s, i) => {
        const deps = s.dependsOn.filter(d => {
          const step = sourcePipeline.find(p => p.id === d);
          return step ? !skipSet.has(step.role) : false;
        });
        const depStr = deps.length > 0 ? ` (after: ${deps.join(', ')})` : '';
        return `  ${String(i + 1).padStart(2)}. ${s.id.padEnd(16)} [${s.role}]${depStr}`;
      });
    return lines.join('\n');
  }
}
