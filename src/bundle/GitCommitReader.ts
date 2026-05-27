import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ServiceResult } from '../types/index';

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  timestamp: string;
  receiptId?: string;
  taskId?: string;
}

// Commit body trailer format written by Arbiter when auto-merge is enabled:
//   Arbiter-Task: FEAT-99
//   Arbiter-Receipt: rec_20260527T140000Z_backend_001
const RECEIPT_TRAILER_RE = /^Arbiter-Receipt:\s*(.+)$/m;
const TASK_TRAILER_RE = /^Arbiter-Task:\s*(.+)$/m;

// Log format: HASH|SHORT|SUBJECT|ISO_TIMESTAMP|BODY (body is everything after the 5th |)
const LOG_FORMAT = '%H|%h|%s|%aI|%b';
const BODY_DELIMITER = '\x00'; // null byte between commits — avoids multiline body issues

export class GitCommitReader {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async getTaskCommits(taskId: string): Promise<ServiceResult<GitCommit[]>> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        [
          'log',
          `--format=${LOG_FORMAT}${BODY_DELIMITER}`,
          '--grep', taskId,
          '--extended-regexp',
          '-i',                    // case-insensitive grep
        ],
        { cwd: this.workspaceRoot },
      );

      const commits = this.parseLog(stdout, taskId);
      return { ok: true, value: commits };
    } catch (err) {
      // Not a git repo, or no commits found — gracefully return empty
      const msg = String(err);
      if (msg.includes('not a git repository') || msg.includes('fatal:')) {
        return { ok: true, value: [] };
      }
      return { ok: false, error: `git log failed: ${msg}` };
    }
  }

  async getRecentCommits(n = 20): Promise<ServiceResult<GitCommit[]>> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', `--format=${LOG_FORMAT}${BODY_DELIMITER}`, `-${n}`],
        { cwd: this.workspaceRoot },
      );
      return { ok: true, value: this.parseLog(stdout) };
    } catch {
      return { ok: true, value: [] };
    }
  }

  private parseLog(output: string, taskId?: string): GitCommit[] {
    return output
      .split(BODY_DELIMITER)
      .map(s => s.trim())
      .filter(Boolean)
      .map(entry => {
        const firstNewline = entry.indexOf('\n');
        const header = firstNewline === -1 ? entry : entry.slice(0, firstNewline);
        const body = firstNewline === -1 ? '' : entry.slice(firstNewline + 1);
        const parts = header.split('|');

        // parts: [hash, shortHash, subject, timestamp] — subject itself might contain |
        const hash = parts[0] ?? '';
        const shortHash = parts[1] ?? '';
        const timestamp = parts[3] ?? '';
        const subject = parts.slice(2, 3).join('|');

        const receiptMatch = RECEIPT_TRAILER_RE.exec(body);
        const taskMatch = TASK_TRAILER_RE.exec(body);

        const commit: GitCommit = {
          hash,
          shortHash,
          subject,
          timestamp,
          receiptId: receiptMatch?.[1]?.trim(),
          taskId: taskMatch?.[1]?.trim() ?? taskId,
        };
        return commit;
      })
      .filter(c => c.hash.length > 0);
  }
}
