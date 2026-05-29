import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SqliteStore } from '../state/SqliteStore';
import { LLMProvider } from '../providers/LLMProvider';
import { OrchestratorDispatcher } from '../orchestrator/OrchestratorDispatcher';
import { PatchRunner } from './PatchRunner';

const execFileAsync = promisify(execFile);

export class PrCommentHandler {
  private readonly orchestrator: OrchestratorDispatcher;
  private readonly patcher: PatchRunner;
  private readonly coderModel: string;

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
    this.patcher = new PatchRunner(this.sqliteStore, this.provider, this.workspaceRoot);
    this.coderModel = orchestratorModel;
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
      await this.dispatchCoderFix(taskId, comment, response.content, prNumber);
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
    prNumber: number,
  ): Promise<void> {
    this.sqliteStore.appendEvent(taskId, 'coder_fix_dispatched', {
      reason: 'pr_comment_code_change',
      comment: comment.slice(0, 500),
      suggestion: orchestratorSuggestion.slice(0, 500),
    });

    const branchName = `arbiter/${taskId}`;
    const prompt = [
      'You are applying a reviewer-requested change to an open PR.',
      'Make the change directly in the working tree. Output only the edited files.',
      '',
      '## Reviewer comment',
      comment,
      '',
      '## Orchestrator guidance',
      orchestratorSuggestion,
    ].join('\n');

    const result = await this.patcher.applyFix({
      taskId,
      branchName,
      agentRole: 'backend',
      model: this.coderModel,
      prompt,
      commitMessage: `arbiter: address PR #${prNumber} review comment`,
    });

    this.sqliteStore.appendEvent(taskId, 'coder_fix_result', {
      pushed: result.pushed,
      gatePassed: result.gatePassed,
      reason: result.reason,
    });

    // Tell the reviewer what happened, on the PR.
    const reply = result.pushed
      ? '🤖 Pushed a fix for this comment — CI will re-run on the new commit.'
      : result.gatePassed === false
        ? `🤖 Attempted a fix but it failed the compiler gate (${result.reason}). Leaving the PR unchanged.`
        : `🤖 Could not apply an automated fix (${result.reason ?? 'unknown'}).`;
    await this.postPrComment(prNumber, reply);
  }
}
