import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ServiceResult } from '../types/index';
import { GitAutoCommit } from './GitAutoCommit';

const execFileAsync = promisify(execFile);

export class WorktreeManager {
  private readonly workspaceRoot: string;
  private readonly gitAutoCommit: GitAutoCommit;

  constructor(workspaceRoot: string, gitAutoCommit: GitAutoCommit) {
    this.workspaceRoot = workspaceRoot;
    this.gitAutoCommit = gitAutoCommit;
  }

  getPath(taskId: string): string {
    return path.resolve(this.workspaceRoot, '..', `arbiter-${taskId}`);
  }

  async create(taskId: string, branchName: string): Promise<ServiceResult<string>> {
    const worktreePath = this.getPath(taskId);

    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return { ok: false, error: 'Not a git repository — WorktreeManager requires git' };
    }

    try {
      await execFileAsync(
        'git',
        ['-C', this.workspaceRoot, 'worktree', 'add', worktreePath, '-b', branchName],
        { timeout: 30_000 },
      );
      return { ok: true, value: worktreePath };
    } catch (err) {
      return { ok: false, error: `git worktree add failed: ${String(err)}` };
    }
  }

  /**
   * Re-create a worktree checked out to an EXISTING branch (no -b) — used to
   * resume work on an already-opened PR branch (e.g. to apply a review fix).
   */
  async reopen(taskId: string, branchName: string): Promise<ServiceResult<string>> {
    const worktreePath = this.getPath(taskId);

    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return { ok: false, error: 'Not a git repository — WorktreeManager requires git' };
    }

    // Clean up a stale worktree at the same path first (best-effort).
    await execFileAsync('git', ['-C', this.workspaceRoot, 'worktree', 'remove', '--force', worktreePath], { timeout: 30_000 })
      .catch(() => { /* nothing to remove */ });

    try {
      await execFileAsync(
        'git',
        ['-C', this.workspaceRoot, 'worktree', 'add', worktreePath, branchName],
        { timeout: 30_000 },
      );
      return { ok: true, value: worktreePath };
    } catch (err) {
      return { ok: false, error: `git worktree add (reopen) failed: ${String(err)}` };
    }
  }

  /**
   * Stage + commit + push the task's worktree to an existing branch WITHOUT
   * opening a PR (used to push a follow-up commit onto an open PR's branch).
   */
  async pushToBranch(taskId: string, branchName: string, message?: string): Promise<ServiceResult<void>> {
    const worktreePath = this.getPath(taskId);
    const isRepo = await this.isGitRepo();
    if (!isRepo) return { ok: false, error: 'Not a git repository' };

    try {
      await execFileAsync('git', ['-C', worktreePath, 'add', '-A'], { timeout: 15_000 });
      await execFileAsync(
        'git',
        ['-C', worktreePath, 'commit', '-m', message ?? `arbiter: ${taskId} follow-up`],
        { timeout: 15_000 },
      ).catch(() => { /* nothing to commit */ });
      await execFileAsync('git', ['-C', worktreePath, 'push', 'origin', branchName], { timeout: 60_000 });
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `push to ${branchName} failed: ${String(err)}` };
    }
  }

  async delete(taskId: string): Promise<ServiceResult<void>> {
    const worktreePath = this.getPath(taskId);
    try {
      await execFileAsync(
        'git',
        ['-C', this.workspaceRoot, 'worktree', 'remove', '--force', worktreePath],
        { timeout: 30_000 },
      );
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `git worktree remove failed: ${String(err)}` };
    }
  }

  async commit(
    taskId: string,
    subTaskId: string,
    agentRole: string,
  ): Promise<ServiceResult<string>> {
    return this.gitAutoCommit.commit(taskId, subTaskId, agentRole);
  }

  /**
   * Stage + commit any pending changes in the task's worktree, push the branch to
   * origin, and open a PR via the `gh` CLI. Does NOT merge locally — the human (or
   * CI) merges the PR. Returns the PR URL on success.
   *
   * Degrades gracefully: returns ok:false (non-fatal to the caller) when the repo
   * isn't a git repo, has no `origin` remote, or `gh` is unavailable.
   */
  async merge(
    taskId: string,
    branchName: string,
    opts: { title?: string; body?: string } = {},
  ): Promise<ServiceResult<string>> {
    const worktreePath = this.getPath(taskId);

    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return { ok: false, error: 'Not a git repository — cannot open PR' };
    }

    try {
      // Commit anything the agents wrote in the worktree (no-op commit is tolerated).
      await execFileAsync('git', ['-C', worktreePath, 'add', '-A'], { timeout: 15_000 });
      await execFileAsync(
        'git',
        ['-C', worktreePath, 'commit', '-m', `arbiter: ${taskId} (Iron Funnel approved)`],
        { timeout: 15_000 },
      ).catch(() => { /* nothing to commit — fine */ });

      // Push the branch (requires an 'origin' remote).
      await execFileAsync(
        'git',
        ['-C', worktreePath, 'push', '-u', 'origin', branchName],
        { timeout: 60_000 },
      );
    } catch (err) {
      return { ok: false, error: `git push failed: ${String(err)}` };
    }

    // Open the PR via gh. Push succeeded; a gh failure is reported but non-fatal.
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr', 'create',
          '--head', branchName,
          '--title', opts.title ?? `Arbiter: ${taskId}`,
          '--body', opts.body ?? `Automated PR for task ${taskId}. All Iron Funnel gates passed.`,
        ],
        { cwd: worktreePath, timeout: 60_000 },
      );
      return { ok: true, value: stdout.trim() };
    } catch (err) {
      return { ok: false, error: `branch pushed but gh pr create failed: ${String(err)}` };
    }
  }

  async listActive(): Promise<ServiceResult<string[]>> {
    const isRepo = await this.isGitRepo();
    if (!isRepo) return { ok: true, value: [] };

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', this.workspaceRoot, 'worktree', 'list', '--porcelain'],
        { timeout: 10_000 },
      );
      const worktrees = this.parseWorktreeList(stdout);
      return { ok: true, value: worktrees };
    } catch (err) {
      return { ok: false, error: `git worktree list failed: ${String(err)}` };
    }
  }

  private parseWorktreeList(output: string): string[] {
    const paths: string[] = [];
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        paths.push(line.slice('worktree '.length).trim());
      }
    }
    return paths;
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      await execFileAsync('git', ['-C', this.workspaceRoot, 'rev-parse', '--git-dir'], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }
}
