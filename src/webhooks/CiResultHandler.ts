import { SqliteStore } from '../state/SqliteStore';
import { LLMProvider } from '../providers/LLMProvider';
import { OrchestratorDispatcher } from '../orchestrator/OrchestratorDispatcher';

export class CiResultHandler {
  constructor(
    private readonly sqliteStore: SqliteStore,
    private readonly provider: LLMProvider,
    private readonly workspaceRoot: string,
    private readonly orchestratorModel: string = 'claude-opus-4-7',
  ) {}

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
      this.sqliteStore.upsertTask({ task_id: taskId, status: 'failed' });
      this.sqliteStore.appendEvent(taskId, 'ci_failure', { conclusion, runUrl });
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
