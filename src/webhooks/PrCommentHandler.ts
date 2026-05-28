import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SqliteStore } from '../state/SqliteStore';
import { LLMProvider } from '../providers/LLMProvider';
import { OrchestratorDispatcher } from '../orchestrator/OrchestratorDispatcher';

const execFileAsync = promisify(execFile);

export class PrCommentHandler {
  private readonly orchestrator: OrchestratorDispatcher;

  constructor(
    private readonly sqliteStore: SqliteStore,
    private readonly provider: LLMProvider,
    private readonly workspaceRoot: string,
    orchestratorModel: string = 'claude-opus-4-7',
  ) {
    this.orchestrator = new OrchestratorDispatcher(
      this.sqliteStore,
      this.provider,
      this.workspaceRoot,
      orchestratorModel,
    );
  }

  async handle(
    taskId: string,
    comment: string,
    prNumber: number,
    author: string,
    isReview: boolean,
  ): Promise<void> {
    this.sqliteStore.appendEvent(taskId, 'pr_comment_received', {
      prNumber,
      author,
      isReview,
      commentLength: comment.length,
    });

    // Wake orchestrator to classify the comment
    const response = await this.orchestrator.wake(taskId, 'pr_comment', {
      comment,
      prNumber,
      author,
    });

    const commentType = response.commentType ?? 'question';

    this.sqliteStore.appendEvent(taskId, 'pr_comment_classified', {
      commentType,
      prNumber,
    });

    if (commentType === 'lgtm') {
      this.sqliteStore.upsertTask({ task_id: taskId, status: 'completed' });
      this.sqliteStore.appendEvent(taskId, 'task_completed_via_lgtm', { prNumber, author });
    } else if (commentType === 'question') {
      await this.postPrComment(prNumber, response.content);
    } else if (commentType === 'code_change') {
      await this.dispatchCoderFix(taskId, comment, response.content);
    }
  }

  private async postPrComment(prNumber: number, body: string): Promise<void> {
    try {
      await execFileAsync(
        'gh',
        ['pr', 'comment', String(prNumber), '--body', body.slice(0, 65_000)],
        { cwd: this.workspaceRoot, timeout: 30_000 },
      );
    } catch {
      // gh not installed or not authenticated — non-fatal
    }
  }

  private async dispatchCoderFix(
    taskId: string,
    comment: string,
    orchestratorSuggestion: string,
  ): Promise<void> {
    this.sqliteStore.appendEvent(taskId, 'coder_fix_dispatched', {
      reason: 'pr_comment_code_change',
      comment: comment.slice(0, 500),
      suggestion: orchestratorSuggestion.slice(0, 500),
    });

    // Coder dispatch is handled by Conductor.resumeFromPrComment() in Phase 07+
    // Here we record the intent in SqliteStore and let the Conductor poll for it
    this.sqliteStore.appendEvent(taskId, 'pending_coder_fix', {
      comment,
      orchestratorSuggestion,
      createdAt: new Date().toISOString(),
    });
  }
}
