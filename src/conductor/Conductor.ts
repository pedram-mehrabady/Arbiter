import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  TaskState,
  SubTaskEntry,
  FailureClass,
  ConductOptions,
  ServiceResult,
  AgentRole,
  FactoryConfig,
  BuildReceipt,
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
import { BundleAssembler } from '../bundle/BundleAssembler';
import { PlanValidator } from '../plan/PlanValidator';
import { FIXED_PIPELINE_IDS } from '../plan/PlanOutput';

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
  private readonly bundleAssembler: BundleAssembler;
  private readonly planValidator = new PlanValidator();
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
    this.bundleAssembler = new BundleAssembler(root);
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

    let state = stateResult.value;
    if (state.task_id !== taskId) {
      return {
        ok: false,
        error: `State file contains task ${state.task_id}, expected ${taskId}`,
        code: 'TASK_MISMATCH',
      };
    }

    if (this.options.resume) {
      const recoveryResult = await this.recoverState(taskId, state);
      if (!recoveryResult.ok) return recoveryResult;
      state = recoveryResult.value;
    } else {
      // Fresh start — reject if any sub-task is already completed (use --resume)
      const hasProgress = Object.values(state.sub_tasks).some(
        e => e.status === 'completed' || e.status === 'in_progress',
      );
      if (hasProgress) {
        return {
          ok: false,
          error: `Task ${taskId} has existing progress. Use --resume to continue, or delete .arbiter/state.json to restart.`,
          code: 'USE_RESUME',
        };
      }
    }

    await this.decisionLog.append({
      task_id: taskId,
      event: this.options.resume ? 'pipeline_resume' : 'pipeline_start',
      detail: `maxParallel=${this.options.maxParallel} shadow=${this.options.shadow}`,
    });

    return this.runLoop(state);
  }

  // P0-1: On resume, reset interrupted sub-tasks and verify completed ones.
  private async recoverState(taskId: string, state: TaskState): Promise<ServiceResult<TaskState>> {
    const allReceipts = await this.receipts.readAll();
    const receiptMap = new Map<string, BuildReceipt>(
      allReceipts.ok ? allReceipts.value.map(r => [r.receipt_id, r]) : [],
    );

    for (const [subTaskId, entry] of Object.entries(state.sub_tasks)) {
      if (entry.status === 'in_progress') {
        // Interrupted mid-invocation — reset to pending, consume no strike
        const update = await this.stateStore.updateSubTask(subTaskId, { status: 'pending' });
        if (!update.ok) return update;
        await this.decisionLog.append({
          task_id: taskId,
          sub_task: subTaskId,
          event: 'resume_reset_in_progress',
          detail: 'Was in_progress at resume — reset to pending (SIGKILL recovery)',
        });
        console.log(`  ↺ ${subTaskId} — interrupted, reset to pending`);

      } else if (entry.status === 'completed') {
        const valid = await this.verifyCompletedSubTask(entry, receiptMap);

        if (!valid) {
          // Output files changed or receipt invalid — must re-run
          const update = await this.stateStore.updateSubTask(subTaskId, {
            status: 'pending',
            output_hash: undefined,
            receipt_id: undefined,
          });
          if (!update.ok) return update;
          await this.decisionLog.append({
            task_id: taskId,
            sub_task: subTaskId,
            event: 'resume_hash_mismatch',
            detail: 'Output hash mismatch or receipt invalid — reset to pending for re-run',
          });
          console.log(`  ⚠ ${subTaskId} — output changed since completion, will re-run`);
        } else {
          await this.decisionLog.append({
            task_id: taskId,
            sub_task: subTaskId,
            event: 'resume_skip_verified',
            detail: `Output verified (receipt: ${entry.receipt_id ?? 'none'}) — skipping`,
          });
          console.log(`  ✓ ${subTaskId} — verified, skipping`);
        }
      }
    }

    return this.stateStore.read();
  }

  private async verifyCompletedSubTask(
    entry: SubTaskEntry,
    receiptMap: Map<string, BuildReceipt>,
  ): Promise<boolean> {
    if (!entry.receipt_id) return false;

    const receipt = receiptMap.get(entry.receipt_id);
    if (!receipt) return false;

    // Verify Ed25519 signature on the receipt itself
    const sigValid = await this.receipts.verify(entry.receipt_id);
    if (!sigValid.ok || !sigValid.value) return false;

    // Verify output files on disk match hashes in receipt
    for (const [filePath, storedHash] of Object.entries(receipt.output_hashes)) {
      if (storedHash === 'sha256:MISSING') continue;
      try {
        const content = await fs.readFile(filePath);
        const currentHash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
        if (currentHash !== storedHash) return false;
      } catch {
        return false;
      }
    }

    return true;
  }

  private async runLoop(state: TaskState): Promise<ServiceResult<void>> {
    const taskId = state.task_id;

    while (true) {
      // Re-read state fresh each iteration
      const fresh = await this.stateStore.read();
      if (!fresh.ok) return fresh;
      state = fresh.value;

      if (TaskQueue.isComplete(state)) {
        await this.decisionLog.append({
          task_id: taskId,
          event: 'pipeline_complete',
          detail: 'All sub-tasks completed',
        });
        console.log(`\n✓ Task ${taskId} complete. Assembling AFTA evidence bundle...`);

        const bundleResult = await this.bundleAssembler.assemble(taskId, state);
        if (!bundleResult.ok) {
          console.warn(`  ⚠ Bundle assembly failed: ${bundleResult.error}`);
          console.warn(`    Run 'arbiter bundle create ${taskId}' to retry.`);
        } else {
          const { zipPath, bundleId, presentArtifacts, missingArtifacts } = bundleResult.value;
          console.log(`  ✓ Bundle: ${zipPath}`);
          console.log(`    ID: ${bundleId}`);
          console.log(`    ALC artifacts: ${presentArtifacts.length} present`);
          if (missingArtifacts.length > 0) {
            console.warn(`    Missing: ${missingArtifacts.join(', ')}`);
          }
        }

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

    // P1-3: Plan validation gate — runs after plan agent writes output,
    // before receipt is created. Blocks backend/frontend from becoming eligible
    // if score > 9. Injects granular sub-tasks into state on success.
    if (agentRole === 'plan') {
      const planResult = await this.runPlanValidation(taskId, subTaskId, response.content);
      if (!planResult.ok) {
        return { success: false, failureClass: 'scope_overload', errorMessage: planResult.error };
      }
    }

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

    // Store the hash of the actual output file (not the input context hash) so
    // --resume can detect if the output was modified between runs.
    const outputFileHash = receiptResult.ok
      ? (Object.values(receiptResult.value.output_hashes)[0] ?? ctx.value.contextHash)
      : ctx.value.contextHash;

    // Update state: completed
    await this.stateStore.updateSubTask(subTaskId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      output_hash: outputFileHash,
      output_dir: taskDir,
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

  // ── P1-3: Plan validation ──────────────────────────────────────────────────

  private async runPlanValidation(
    taskId: string,
    planSubTaskId: string,
    planContent: string,
  ): Promise<ServiceResult<void>> {
    // Parse
    const parseResult = this.planValidator.parseFromContent(planContent);
    if (!parseResult.ok) {
      await this.decisionLog.append({
        task_id: taskId,
        sub_task: planSubTaskId,
        event: 'plan_validation_fail',
        class: 'infrastructure',
        detail: `Parse error: ${parseResult.error.slice(0, 300)}`,
      });
      await this.stateStore.updateSubTask(planSubTaskId, {
        status: 'failed',
        last_failure_class: 'infrastructure',
      });
      return { ok: false, error: parseResult.error, code: parseResult.code };
    }

    // Validate score + dep graph
    const validateResult = this.planValidator.validate(parseResult.value);
    if (!validateResult.ok) {
      await this.decisionLog.append({
        task_id: taskId,
        sub_task: planSubTaskId,
        event: 'plan_validation_fail',
        class: 'scope_overload',
        detail: validateResult.error.slice(0, 500),
      });
      await this.stateStore.updateSubTask(planSubTaskId, {
        status: 'failed',
        last_failure_class: 'scope_overload',
      });
      console.error(`\n✗ Plan rejected — complexity overload:\n${validateResult.error}`);
      return { ok: false, error: validateResult.error, code: validateResult.code };
    }

    const { score, scoreMismatch, agentStatedTotal, injectedSubTasks, reviewerDepsUpdate } =
      validateResult.value;

    // Warn if the plan agent's stated total didn't match our recompute
    if (scoreMismatch) {
      console.warn(
        `  ⚠ Plan score mismatch: agent stated ${agentStatedTotal}, computed ${score.weighted_total}. ` +
        `Enforcing computed value.`,
      );
    }

    await this.decisionLog.append({
      task_id: taskId,
      sub_task: planSubTaskId,
      event: 'plan_validation_pass',
      detail: `score=${score.weighted_total} tier=${score.tier} sub_tasks=${injectedSubTasks.length} score_mismatch=${scoreMismatch}`,
    });

    console.log(
      `  ✓ Plan validated — score=${score.weighted_total} (Tier ${score.tier}), ` +
      `${injectedSubTasks.length} implementation sub-tasks`,
    );

    // Inject granular sub-tasks only if the plan defined any
    if (injectedSubTasks.length > 0) {
      const injectResult = await this.injectPlanSubTasks(
        taskId,
        injectedSubTasks,
        reviewerDepsUpdate,
      );
      if (!injectResult.ok) return injectResult;
    }

    // Store the computed score in the top-level task state so preflight can reference it
    const stateResult = await this.stateStore.read();
    if (stateResult.ok) {
      stateResult.value.complexity_score = score;
      await this.stateStore.write(stateResult.value);
    }

    return { ok: true, value: undefined };
  }

  private async injectPlanSubTasks(
    taskId: string,
    injectedSubTasks: Array<[string, SubTaskEntry]>,
    reviewerDepsUpdate: string[],
  ): Promise<ServiceResult<void>> {
    const stateResult = await this.stateStore.read();
    if (!stateResult.ok) return stateResult;

    const state = stateResult.value;

    // Remove the generic placeholder sub-tasks
    const toRemove = ['backend', 'frontend', 'test-writer'] as const;
    for (const id of toRemove) {
      delete state.sub_tasks[id];
    }

    // Add every plan-defined sub-task
    for (const [id, entry] of injectedSubTasks) {
      // Guard: never overwrite fixed pipeline stages
      if ((FIXED_PIPELINE_IDS as readonly string[]).includes(id)) continue;
      state.sub_tasks[id] = entry;
    }

    // Update reviewer.depends_on to point at the plan's leaf test sub-tasks
    if ('reviewer' in state.sub_tasks) {
      state.sub_tasks['reviewer'] = {
        ...state.sub_tasks['reviewer'],
        depends_on: reviewerDepsUpdate,
      };
    }

    const writeResult = await this.stateStore.write(state);
    if (!writeResult.ok) return writeResult;

    await this.decisionLog.append({
      task_id: taskId,
      event: 'plan_subtasks_injected',
      detail: `injected=${injectedSubTasks.map(([id]) => id).join(',')} reviewer_deps=${reviewerDepsUpdate.join(',')}`,
    });

    return { ok: true, value: undefined };
  }

  // ── Failure handling ───────────────────────────────────────────────────────

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
