import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  TaskState,
  SubTaskEntry,
  FailureClass,
  ConductOptions,
  ConductSummary,
  ServiceResult,
  AgentRole,
  FactoryConfig,
  BuildReceipt,
} from '../types/index';
import { StateStore } from '../state/StateStore';
import { SqliteStore } from '../state/SqliteStore';
import { DecisionLog } from '../decisions/DecisionLog';
import { FailureClassifier } from '../classifiers/FailureClassifier';
import { PreflightCheck } from '../preflight/PreflightCheck';
import { LLMProvider } from '../providers/LLMProvider';
import { AnthropicProvider } from '../providers/AnthropicProvider';
import { AnthropicSdkProvider } from '../providers/AnthropicSdkProvider';
import { OllamaProvider } from '../providers/OllamaProvider';
import { BuildReceiptStore } from '../receipts/BuildReceipt';
import { GatePoller } from '../gates/GatePoller';
import { GateRegistry } from '../gates/GateRegistry';
import { RateLimiter } from '../queue/RateLimiter';
import { TaskQueue } from '../queue/TaskQueue';
import { ContextAssembler, TemplateVars } from '../context/ContextAssembler';
import { ContextPruner } from '../context/ContextPruner';
import { BundleAssembler } from '../bundle/BundleAssembler';
import { PlanValidator } from '../plan/PlanValidator';
import { FIXED_PIPELINE_IDS } from '../plan/PlanOutput';
import { DebuggerGuard } from './DebuggerGuard';
import { EvidenceCache, parseBlastRadius } from '../evidence/EvidenceCache';
import { OpenAIProvider } from '../providers/OpenAIProvider';
import { GeminiProvider } from '../providers/GeminiProvider';
import { WebhookNotifier } from '../notifications/WebhookNotifier';
import { TelegramNotifier } from '../notifications/TelegramNotifier';
import { GitAutoCommit } from '../git/GitAutoCommit';
import { WorktreeManager } from '../git/WorktreeManager';
import { TriageRunner } from '../triage/TriageRunner';
import { IronFunnel } from './IronFunnel';
import { ContractValidator } from '../contracts/ContractValidator';
import { OrchestratorDispatcher } from '../orchestrator/OrchestratorDispatcher';
import { WebhookReceiver } from '../webhooks/WebhookReceiver';
import { CiResultHandler } from '../webhooks/CiResultHandler';
import { PrCommentHandler } from '../webhooks/PrCommentHandler';
import { OrchestratorHttpApi } from '../api/OrchestratorHttpApi';

const CONFIG_FILE = 'arbiter.config.json';
const FALLBACK_CONFIG_FILE = 'factory-config.json';

interface SubTaskRunResult {
  success: boolean;
  receiptId?: string;
  failureClass?: FailureClass;
  errorMessage?: string;
}

export class Conductor {
  private stateStore: StateStore;
  readonly sqliteStore: SqliteStore;
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
  private planValidator = new PlanValidator();
  private readonly debuggerGuard = new DebuggerGuard();
  private readonly evidenceCache: EvidenceCache;
  private provider: LLMProvider;
  private config: FactoryConfig | null = null;
  private readonly options: ConductOptions;
  private notifier: WebhookNotifier | undefined;
  private gitAutoCommit: GitAutoCommit | undefined;
  readonly worktreeManager: WorktreeManager;
  private readonly telegram = new TelegramNotifier();
  private orchestratorApi: OrchestratorHttpApi | undefined;

  constructor(options: ConductOptions) {
    this.options = options;
    const root = options.workspaceRoot;
    this.stateStore = new StateStore(root);
    this.sqliteStore = new SqliteStore(root);
    this.decisionLog = new DecisionLog(root);
    this.preflight = new PreflightCheck();
    this.receipts = new BuildReceiptStore(root);
    this.gatePoller = new GatePoller(root, this.decisionLog);
    this.rateLimiter = new RateLimiter(root);
    this.contextAssembler = new ContextAssembler(root);
    this.bundleAssembler = new BundleAssembler(root);
    this.evidenceCache = new EvidenceCache(root);
    this.provider = (options.provider as LLMProvider | undefined) ?? new AnthropicProvider();
    const autoCommitConfig = { enabled: true };
    this.gitAutoCommit = new GitAutoCommit(root, autoCommitConfig);
    this.worktreeManager = new WorktreeManager(root, this.gitAutoCommit);
  }

  async conduct(taskId: string): Promise<ServiceResult<ConductSummary>> {
    // Reinitialise with per-task state path so concurrent conductors don't share state.
    this.stateStore = new StateStore(this.options.workspaceRoot, taskId);
    const startMs = Date.now();
    const configResult = await this.loadConfig();
    if (!configResult.ok) return configResult;

    await this.receipts.ensureSigningKey();

    // Start webhook receiver if --webhooks flag is set
    if (this.options.webhooks && this.config) {
      await this.startWebhookReceiver(taskId);
    }

    const stateResult = await this.stateStore.read();
    if (!stateResult.ok) {
      if (stateResult.code === 'ENOENT') {
        return { ok: false, error: `No state found for task ${taskId}. Run 'arbiter task init' first.` };
      }
      return stateResult;
    }

    let state = stateResult.value;

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
          error: `Task ${taskId} has existing progress. Use --resume to continue, or delete arbiter/state.json to restart.`,
          code: 'USE_RESUME',
        };
      }
    }

    await this.decisionLog.append({
      task_id: taskId,
      event: this.options.resume ? 'pipeline_resume' : 'pipeline_start',
      detail: `maxParallel=${this.options.maxParallel} shadow=${this.options.shadow}`,
    });

    // ── Triage: classify task tier before dispatching any agent ──────────────
    let taskTier: 1 | 2 | 3 = 3;

    if (!this.options.resume) {
      const taskMdPath = path.join(this.options.workspaceRoot, 'arbiter', 'tasks', taskId, 'task.md');
      const triage = new TriageRunner(this.options.workspaceRoot, this.provider);
      const triageResult = await triage.run(taskId, taskMdPath);
      taskTier = (triageResult.ok ? triageResult.value.tier : 3) as 1 | 2 | 3;
      const profile = triageResult.ok ? triageResult.value.profile : 'unknown';

      this.sqliteStore.upsertTask({
        task_id: taskId,
        tier: taskTier,
        pipeline: taskTier === 1 ? 'speed' : taskTier === 2 ? 'speed' : 'full',
        profile,
        status: 'building',
      });
      await this.refreshBoard(); // task now visible on the board with its tier
      this.sqliteStore.appendEvent(taskId, 'triage_complete', {
        tier: taskTier,
        profile,
        reason: triageResult.ok ? triageResult.value.reason : 'fallback',
      });

      await this.decisionLog.append({
        task_id: taskId,
        event: 'triage_complete',
        detail: `tier=${taskTier} profile=${profile}`,
      });

      // Tier 2: run Investigator before the main loop
      if (taskTier === 2) {
        await this.runInvestigator(taskId);
      }
    }

    const loopResult = await this.runLoop(state);
    if (!loopResult.ok) return loopResult;

    // ── Iron Funnel: 5-gate quality check (Tier 2 and Tier 3) ────────────────
    if (taskTier >= 2 && this.config) {
      // Isolate agent code writes in a per-task git worktree. When git is
      // unavailable (e.g. test sandboxes) we fall back to the workspace root so
      // the pipeline still runs — just without isolation or an auto-PR.
      const branchName = `arbiter/${taskId}`;
      const wt = await this.worktreeManager.create(taskId, branchName);
      const isolated = wt.ok;
      const worktreePath = wt.ok ? wt.value : this.options.workspaceRoot;
      if (isolated) {
        this.sqliteStore.appendEvent(taskId, 'worktree_created', { path: worktreePath, branch: branchName });
      }

      try {
        const funnel = new IronFunnel(this.sqliteStore, this.provider, this.config, worktreePath, this.telegram);
        const funnelResult = await funnel.run(taskId, worktreePath, { tier: taskTier });

        await this.decisionLog.append({
          task_id: taskId,
          event: 'iron_funnel_complete',
          detail: `passed=${funnelResult.passed} gates=${funnelResult.gates.length} retries=${funnelResult.retryCount} failureGate=${funnelResult.failureGate ?? 'none'}`,
        });

        if (!funnelResult.passed) {
          this.sqliteStore.upsertTask({ task_id: taskId, status: 'failed' });
          void this.telegram.send(`❌ *${taskId}* failed at Iron Funnel gate ${funnelResult.failureGate}.`, 'owner');
          return {
            ok: false,
            error: `Iron Funnel failed at gate ${funnelResult.failureGate}. See DecisionLog for details.`,
            code: 'IRON_FUNNEL_FAILED',
          };
        }

        // Gate 5 approved → push the worktree branch and open a PR (if isolated).
        if (isolated) {
          const pr = await this.worktreeManager.merge(taskId, branchName);
          if (pr.ok) {
            this.sqliteStore.appendEvent(taskId, 'pr_opened', { url: pr.value, branch: branchName });
            await this.decisionLog.append({ task_id: taskId, event: 'pr_opened', detail: pr.value.slice(0, 300) });
            void this.telegram.send(`✅ *${taskId}* passed all gates. PR opened:\n${pr.value}`, 'owner');
          } else {
            this.sqliteStore.appendEvent(taskId, 'pr_open_failed', { error: pr.error, branch: branchName });
            await this.decisionLog.append({ task_id: taskId, event: 'pr_open_failed', detail: pr.error.slice(0, 300) });
          }
        }
      } finally {
        // Clean up the worktree whether the funnel passed or failed; the branch
        // (and any opened PR) persists on the remote.
        if (isolated) {
          await this.worktreeManager.delete(taskId).catch(() => { /* best-effort cleanup */ });
        }
      }
    }

    // ── Orchestrator: task_complete notification ──────────────────────────────
    if (this.config) {
      const orchestratorModel = this.config.roles?.['orchestrator']?.model ?? 'claude-opus-4-7';
      const orchestrator = new OrchestratorDispatcher(
        this.sqliteStore,
        this.provider,
        this.options.workspaceRoot,
        orchestratorModel,
      );
      await orchestrator.wake(taskId, 'task_complete', { taskId }).catch(() => {
        // Non-fatal — orchestrator lessons capture is best-effort
      });
    }

    const elapsedMs = Date.now() - startMs;
    const totalCostUsd = await this.rateLimiter.getTodayTotal();
    const finalState = await this.stateStore.read();
    const subTasksCompleted = finalState.ok
      ? Object.values(finalState.value.sub_tasks).filter(e => e.status === 'completed').length
      : 0;

    // A2: write a per-task completion report into the task folder + drop the bundle there.
    await this.writeCompletionReport(taskId, { elapsedMs, subTasksCompleted, bundlePath: loopResult.value?.bundlePath })
      .catch(() => { /* report is best-effort, never fails the task */ });

    return {
      ok: true,
      value: {
        taskId,
        subTasksCompleted,
        totalCostUsd,
        elapsedMs,
        bundlePath: loopResult.value?.bundlePath,
      },
    };
  }

  /** Re-project arbiter/board.json so the dashboard reflects live progress. Best-effort. */
  private async refreshBoard(): Promise<void> {
    try {
      const { projectBoard } = await import('../board/BoardProjector');
      await projectBoard(this.options.workspaceRoot);
    } catch { /* board projection is best-effort */ }
  }

  /** Write arbiter/tasks/<id>/report.md (duration, tokens, context, cost, PR, bundle) + copy the bundle in. */
  private async writeCompletionReport(
    taskId: string,
    info: { elapsedMs: number; subTasksCompleted: number; bundlePath?: string },
  ): Promise<void> {
    const taskDir = path.join(this.options.workspaceRoot, 'arbiter', 'tasks', taskId);

    // Per-task usage rows from the shared usage log.
    let rows: Array<{ agent_role?: string; model?: string; input_tokens?: number; output_tokens?: number; context_tokens?: number; cost_usd?: number }> = [];
    try {
      const raw = await fs.readFile(path.join(this.options.workspaceRoot, 'arbiter', 'usage.jsonl'), 'utf-8');
      rows = raw.split('\n').filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter((r): r is NonNullable<typeof r> => !!r && r.task_id === taskId);
    } catch { /* no usage */ }

    const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
    const tokens = sum(r => (r.input_tokens ?? 0) + (r.output_tokens ?? 0));
    const ctx = sum(r => r.context_tokens ?? 0);
    const cost = sum(r => r.cost_usd ?? 0);

    // PR url from the pr_opened event, if any.
    let prUrl = '';
    try {
      const ev = this.sqliteStore.getEvents(taskId, 'pr_opened');
      if (ev.length) prUrl = (JSON.parse(ev[ev.length - 1].payload) as { url?: string }).url ?? '';
    } catch { /* none */ }

    const mins = Math.floor(info.elapsedMs / 60000);
    const secs = Math.round((info.elapsedMs % 60000) / 1000);
    const stepTable = rows.map(r =>
      `| ${r.agent_role ?? '—'} | ${(r.model ?? '').replace('claude-', '')} | ${(r.input_tokens ?? 0) + (r.output_tokens ?? 0)} | ${r.context_tokens ?? 0} | $${(r.cost_usd ?? 0).toFixed(4)} |`,
    ).join('\n');

    const report = [
      `# ${taskId} — Completion Report`,
      '',
      `- **Outcome:** completed`,
      `- **Duration:** ${mins}m ${secs}s`,
      `- **Steps completed:** ${info.subTasksCompleted}`,
      `- **Total tokens:** ${tokens.toLocaleString()}`,
      `- **Context tokens:** ${ctx.toLocaleString()}`,
      `- **Cost:** $${cost.toFixed(4)}`,
      `- **Pull request:** ${prUrl || '—'}`,
      `- **Evidence bundle:** ${info.bundlePath ? path.basename(info.bundlePath) : '—'}`,
      '',
      '## Steps',
      '| Step | Model | Tokens | Context | Cost |',
      '|---|---|---|---|---|',
      stepTable || '| _(no recorded steps)_ | | | | |',
      '',
    ].join('\n');

    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, 'report.md'), report, 'utf-8');

    // Drop the evidence bundle alongside the task for one-stop archival.
    if (info.bundlePath) {
      try { await fs.copyFile(info.bundlePath, path.join(taskDir, path.basename(info.bundlePath))); } catch { /* ok */ }
    }
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

  // ── Phase 04: Contract validation for Tier 3 tasks ───────────────────────
  // Validate the Design agent's contract files. On failure, return the exact
  // errors to the Design agent and retry ONCE (M3.1). If they still don't
  // validate, emit `contracts_unresolved` instead of silently locking — the
  // downstream Compiler Airlock would otherwise be the first to notice.
  private async runContractValidation(taskId: string, taskDir: string): Promise<void> {
    const validator = new ContractValidator();
    const MAX_ATTEMPTS = 2; // initial + one retry

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await validator.run(taskDir);

      if (result.passed) {
        this.sqliteStore.upsertTask({ task_id: taskId, status: 'building' });
        this.sqliteStore.appendEvent(taskId, 'contracts_locked', { locked: true, attempt });
        await this.decisionLog.append({
          task_id: taskId,
          event: 'contracts_locked',
          detail: `All contract files validated and locked (attempt ${attempt})`,
        });
        return;
      }

      const errorSummary = result.errors.map(e => `${e.file}: ${e.error}`).join('\n');
      this.sqliteStore.appendEvent(taskId, 'contract_validation_failed', {
        attempt,
        errors: result.errors,
      });
      await this.decisionLog.append({
        task_id: taskId,
        event: 'contract_validation_failed',
        detail: `attempt ${attempt}: ${errorSummary.slice(0, 480)}`,
      });

      if (attempt < MAX_ATTEMPTS) {
        await this.regenerateContractsViaDesign(taskId, taskDir, errorSummary).catch(() => {
          /* re-dispatch is best-effort; the re-validation below is the source of truth */
        });
      }
    }

    // Exhausted the retry — do NOT lock. Flag for the operator + audit trail.
    this.sqliteStore.appendEvent(taskId, 'contracts_unresolved', {
      reason: 'contract validation failed after one retry',
    });
    await this.decisionLog.append({
      task_id: taskId,
      event: 'contracts_unresolved',
      detail: 'Tier 3 contracts did not validate after a Design re-dispatch — not locked',
    });
  }

  /** Re-dispatch the Design agent with the exact contract errors so it can fix the files. */
  private async regenerateContractsViaDesign(taskId: string, taskDir: string, errorSummary: string): Promise<void> {
    if (!this.config) return;
    const designModel = this.config.roles?.['design']?.model ?? 'claude-opus-4-7';
    const rulesPath = path.join(this.options.workspaceRoot, 'agents', 'templates', 'design.md');
    const rules = await fs.readFile(rulesPath, 'utf-8').catch(() => '');
    const existingDesign = await fs.readFile(path.join(taskDir, 'design-output.md'), 'utf-8').catch(() => '');

    const prompt = [
      rules,
      '',
      '## Contract validation FAILED — fix the contract files',
      'Regenerate ONLY the contract files (contracts/api.ts, contracts/events.ts,',
      'contracts/schema.prisma) so they compile and validate. Fix exactly these errors:',
      '',
      errorSummary,
      '',
      '## Current design (for reference)',
      existingDesign.slice(0, 4_000),
    ].join('\n');

    this.sqliteStore.appendEvent(taskId, 'contracts_regenerate_dispatched', {});
    await this.provider.invoke({
      model: designModel,
      assembledPrompt: prompt,
      maxTokens: 4096,
      timeoutMs: 180_000,
      agentRole: 'design',
    });
  }

  // ── Phase 06: Webhook receiver ───────────────────────────────────────────
  private async startWebhookReceiver(taskId: string): Promise<void> {
    const cfg = this.config as (typeof this.config) & {
      webhook_receiver?: { secret?: string; enabled?: boolean };
    };
    const secret = cfg?.webhook_receiver?.secret ?? '';

    const ciHandler = new CiResultHandler(
      this.sqliteStore,
      this.provider,
      this.options.workspaceRoot,
      this.config?.roles?.['orchestrator']?.model ?? 'claude-opus-4-7',
    );
    const prHandler = new PrCommentHandler(
      this.sqliteStore,
      this.provider,
      this.options.workspaceRoot,
      this.config?.roles?.['orchestrator']?.model ?? 'claude-opus-4-7',
    );

    const receiver = new WebhookReceiver(this.sqliteStore, secret, {
      onCiResult: (id, conclusion, prUrl, runUrl) =>
        ciHandler.handle(id || taskId, conclusion, prUrl, runUrl),
      onPrComment: (id, comment, prNumber, author, isReview) =>
        prHandler.handle(id || taskId, comment, prNumber, author, isReview),
    });

    try {
      await receiver.start();
      console.log(`  ✓ Webhook receiver started on port 7475`);
    } catch (err) {
      console.warn(`  ⚠ Webhook receiver failed to start: ${String(err)}`);
    }

    // Orchestrator HTTP API (port 7474) — backs the dashboard chat (user_chat).
    try {
      const dispatcher = new OrchestratorDispatcher(
        this.sqliteStore,
        this.provider,
        this.options.workspaceRoot,
        this.config?.roles?.['orchestrator']?.model ?? 'claude-opus-4-7',
      );
      this.orchestratorApi = new OrchestratorHttpApi(dispatcher);
      await this.orchestratorApi.start();
      console.log(`  ✓ Orchestrator chat API started on port 7474`);
    } catch (err) {
      console.warn(`  ⚠ Orchestrator chat API failed to start: ${String(err)}`);
    }
  }

  // ── Tier 2: Investigator dispatch ──────────────────────────────────────────
  private async runInvestigator(taskId: string): Promise<void> {
    if (!this.config) return;

    const taskMdPath = path.join(this.options.workspaceRoot, 'arbiter', 'tasks', taskId, 'task.md');
    const rulesPath = path.join(this.options.workspaceRoot, 'agents', 'investigator', 'rules.md');

    let taskContent = '';
    let rulesContent = '';
    try {
      taskContent = await fs.readFile(taskMdPath, 'utf-8');
    } catch { /* task.md may not exist — safe fallback */ }
    try {
      rulesContent = await fs.readFile(rulesPath, 'utf-8');
    } catch { /* rules.md may not exist yet — safe fallback */ }

    // M5.3: feed the Investigator a madge dependency trace so it can locate the
    // root-cause files. Empty when madge isn't installed — degrade to task.md only.
    const depTrace = await this.contextAssembler.dependencyTrace(['src']);

    const prompt = [
      rulesContent,
      '',
      '## Task',
      taskContent,
      ...(depTrace
        ? ['', '## Dependency Trace (madge)', '```', depTrace, '```']
        : []),
    ].join('\n');

    const investigatorModel = this.config.roles?.['investigator']?.model ?? 'claude-sonnet-4-6';

    const result = await this.provider.invoke({
      model: investigatorModel,
      assembledPrompt: prompt,
      maxTokens: 2048,
      timeoutMs: 120_000,
      agentRole: 'investigator',
    });

    const outputDir = path.join(this.options.workspaceRoot, 'arbiter', 'tasks', taskId);
    const fixStrategyPath = path.join(outputDir, 'fix-strategy.md');

    if (result.ok && result.value.exitCode === 0) {
      try {
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(fixStrategyPath, result.value.content, 'utf-8');
      } catch { /* Non-fatal */ }
    }

    this.sqliteStore.appendEvent(taskId, 'investigator_complete', {
      success: result.ok,
      fixStrategyWritten: result.ok,
    });

    // Check if contract mutation required → re-classify to Tier 3 (logged only; loop handles full pipeline)
    if (result.ok) {
      const contractMutationMatch = result.value.content.match(/Contract Mutation Required\s*\n+\s*(yes)/i);
      if (contractMutationMatch) {
        this.sqliteStore.upsertTask({ task_id: taskId, tier: 3, pipeline: 'full' });
        await this.decisionLog.append({
          task_id: taskId,
          event: 'tier_reclassified',
          detail: 'Investigator detected contract mutation required — reclassified to Tier 3',
        });
      }
    }
  }

  private async runLoop(state: TaskState): Promise<ServiceResult<{ bundlePath?: string }>> {
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
        console.log(`\n✓ Task ${taskId} complete. Assembling audit evidence bundle...`);

        let bundlePath: string | undefined;
        const bundleResult = await this.bundleAssembler.assemble(taskId, state);
        if (!bundleResult.ok) {
          console.warn(`  ⚠ Bundle assembly failed: ${bundleResult.error}`);
          console.warn(`    Run 'arbiter bundle create ${taskId}' to retry.`);
        } else {
          const { zipPath, bundleId, presentArtifacts, missingArtifacts } = bundleResult.value;
          bundlePath = zipPath;
          console.log(`  ✓ Bundle: ${zipPath}`);
          console.log(`    ID: ${bundleId}`);
          console.log(`    ALC artifacts: ${presentArtifacts.length} present`);
          if (missingArtifacts.length > 0) {
            console.warn(`    Missing: ${missingArtifacts.join(', ')}`);
          }
        }

        if (this.notifier) {
          void this.notifier.notify('task_complete', { task_id: taskId });
        }
        return { ok: true, value: { bundlePath } };
      }

      if (TaskQueue.hasFailed(state)) {
        await this.decisionLog.append({ task_id: taskId, event: 'pipeline_halted', detail: 'Sub-task in failed state' });
        console.error(`\n✗ Task ${taskId} halted — a sub-task failed. Review decision log.`);
        if (this.notifier) {
          void this.notifier.notify('task_failed', { task_id: taskId });
        }
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

        if (this.options.autoApproveGates) {
          // Test-only path: resolve gate immediately without human input
          await this.gatePoller.resolve(gate.gate_id, 'approved', 'auto-approved (test mode)');
          continue;
        }

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
      await this.refreshBoard(); // keep board.json live as agents complete
    }

    return { ok: true, value: {} };
  }

  private async runSubTask(
    taskId: string,
    subTaskId: string,
    entry: SubTaskEntry,
    state: TaskState,
  ): Promise<SubTaskRunResult> {
    const agentRole = entry.agent_role;
    const model = this.resolveModel(agentRole);
    const taskDir = path.join(this.options.workspaceRoot, 'arbiter', 'tasks', taskId);

    // Mark in_progress
    await this.stateStore.updateSubTask(subTaskId, { status: 'in_progress', model });
    await this.decisionLog.logAgentStart(taskId, subTaskId, agentRole, model);

    // Assemble context
    const ctxResult = await this.contextAssembler.assemble(agentRole, taskDir, '', '', undefined, this.buildTemplateVars());
    if (!ctxResult.ok) {
      await this.handleInfraFailure(taskId, subTaskId, `Context assembly failed: ${ctxResult.error}`);
      return { success: false, failureClass: 'infrastructure', errorMessage: ctxResult.error };
    }

    const ctx = this.contextPruner.prune(ctxResult.value);
    if (!ctx.ok) return { success: false, failureClass: 'infrastructure' };

    // Preflight — includes verdict routing (spawn/reject/split/halt)
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
      const { verdict } = preflightResult.value;
      const failures = this.preflight.formatFailures(preflightResult.value);
      await this.decisionLog.logPreflightReject(taskId, subTaskId, `preflight_${verdict}`, failures);
      await this.stateStore.updateSubTask(subTaskId, {
        status: verdict === 'halt' ? 'failed' : 'pending',
        last_failure_class: verdict === 'split' ? 'scope_overload' : 'infrastructure',
      });
      console.error(`  ✗ ${subTaskId} preflight [${verdict}]: ${failures}`);
      return {
        success: false,
        failureClass: verdict === 'split' ? 'scope_overload' : 'infrastructure',
        errorMessage: failures,
      };
    }

    // Invoke provider
    const llmResult = await this.provider.invoke({
      model,
      assembledPrompt: ctx.value.prompt,
      maxTokens: 8192,
      timeoutMs: 300_000,
      agentRole,
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

    // P1-3: Plan validation gate
    if (agentRole === 'plan') {
      const planResult = await this.runPlanValidation(taskId, subTaskId, response.content);
      if (!planResult.ok) {
        return { success: false, failureClass: 'scope_overload', errorMessage: planResult.error };
      }
    }

    // P1-7: After research completes, check blast-radius evidence cache.
    // If all conditions met, fast-forward design + design-critic with cached artifacts.
    if (agentRole === 'research') {
      await this.runBlastRadiusCacheCheck(taskId, taskDir, response.content);
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

    if (this.gitAutoCommit) {
      const commitResult = await this.gitAutoCommit.commit(taskId, subTaskId, agentRole);
      if (!commitResult.ok) {
        console.warn(`  ⚠ Git auto-commit failed for ${subTaskId}: ${commitResult.error}`);
      }
    }

    // P1-7: After design-critic completes, write this run's design to the evidence cache.
    if (agentRole === 'design-critic' && receiptId) {
      await this.storeDesignToCache(taskId, taskDir, receiptId);

      // Phase 04: For Tier 3 tasks, validate contract files generated by Design agent
      const taskRow = this.sqliteStore.getTask(taskId);
      if (taskRow?.tier === 3 && this.config) {
        await this.runContractValidation(taskId, taskDir);
      }
    }

    // Check if a gate should fire after this agent
    const gateSpec = this.gateRegistry.getGateAfterAgent(agentRole);
    if (gateSpec && this.isGateEnabled(gateSpec.type)) {
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

    if (injectedSubTasks.length > 0) {
      const injectResult = await this.injectPlanSubTasks(
        taskId,
        injectedSubTasks,
        reviewerDepsUpdate,
      );
      if (!injectResult.ok) return injectResult;
    }

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

    const toRemove = ['backend', 'frontend', 'test-writer'] as const;
    for (const id of toRemove) {
      delete state.sub_tasks[id];
    }

    for (const [id, entry] of injectedSubTasks) {
      if ((FIXED_PIPELINE_IDS as readonly string[]).includes(id)) continue;
      state.sub_tasks[id] = entry;
    }

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

  // ── P1-7: Evidence cache — blast-radius-based design phase skip ────────────

  private async runBlastRadiusCacheCheck(
    taskId: string,
    taskDir: string,
    researchContent: string,
  ): Promise<void> {
    const blastRadius = parseBlastRadius(researchContent);
    if (!blastRadius) {
      await this.decisionLog.append({
        task_id: taskId,
        event: 'blast_radius_parse_fail',
        detail: 'No blast_radius block in research output — design phase will run normally',
      });
      return;
    }

    const cacheCheck = await this.evidenceCache.shouldSkipDesignPhase(blastRadius);

    await this.decisionLog.append({
      task_id: taskId,
      event: cacheCheck.skip ? 'design_phase_cache_hit' : 'design_phase_cache_miss',
      detail: cacheCheck.reason,
    });

    if (!cacheCheck.skip || !cacheCheck.cached) return;

    const cached = cacheCheck.cached;
    console.log(`  ✓ Design phase cache hit (${cacheCheck.reason}) — skipping design + design-critic`);

    // Copy cached artifacts into this run's task dir
    const destDesign = path.join(taskDir, 'design-output.md');
    const destCritic = path.join(taskDir, 'design-critic-output.md');

    try {
      await fs.copyFile(cached.designPath, destDesign);
      await fs.copyFile(cached.criticPath, destCritic);
    } catch (err) {
      // If copy fails, let design run normally — don't halt for a cache miss
      await this.decisionLog.append({
        task_id: taskId,
        event: 'design_phase_cache_copy_fail',
        detail: String(err),
      });
      return;
    }

    // Compute hashes of the copied files for --resume verification
    const [designHash, criticHash] = await Promise.all([
      hashFile(destDesign),
      hashFile(destCritic),
    ]);

    // Mark design and design-critic as completed via cache, referencing the
    // source receipt so --resume verification can validate the signature chain.
    const now = new Date().toISOString();
    await Promise.all([
      this.stateStore.updateSubTask('design', {
        status: 'completed',
        completed_at: now,
        output_hash: designHash,
        output_dir: taskDir,
        receipt_id: cached.receiptId,
      }),
      this.stateStore.updateSubTask('design-critic', {
        status: 'completed',
        completed_at: now,
        output_hash: criticHash,
        output_dir: taskDir,
        receipt_id: cached.receiptId,
      }),
    ]);

    await this.decisionLog.append({
      task_id: taskId,
      event: 'design_phase_skipped',
      detail: `source_receipt=${cached.receiptId} approved_at=${cached.approvedAt}`,
    });
  }

  private async storeDesignToCache(
    taskId: string,
    taskDir: string,
    designCriticReceiptId: string,
  ): Promise<void> {
    // Read research output to get the blast-radius that triggered this design run
    const researchOutputPath = path.join(taskDir, 'research-output.md');
    let researchContent = '';
    try {
      researchContent = await fs.readFile(researchOutputPath, 'utf-8');
    } catch {
      return; // No research output — can't key the cache
    }

    const blastRadius = parseBlastRadius(researchContent);
    if (!blastRadius || blastRadius.architectural_boundary_crossed) {
      // Only cache when the design crossed no boundary — boundary-crossing runs
      // become the new cache entry for their modules.
    }
    if (!blastRadius) return;

    const designPath = path.join(taskDir, 'design-output.md');
    const criticPath = path.join(taskDir, 'design-critic-output.md');

    const storeResult = await this.evidenceCache.store(
      blastRadius,
      designPath,
      criticPath,
      designCriticReceiptId,
    );

    if (!storeResult.ok) {
      console.warn(`  ⚠ Evidence cache write failed: ${storeResult.error}`);
      return;
    }

    await this.decisionLog.append({
      task_id: taskId,
      event: 'design_phase_cached',
      detail: `modules=${blastRadius.modules_touched.join(',')} receipt=${designCriticReceiptId}`,
    });
  }

  // ── P1-5: Debugger escalation (four pipeline constraints) ───────────────────

  private async runDebuggerAgent(
    taskId: string,
    subTaskId: string,
    entry: SubTaskEntry,
    originalOutputFile: string,
  ): Promise<SubTaskRunResult> {
    const taskDir = path.join(this.options.workspaceRoot, 'arbiter', 'tasks', taskId);
    const debuggerModel = this.resolveModel('debugger');

    await this.decisionLog.append({
      task_id: taskId,
      sub_task: subTaskId,
      event: 'debugger_invoked',
      detail: `original_output=${originalOutputFile} model=${debuggerModel}`,
    });
    console.log(`  ↻ ${subTaskId} — escalating to debugger (${debuggerModel})`);

    // Read the original (failed) output for diffing
    let originalContent = '';
    try {
      originalContent = await fs.readFile(originalOutputFile, 'utf-8');
    } catch {
      originalContent = ''; // File may not exist if agent produced no output
    }

    // Assemble debugger-specific context (includes original output + failure context)
    const ctxResult = await this.contextAssembler.assemble('debugger', taskDir, '', '', undefined, this.buildTemplateVars());
    if (!ctxResult.ok) {
      await this.handleInfraFailure(taskId, subTaskId, `Debugger context assembly failed: ${ctxResult.error}`);
      return { success: false, failureClass: 'infrastructure', errorMessage: ctxResult.error };
    }
    const ctx = this.contextPruner.prune(ctxResult.value);
    if (!ctx.ok) return { success: false, failureClass: 'infrastructure' };

    // Invoke debugger
    const llmResult = await this.provider.invoke({
      model: debuggerModel,
      assembledPrompt: ctx.value.prompt,
      maxTokens: 8192,
      timeoutMs: 300_000,
      agentRole: 'debugger',
    });

    if (!llmResult.ok) {
      await this.stateStore.updateSubTask(subTaskId, { status: 'failed', last_failure_class: 'stochastic' });
      return { success: false, failureClass: 'stochastic', errorMessage: llmResult.error };
    }

    const debuggerContent = llmResult.value.content;

    // Constraint 1: validate debugger output passes same P-CRYPTO rule
    const contentCheck = this.debuggerGuard.validateContent(debuggerContent);
    if (!contentCheck.ok) {
      await this.decisionLog.append({
        task_id: taskId,
        sub_task: subTaskId,
        event: 'debugger_constraint1_fail',
        detail: contentCheck.error ?? 'P-CRYPTO violation in debugger output',
      });
      await this.stateStore.updateSubTask(subTaskId, { status: 'failed', last_failure_class: 'infrastructure' });
      console.error(`  ✗ ${subTaskId} — debugger output fails P-CRYPTO rule`);
      return { success: false, failureClass: 'infrastructure', errorMessage: contentCheck.error };
    }

    // Constraints 3+4: evaluate diff and check for new abstractions
    const guardResult = this.debuggerGuard.evaluate(originalContent, debuggerContent);

    // Constraint 2: log diff metrics for receipt (always, even if blocked)
    await this.decisionLog.append({
      task_id: taskId,
      sub_task: subTaskId,
      event: 'debugger_diff',
      detail: `diff_pct=${guardResult.diff.diffPct} diff_hash=${guardResult.diff.diffHash} lines_added=${guardResult.diff.linesAdded} lines_removed=${guardResult.diff.linesRemoved}`,
    });

    // Constraint 4: no new public abstractions
    if (!guardResult.allowed) {
      await this.decisionLog.append({
        task_id: taskId,
        sub_task: subTaskId,
        event: 'debugger_constraint4_fail',
        detail: `new_abstractions=${guardResult.newAbstractions?.join(', ')}`,
      });
      await this.stateStore.updateSubTask(subTaskId, { status: 'failed', last_failure_class: 'infrastructure' });
      console.error(`  ✗ ${subTaskId} — debugger introduced new public abstractions (HALT)`);
      return {
        success: false,
        failureClass: 'infrastructure',
        errorMessage: `Debugger introduced new public abstractions: ${guardResult.newAbstractions?.join(', ')}`,
      };
    }

    // Write debugger output
    const debuggerOutputFile = path.join(taskDir, `${subTaskId}-output.md`);
    await fs.writeFile(debuggerOutputFile, debuggerContent, 'utf-8');

    // Constraint 3: >20% rewrite → 4th human gate before proceeding
    if (guardResult.gateRequired) {
      const gateCreated = await this.gatePoller.createGate(
        taskId,
        'debugger_major_rewrite',
        `Debugger rewrote ${guardResult.diff.diffPct}% of [${subTaskId}] output. ` +
        `diff_hash=${guardResult.diff.diffHash}. Review before proceeding.`,
        subTaskId,
      );
      if (!gateCreated.ok) {
        await this.stateStore.updateSubTask(subTaskId, { status: 'failed' });
        return { success: false, failureClass: 'infrastructure', errorMessage: gateCreated.error };
      }
      const gateId = gateCreated.value.gate_id;
      await this.decisionLog.append({
        task_id: taskId,
        sub_task: subTaskId,
        event: 'debugger_constraint3_gate',
        detail: `gate_id=${gateId} diff_pct=${guardResult.diff.diffPct}`,
      });
      console.log(`  ⚠ ${subTaskId} — debugger rewrote ${guardResult.diff.diffPct}% — gate required: ${gateId}`);
      const waitResult = await this.gatePoller.waitForApproval(gateId);
      if (!waitResult.ok || waitResult.value === 'rejected') {
        await this.stateStore.updateSubTask(subTaskId, { status: 'failed' });
        return { success: false, failureClass: 'infrastructure', errorMessage: 'Debugger major-rewrite gate rejected' };
      }
    }

    // Create receipt with debugger diff metadata
    const receiptResult = await this.receipts.create({
      taskId,
      subTask: subTaskId,
      agentRole: entry.agent_role,
      model: debuggerModel,
      contextHash: ctx.value.contextHash,
      outputFiles: [debuggerOutputFile],
      inputTokens: llmResult.value.inputTokens,
      outputTokens: llmResult.value.outputTokens,
      costUsd: this.provider.estimateCost(debuggerModel, llmResult.value.inputTokens, llmResult.value.outputTokens),
      failureClass: null,
      strikeCount: entry.strike ?? 0,
      debuggerInvoked: true,
      debuggerDiffHash: guardResult.diff.diffHash,
      debuggerDiffPct: guardResult.diff.diffPct,
    });

    const receiptId = receiptResult.ok ? receiptResult.value.receipt_id : undefined;
    const outputHash = receiptResult.ok
      ? (Object.values(receiptResult.value.output_hashes)[0] ?? ctx.value.contextHash)
      : ctx.value.contextHash;

    await this.stateStore.updateSubTask(subTaskId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      output_hash: outputHash,
      output_dir: taskDir,
      receipt_id: receiptId,
    });

    await this.decisionLog.logAgentComplete(taskId, subTaskId, entry.agent_role, receiptId ?? 'none');
    console.log(`  ✓ ${subTaskId} — debugger repaired (${guardResult.diff.diffPct}% changed)`);
    return { success: true, receiptId };
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

    if (shouldEscalateToDebugger) {
      // P1-5: actual debugger escalation with four pipeline constraints
      await this.stateStore.updateSubTask(subTaskId, { strike: newStrike, last_failure_class: fc });
      const taskDir = path.join(this.options.workspaceRoot, 'arbiter', 'tasks', taskId);
      const originalOutputFile = path.join(taskDir, `${subTaskId}-output.md`);
      return this.runDebuggerAgent(taskId, subTaskId, entry, originalOutputFile);
    }

    if (shouldRejectToFailed) {
      await this.stateStore.updateSubTask(subTaskId, {
        status: 'failed',
        strike: newStrike,
        last_failure_class: fc,
      });
    } else if (shouldRetry) {
      await this.stateStore.updateSubTask(subTaskId, {
        status: 'pending',
        strike: newStrike,
        last_failure_class: fc,
      });
    } else if (fc === 'infrastructure') {
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

        // Apply complexity cap from config
        if (this.config.complexity_cap !== undefined) {
          this.planValidator = new PlanValidator(this.config.complexity_cap);
        }

        // Only configure provider from config if none was injected
        if (!this.options.provider) {
          const [providerName, providerConfig] = Object.entries(this.config.providers)[0] ?? [];
          if (providerName === 'anthropic_sdk') {
            const apiKey = providerConfig?.api_key
              ?? (providerConfig?.api_key_env ? process.env[providerConfig.api_key_env as string] : undefined)
              ?? process.env.ANTHROPIC_API_KEY;
            this.provider = new AnthropicSdkProvider({ apiKey });
          } else if (providerName === 'openai') {
            const apiKey = providerConfig?.api_key
              ?? (providerConfig?.api_key_env ? process.env[providerConfig.api_key_env as string] : undefined)
              ?? process.env.OPENAI_API_KEY;
            this.provider = new OpenAIProvider({ apiKey, baseUrl: providerConfig?.base_url });
          } else if (providerName === 'gemini') {
            const apiKey = providerConfig?.api_key
              ?? (providerConfig?.api_key_env ? process.env[providerConfig.api_key_env as string] : undefined)
              ?? process.env.GEMINI_API_KEY;
            this.provider = new GeminiProvider({ apiKey, baseUrl: providerConfig?.base_url });
          } else if (providerName === 'ollama') {
            this.provider = new OllamaProvider({ baseUrl: providerConfig?.base_url });
          } else if (providerConfig?.cmd) {
            this.provider = new AnthropicProvider({
              cmd: providerConfig.cmd,
              headlessFlag: providerConfig.headless_flag ?? '-p',
            });
          }
        }

        // Wire webhook notifier
        if (this.config.notifications?.webhook_url) {
          this.notifier = new WebhookNotifier(this.config.notifications);
          this.gatePoller.setNotifier(this.notifier);
        }

        // Wire git auto-commit
        if (this.config.git_auto_commit?.enabled) {
          this.gitAutoCommit = new GitAutoCommit(this.options.workspaceRoot, this.config.git_auto_commit);
        }

        return { ok: true, value: undefined };
      } catch {
        continue;
      }
    }

    // If a provider was injected (e.g. MockProvider in tests), config is optional
    if (this.options.provider) {
      return { ok: true, value: undefined };
    }

    return {
      ok: false,
      error: `Config not found. Create arbiter.config.json in ${this.options.workspaceRoot}`,
      code: 'CONFIG_NOT_FOUND',
    };
  }

  private buildTemplateVars(): TemplateVars | undefined {
    const tv = this.config?.template_vars;
    if (!tv) return undefined;
    return {
      PROJECT_NAME:         tv.PROJECT_NAME,
      STACK_FRONTEND:       tv.STACK_FRONTEND,
      STACK_BACKEND:        tv.STACK_BACKEND,
      STACK_DATABASE:       tv.STACK_DATABASE,
      STACK_TEST_FRAMEWORK: tv.STACK_TEST_FRAMEWORK,
      PROJECT_CONVENTIONS:  tv.PROJECT_CONVENTIONS,
    };
  }

  // Gates default to enabled when not specified (safe default: always ask).
  private isGateEnabled(gateType: import('../gates/GateRegistry').GateType): boolean {
    const gates = this.config?.gates;
    if (!gates) return true;
    if (gateType === 'design_approval') return gates.design;
    if (gateType === 'plan_approval')   return gates.plan;
    if (gateType === 'review_approval') return gates.review;
    return true; // debugger_major_rewrite is always enabled
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function hashFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
  } catch {
    return 'sha256:MISSING';
  }
}
