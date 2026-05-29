import { SqliteStore } from '../state/SqliteStore';
import { LLMProvider } from '../providers/LLMProvider';
import { OrchestratorDispatcher } from '../orchestrator/OrchestratorDispatcher';
import { PatchRunner } from './PatchRunner';

export class CiResultHandler {
  private readonly patcher: PatchRunner;

  constructor(
    private readonly sqliteStore: SqliteStore,
    private readonly provider: LLMProvider,
    private readonly workspaceRoot: string,
    private readonly orchestratorModel: string = 'claude-opus-4-7',
  ) {
    this.patcher = new PatchRunner(this.sqliteStore, this.provider, this.workspaceRoot);
  }

  async handle(
    taskId: string,
    conclusion: string,
    prUrl: string,
    runUrl: string,
  ): Promise<void> {
    this.sqliteStore.appendEvent(taskId, 'ci_result', { conclusion, prUrl, runUrl });

    if (conclusion === 'success') {
      this.sqliteStore.upsertTask({ task_id: taskId, status: 'completed' });
      this.sqliteStore.appendEvent(taskId, 'task_completed_via_ci', { prUrl });

      const orchestrator = new OrchestratorDispatcher(
        this.sqliteStore,
        this.provider,
        this.workspaceRoot,
        this.orchestratorModel,
      );
      await orchestrator.wake(taskId, 'task_complete', { prUrl, runUrl }).catch(() => {});
    } else if (conclusion === 'failure' || conclusion === 'cancelled') {
      this.sqliteStore.appendEvent(taskId, 'ci_failure', { conclusion, runUrl });

      // Dispatch the Debugger for ONE automated repair attempt, then leave the
      // task failed for a human. Guard so a re-failing CI run doesn't loop.
      const alreadyTried = this.sqliteStore.getEvents(taskId, 'ci_debugger_attempt').length > 0;
      if (!alreadyTried) {
        this.sqliteStore.appendEvent(taskId, 'ci_debugger_attempt', { conclusion, runUrl });
        const branchName = `arbiter/${taskId}`;
        const prompt = [
          'CI failed on an open PR. Diagnose and fix the failure in the working tree.',
          'Output only the edited files. Keep the change minimal and focused on the CI failure.',
          '',
          `CI conclusion: ${conclusion}`,
          `CI run: ${runUrl}`,
        ].join('\n');

        const result = await this.patcher.applyFix({
          taskId,
          branchName,
          agentRole: 'debugger',
          model: this.orchestratorModel,
          prompt,
          commitMessage: `arbiter: debugger fix for failing CI`,
        });
        this.sqliteStore.appendEvent(taskId, 'ci_debugger_result', {
          pushed: result.pushed,
          gatePassed: result.gatePassed,
          reason: result.reason,
        });
        // If pushed, CI re-runs on the new commit; keep status until that result.
        if (!result.pushed) this.sqliteStore.upsertTask({ task_id: taskId, status: 'failed' });
      } else {
        // Already attempted a repair — hand off to a human.
        this.sqliteStore.upsertTask({ task_id: taskId, status: 'failed' });
      }
    }
  }

  static extractTaskIdFromBranch(branchName: string): string {
    // Branch convention: feat/arbiter-{taskId}-description
    // Match: arbiter-FEAT-001 or arbiter/FEAT-001 (stop at next - that isn't part of the ID)
    // Task IDs follow format: ALPHA-DIGITS (e.g. FEAT-001, TASK-123)
    const match = branchName.match(/arbiter[-/]([A-Z]+-\d+)/i);
    return match ? match[1] : '';
  }
}
