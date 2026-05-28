import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ServiceResult } from '../types/index';
import { GitAutoCommitConfig } from '../types/index';

const execFileAsync = promisify(execFile);

export class GitAutoCommit {
  private readonly workspaceRoot: string;
  private readonly config: GitAutoCommitConfig;

  constructor(workspaceRoot: string, config: GitAutoCommitConfig) {
    this.workspaceRoot = workspaceRoot;
    this.config = config;
  }

  async commit(taskId: string, subTaskId: string, agentRole: string): Promise<ServiceResult<string>> {
    // Check if git repo exists
    try {
      await execFileAsync('git', ['-C', this.workspaceRoot, 'rev-parse', '--git-dir'], { timeout: 5_000 });
    } catch {
      return { ok: false, error: 'Not a git repository — skipping auto-commit' };
    }

    // Stage all changes in the workspace
    try {
      await execFileAsync('git', ['-C', this.workspaceRoot, 'add', '-A'], { timeout: 15_000 });
    } catch (err) {
      return { ok: false, error: `git add failed: ${String(err)}` };
    }

    // Check if there's anything to commit
    try {
      const { stdout } = await execFileAsync(
        'git', ['-C', this.workspaceRoot, 'diff', '--cached', '--quiet'],
        { timeout: 5_000 },
      );
      void stdout;
      // Exit code 0 means no diff — nothing to commit
      return { ok: true, value: 'nothing-to-commit' };
    } catch {
      // Non-zero exit means there are staged changes — proceed
    }

    const message = this.buildMessage(taskId, subTaskId, agentRole);
    const args = ['-C', this.workspaceRoot, 'commit', '-m', message];

    if (this.config.author_name && this.config.author_email) {
      args.push(
        '--author',
        `${this.config.author_name} <${this.config.author_email}>`,
      );
    }

    try {
      const { stdout } = await execFileAsync('git', args, { timeout: 30_000 });
      const hash = stdout.match(/\[.+?([0-9a-f]{7,})\]/)?.[1] ?? 'unknown';
      return { ok: true, value: hash };
    } catch (err) {
      return { ok: false, error: `git commit failed: ${String(err)}` };
    }
  }

  private buildMessage(taskId: string, subTaskId: string, agentRole: string): string {
    const template = this.config.message_template ?? 'arbiter: {{task_id}}/{{sub_task_id}} ({{agent_role}})';
    return template
      .replace('{{task_id}}',    taskId)
      .replace('{{sub_task_id}}', subTaskId)
      .replace('{{agent_role}}', agentRole);
  }
}
