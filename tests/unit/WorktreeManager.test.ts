import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

// vi.hoisted runs before module-level code and before vi.mock factories.
const { mockExecAsync } = vi.hoisted(() => ({ mockExecAsync: vi.fn() }));

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:util', () => ({
  promisify: () => mockExecAsync,
}));

import { WorktreeManager } from '../../src/git/WorktreeManager';
import { GitAutoCommit } from '../../src/git/GitAutoCommit';

function makeManager(root = '/workspace/myproject'): WorktreeManager {
  const autoCommit = new GitAutoCommit(root, { enabled: true });
  return new WorktreeManager(root, autoCommit);
}

describe('WorktreeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getPath returns sibling directory with arbiter- prefix', () => {
    const mgr = makeManager('/workspace/myproject');
    const p = mgr.getPath('FEAT-001');
    expect(p).toBe(path.resolve('/workspace', 'arbiter-FEAT-001'));
  });

  it('create calls git worktree add with correct arguments', async () => {
    // isGitRepo passes
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '.git', stderr: '' })
      // worktree add succeeds
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const mgr = makeManager('/workspace/myproject');
    const result = await mgr.create('FEAT-001', 'feat/FEAT-001-add-login');

    expect(result.ok).toBe(true);
    const secondCall = mockExecAsync.mock.calls[1];
    expect(secondCall[0]).toBe('git');
    const args: string[] = secondCall[1];
    expect(args).toContain('worktree');
    expect(args).toContain('add');
    expect(args).toContain('-b');
    expect(args).toContain('feat/FEAT-001-add-login');
  });

  it('create returns error when not a git repo', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('not a git repo'));

    const mgr = makeManager('/workspace/myproject');
    const result = await mgr.create('FEAT-001', 'feat/test');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('git');
  });

  it('delete calls git worktree remove with --force', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const mgr = makeManager('/workspace/myproject');
    const result = await mgr.delete('FEAT-001');

    expect(result.ok).toBe(true);
    const args: string[] = mockExecAsync.mock.calls[0][1];
    expect(args).toContain('worktree');
    expect(args).toContain('remove');
    expect(args).toContain('--force');
  });

  it('listActive parses git worktree list --porcelain output', async () => {
    const porcelainOutput = [
      'worktree /workspace/myproject',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /workspace/arbiter-FEAT-001',
      'HEAD def456',
      'branch refs/heads/feat/FEAT-001-add-login',
    ].join('\n');

    mockExecAsync
      .mockResolvedValueOnce({ stdout: '.git', stderr: '' })       // isGitRepo
      .mockResolvedValueOnce({ stdout: porcelainOutput, stderr: '' }); // list

    const mgr = makeManager('/workspace/myproject');
    const result = await mgr.listActive();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('/workspace/myproject');
    expect(result.value).toContain('/workspace/arbiter-FEAT-001');
  });

  it('listActive returns empty array when not a git repo', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('not a repo'));

    const mgr = makeManager('/workspace/myproject');
    const result = await mgr.listActive();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});
