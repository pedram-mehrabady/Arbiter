import fs from 'node:fs/promises';
import path from 'node:path';
import {
  TaskState,
  SubTaskEntry,
  FailureClass,
  ConductOptions,
  ServiceResult,
  AgentRole,
  FactoryConfig,
} from '../types/index';
import { StateStore } from '../state/StateStore';
import { DecisionLog } from '../decisions/DecisionLog';
import { FailureClassifier } from '../classifiers/FailureClassifier';
import { PreflightCheck } from '../preflight/PreflightCheck';
import { LLMProvider } from '../providers/LLMProvider';
import { AnthropicProvider } from '../providers/AnthropicProvider';
import { BuildReceiptStore } from '../receipts/BuildReceipt';
import { GatePoller } from '../gates/GatePoller';
import { GateRegistry } from '../gates/GateRegistry';
import { RateLimiter } from '../queue/RateLimiter';
import { TaskQueue } from '../queue/TaskQueue';
import { ContextAssembler } from '../context/ContextAssembler';
import { ContextPruner } from '../context/ContextPruner';

const CONFIG_FILE = 'arbiter.config.json';
const FALLBACK_CONFIG_FILE = 'factory-config.json';

interface SubTaskRunResult {
  success: boolean;
  receiptId?: string;
  failureClass?: FailureClass;
  errorMessage?: string;
}

export class Conductor {
  private readonly stateStore: StateStore;
  private readonly decisionLog: DecisionLog;
  private readonly failureClassifier = new FailureClassifier();
  private readonly preflight: PreflightCheck;
  private readonly receipts: BuildReceiptStore;
  private readonly gatePoller: GatePoller;
  private readonly gateRegistry = new GateRegistry();
  private readonly rateLimiter: RateLimiter;
  private readonly contextAssembler: ContextAssembler;
  private readonly contextPruner = new ContextPruner();
  private provider: LLMProvider;
  private config: FactoryConfig | null = null;
  private readonly options: ConductOptions;

  constructor(options: ConductOptions) {
    this.options = options;
    const root = options.workspaceRoot;
    this.stateStore = new StateStore(root);
    this.decisionLog = new DecisionLog(root);
    this.preflight = new PreflightCheck();
    this.receipts = new BuildReceiptStore(root);
    this.gatePoller = new GatePoller(root, this.decisionLog);
    this.rateLimiter = new RateLimiter(root);
    this.contextAssembler = new ContextAssembler(root);
    this.provider = new AnthropicProvider();
  }

  async conduct(taskId: string): Promise<ServiceResult<void>> {
    const configResult = await this.loadConfig();
    if (!configResult.ok) return configResult;

    await this.receipts.ensureSigningKey();

    const stateResult = await this.stateStore.read();
    if (!stateResult.ok) {
      if (stateResult.code === 'ENOENT') {
        return { ok: false, error: `No state found for task ${taskId}. Run 'arbiter task init' first.` };
      }
      return stateResult;
    }

    const state = stateResult.value;
    if (state.task_id !== taskId) {
      return {
        ok: false,
        error: `State file contains task ${state.task_id}, expected ${taskId}`,
        code: 'TASK_MISMATCH',
      };
    }

    await this.decisionLog.append({
      task_id: taskId,
      event: this.options.resume ? 'pipeline_resume' : 'pipeline_start',
      detail: `maxParallel=${this.options.maxParallel} shadow=${this.options.shadow}`,
    });

    return this.runLoop(state);
  }

  private async runLoop(state: TaskState): Promise<ServiceResult<void>> {
    const taskId = state.task_id;

    while (true) {
      // Re-read state fresh each iteration
      const fresh = await this.stateStore.read();
      if (!fresh.ok) return fresh;
      state = fresh.value;

      if (TaskQueue.isComplete(state)) {
        await this.decisionLog.append({ task_id: taskId, event: 'pipeline_complete', detail: 'All sub-tasks completed' });
        console.log(`\n✓ Task ${taskId} complete.`);
        return { ok: true, value: undefined };
      }

      if (TaskQueue.hasFailed(state)) {
        await this.decisionLog.append({ task_id: taskId, event: 'pipeline_halted', detail: 'Sub-task in failed state' });
        console.error(`\n✗ Task ${taskId} halted — a sub-task failed. Review decision log.`);
        return { ok: false, error: 'Pipeline halted due to sub-task failure', code: 'SUBTASK_FAILED' };
      }

      if (TaskQueue.isDeadlocked(state)) {
        await this.decisionLog.append({ task_id: taskId, event: 'pipeline_deadlock', detail: 'No eligible sub-tasks and none in progress' });
        return { ok: false, error: 'Pipeline deadlock — no eligible sub-tasks', code: 'DEADLOCK' };
      }

      // Check daily spend cap
      const capResult = await this.rateLimiter.checkDailyCap();
      if (!capResult.ok) return capResult;
      if (!capResult.value.allowed) {
        console.log(`\nDaily cap reached ($${capResult.value.spent.toFixed(2)} / $${capResult.value.cap}). Pipeline paused.`);
        await this.decisionLog.append({
          task_id: taskId,
          event: 'daily_cap_reached',
          detail: `spent=${capResult.value.spent.toFixed(2)} cap=${capResult.value.cap}`,
        });
        return { ok: false, error: 'Daily spend cap reached', code: 'DAILY_CAP' };
      }

      // Block on pending gates for this task
      const pendingResult = await this.gatePoller.listPending(taskId);
      if (!pendingResult.ok) return pendingResult;
      if (pendingResult.value.length > 0) {
        const gate = pendingResult.value[0];
        const waitResult = await this.gatePoller.waitForApproval(gate.gate_id);
        if (!waitResult.ok) return waitResult;
        if (waitResult.value === 'rejected') {
          await this.decisionLog.append({
            task_id: taskId,
            event: 'pipeline_rejected_at_gate',
            detail: `gate_id=${gate.gate_id}`,
          });
          return { ok: false, error: `Pipeline rejected at gate ${gate.gate_id}`, code: 'GATE_REJECTED' };
        }
        continue;
      }

      // Determine eligible sub-tasks
      const eligible = TaskQueue.getEligible(state);
      if (eligible.length === 0) {
        await sleep(2_000);
        continue;
      }

      const headroom = await this.rateLimiter.getHeadroom();
      const concurrency = headroom > 0.5
        ? Math.min(this.options.maxParallel, eligible.length)
        : 1;
      const batch = eligible.slice(0, concurrency);

      if (this.options.dryRun) {
        console.log(`[dry-run] Would run: ${batch.map(([id]) => id).join(', ')}`);
        break;
      }

      await Promise.all(batch.map(([subTaskId, entry]) =>
        this.runSubTask(state.task_id, subTaskId, entry, state),
      ));
    }

    return { ok: true, value: undefined };
  }

  private async runSubTask(
    taskId: string,
    subTaskId: string,
    entry: SubTaskEntry,
    state: TaskState,
  ): Promise<SubTaskRunResult> {
    const agentRole = entry.agent_role;
    const model = this.resolveModel(agentRole);
    const taskDir = path.join(this.options.workspaceRoot, '.arbiter', 'tasks', taskId);

    // Mark in_progress
    await this.stateStore.updateSubTask(subTaskId, { status: 'in_progress', model });
    await this.decisionLog.logAgentStart(taskId, subTaskId, agentRole, model);

    // Assemble context
    const ctxResult = await this.contextAssembler.assemble(agentRole, taskDir, '', '');
    if (!ctxResult.ok) {
      await this.handleInfraFailure(taskId, subTaskId, `Context assembly failed: ${ctxResult.error}`);
      return { success: false, failureClass: 'infrastructure', errorMessage: ctxResult.error };
    }

    const ctx = this.contextPruner.prune(ctxResult.value);
    if (!ctx.ok) return { success: false, failureClass: 'infrastructure' };

    // Preflight
    const preflightResult = await this.preflight.run(
      taskId,
      subTaskId,
      ctx.value.filesIncluded,
      state.complexity_score,
    );
    if (!preflightResult.ok) {
      await this.handleInfraFailure(taskId, subTaskId, preflightResult.error);
      return { success: false, failureClass: 'infrastructure', errorMessage: preflightResult.error };
    }

    if (!preflightResult.value.passed) {
      const failures = this.preflight.formatFailures(preflightResult.value);
      await this.decisionLog.logPreflightReject(taskId, subTaskId, 'preflight_fail', failures);
      await this.stateStore.updateSubTask(subTaskId, { status: 'failed' });
      return { success: false, failureClass: 'infrastructure', errorMessage: failures };
    }

    // Invoke provider
    const llmResult = await this.provider.invoke({
      model,
      assembledPrompt: ctx.value.prompt,
      maxTokens: 8192,
      timeoutMs: 300_000,
    });

    if (!llmResult.ok) {
      return this.handleLLMFailure(taskId, subTaskId, entry, {
        exitCode: 1,
        stderr: llmResult.error,
        stdout: '',
        strikeCount: entry.strike ?? 0,
      });
    }

    const response = llmResult.value;

    // Record usage
    await this.rateLimiter.record(
      taskId, subTaskId, agentRole, model,
      response.inputTokens, response.outputTokens, ctx.value.tokenEstimate,
    );
    await this.rateLimiter.handleRateLimitInfo(response.rateLimitInfo);

    // Write output to task dir
    const outputFile = path.join(taskDir, `${subTaskId}-output.md`);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(outputFile, response.content, 'utf-8');

    // Create build receipt
    const receiptResult = await this.receipts.create({
      taskId,
      subTask: subTaskId,
      agentRole,
      model,
      contextHash: ctx.value.contextHash,
      outputFiles: [outputFile],
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: this.provider.estimateCost(model, response.inputTokens, response.outputTokens),
      failureClass: null,
      strikeCount: entry.strike ?? 0,
      debuggerInvoked: false,
      debuggerDiffHash: null,
      debuggerDiffPct: null,
    });

    if (!receiptResult.ok) {
      console.warn(`Warning: receipt creation failed for ${subTaskId}: ${receiptResult.error}`);
    }

    const receiptId = receiptResult.ok ? receiptResult.value.receipt_id : undefined;

    // Update state: completed
    await this.stateStore.updateSubTask(subTaskId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      output_hash: ctx.value.contextHash,
      receipt_id: receiptId,
    });

    await this.decisionLog.logAgentComplete(taskId, subTaskId, agentRole, receiptId ?? 'none');

    // Check if a gate should fire after this agent
    const gateSpec = this.gateRegistry.getGateAfterAgent(agentRole);
    if (gateSpec) {
      const updatedState = await this.stateStore.read();
      if (updatedState.ok) {
        await this.gatePoller.createGate(
          taskId,
          gateSpec.type,
          `Agent ${agentRole} completed. Review output at ${outputFile}`,
          subTaskId,
        );
      }
    }

    console.log(`  ✓ ${subTaskId} (${agentRole}/${model})`);
    return { success: true, receiptId };
  }

  private async handleLLMFailure(
    taskId: string,
    subTaskId: string,
    entry: SubTaskEntry,
    signal: { exitCode: number; stderr: string; stdout: string; strikeCount: number },
  ): Promise<SubTaskRunResult> {
    const classification = this.failureClassifier.classify(signal);
    if (!classification.ok) {
      return { success: false, failureClass: 'infrastructure', errorMessage: classification.error };
    }

    const { class: fc, shouldRetry, shouldEscalateToDebugger, shouldRejectToFailed } = classification.value;
    const newStrike = (entry.strike ?? 0) + (fc === 'stochastic' ? 1 : 0);

    await this.decisionLog.logFailure(taskId, subTaskId, fc, newStrike, signal.stderr.slice(0, 300));

    if (shouldRejectToFailed || shouldEscalateToDebugger) {
      await this.stateStore.updateSubTask(subTaskId, {
        status: 'failed',
        strike: newStrike,
        last_failure_class: fc,
      });
      if (shouldEscalateToDebugger) {
        console.error(`  ✗ ${subTaskId} — max strikes reached, escalating to debugger (not yet implemented)`);
      }
    } else if (shouldRetry) {
      await this.stateStore.updateSubTask(subTaskId, {
        status: 'pending',
        strike: newStrike,
        last_failure_class: fc,
      });
    } else if (fc === 'infrastructure') {
      // Infrastructure: mark failed so conductor halts and human can fix
      await this.stateStore.updateSubTask(subTaskId, { status: 'failed', last_failure_class: fc });
    }

    return { success: false, failureClass: fc, errorMessage: signal.stderr.slice(0, 300) };
  }

  private async handleInfraFailure(taskId: string, subTaskId: string, detail: string): Promise<void> {
    await this.decisionLog.logFailure(taskId, subTaskId, 'infrastructure', 0, detail);
    await this.stateStore.updateSubTask(subTaskId, { status: 'failed', last_failure_class: 'infrastructure' });
  }

  private resolveModel(role: AgentRole): string {
    if (!this.config) return 'claude-sonnet-4-6';
    return this.config.roles[role]?.model ?? 'claude-sonnet-4-6';
  }

  private async loadConfig(): Promise<ServiceResult<void>> {
    const locations = [
      path.join(this.options.workspaceRoot, CONFIG_FILE),
      path.join(this.options.workspaceRoot, FALLBACK_CONFIG_FILE),
    ];

    for (const loc of locations) {
      try {
        const content = await fs.readFile(loc, 'utf-8');
        this.config = JSON.parse(content) as FactoryConfig;

        const providerConfig = Object.values(this.config.providers)[0];
        if (providerConfig?.cmd) {
          this.provider = new AnthropicProvider({
            cmd: providerConfig.cmd,
            headlessFlag: providerConfig.headless_flag ?? '-p',
          });
        }

        return { ok: true, value: undefined };
      } catch {
        continue;
      }
    }

    return {
      ok: false,
      error: `Config not found. Create arbiter.config.json in ${this.options.workspaceRoot}`,
      code: 'CONFIG_NOT_FOUND',
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
