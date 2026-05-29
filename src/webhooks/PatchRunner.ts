import { SqliteStore } from '../state/SqliteStore';
import { LLMProvider } from '../providers/LLMProvider';
import { WorktreeManager } from '../git/WorktreeManager';
import { GitAutoCommit } from '../git/GitAutoCommit';
import { CompilerAirlockGate } from '../gates/CompilerAirlockGate';

export interface PatchResult {
  ok: boolean;        // the operation ran to a defined conclusion (git available, agent ran)
  pushed: boolean;    // a commit was pushed to the branch
  gatePassed: boolean;
  reason?: string;
}

/**
 * Applies a follow-up fix to an already-opened PR branch: reopen the branch in a
 * worktree, dispatch an agent, run the Compiler Airlock (Gate 1) on the result,
 * and push the fix back to the same branch (no new PR). Shared by the PR-comment
 * (Coder) and CI-failure (Debugger) loops. Never throws; degrades to ok:false
 * when git/worktrees aren't available (e.g. test sandboxes).
 */
export class PatchRunner {
  private readonly worktrees: WorktreeManager;
  private readonly airlock = new CompilerAirlockGate();

  constructor(
    private readonly sqliteStore: SqliteStore,
    private readonly provider: LLMProvider,
    workspaceRoot: string,
  ) {
    this.worktrees = new WorktreeManager(workspaceRoot, new GitAutoCommit(workspaceRoot, { enabled: true }));
  }

  async applyFix(opts: {
    taskId: string;
    branchName: string;
    agentRole: string;
    model: string;
    prompt: string;
    commitMessage: string;
  }): Promise<PatchResult> {
    const { taskId, branchName, agentRole, model, prompt, commitMessage } = opts;

    const wt = await this.worktrees.reopen(taskId, branchName);
    if (!wt.ok) return { ok: false, pushed: false, gatePassed: false, reason: wt.error };
    const worktreePath = wt.value;

    try {
      const result = await this.provider.invoke({
        model,
        assembledPrompt: prompt,
        maxTokens: 4096,
        timeoutMs: 180_000,
        agentRole,
      });
      if (!result.ok || result.value.exitCode !== 0) {
        this.sqliteStore.appendEvent(taskId, 'patch_agent_failed', { agentRole });
        return { ok: false, pushed: false, gatePassed: false, reason: 'agent invocation failed' };
      }

      // Gate 1: deterministic compiler airlock on the patched worktree.
      const gate = await this.airlock.run(worktreePath);
      this.sqliteStore.appendEvent(taskId, 'patch_gate1', { passed: gate.passed, errors: gate.errors.length });
      if (!gate.passed) {
        return { ok: true, pushed: false, gatePassed: false, reason: `Gate 1 failed (${gate.errors.length} errors)` };
      }

      const push = await this.worktrees.pushToBranch(taskId, branchName, commitMessage);
      if (!push.ok) return { ok: true, pushed: false, gatePassed: true, reason: push.error };

      this.sqliteStore.appendEvent(taskId, 'patch_pushed', { branchName, agentRole });
      return { ok: true, pushed: true, gatePassed: true };
    } finally {
      await this.worktrees.delete(taskId).catch(() => { /* best-effort cleanup */ });
    }
  }
}
