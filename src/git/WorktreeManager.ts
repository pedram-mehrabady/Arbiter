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
