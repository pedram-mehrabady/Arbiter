import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PreflightCheck } from '../../src/preflight/PreflightCheck';

const makeDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-pf-'));

const baseScore = {
  file_count: 3,
  new_dependency_count: 0,
  crypto_or_validation_logic: 0,
  subprocess_or_migration: 0,
  cross_module_integration: 0,
  weighted_total: 3,
  tier: 1 as const,
};

describe('PreflightCheck', () => {
  let dir: string;
  let check: PreflightCheck;

  beforeEach(async () => {
    dir = await makeDir();
    check = new PreflightCheck();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns spawn verdict for clean task with existing files', async () => {
    const f = path.join(dir, 'task.md');
    await fs.writeFile(f, '# My Task\n\nSimple work.', 'utf-8');

    const r = await check.run('T1', 'reframe', [f], baseScore);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.passed).toBe(true);
    expect(r.value.verdict).toBe('spawn');
    expect(r.value.contextHash).toMatch(/^sha256:/);
  });

  it('returns reject verdict when context files are missing', async () => {
    const r = await check.run('T1', 'reframe', [path.join(dir, 'nonexistent.md')], baseScore);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.passed).toBe(false);
    expect(r.value.verdict).toBe('reject');
  });

  it('returns split verdict when complexity score exceeds cap', async () => {
    const f = path.join(dir, 'task.md');
    await fs.writeFile(f, '# task', 'utf-8');
    const overScore = { ...baseScore, file_count: 20, weighted_total: 20, tier: 3 as const };

    const r = await check.run('T1', 'reframe', [f], overScore);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.passed).toBe(false);
    expect(r.value.verdict).toBe('split');
  });

  it('returns halt verdict for P-CRYPTO violation (AesManaged)', async () => {
    const f = path.join(dir, 'crypto.ts');
    await fs.writeFile(f, 'const cipher = new AesManaged();', 'utf-8');

    const r = await check.run('T1', 'backend', [f]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.passed).toBe(false);
    expect(r.value.verdict).toBe('halt');
  });

  it('passes without complexity score argument', async () => {
    const f = path.join(dir, 'task.md');
    await fs.writeFile(f, '# ok', 'utf-8');

    const r = await check.run('T1', 'reframe', [f]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.passed).toBe(true);
  });

  it('works with empty contextFiles list', async () => {
    const r = await check.run('T1', 'reframe', [], baseScore);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.passed).toBe(true);
    expect(r.value.verdict).toBe('spawn');
  });

  it('formatFailures returns readable string for failed checks', async () => {
    const r = await check.run('T1', 'reframe', [path.join(dir, 'missing.md')], baseScore);
    if (!r.ok) return;
    const formatted = check.formatFailures(r.value);
    expect(formatted).toContain('[FAIL]');
    expect(formatted).toContain('context_files_exist');
  });

  it('formatFailures returns empty string when all checks pass', async () => {
    const f = path.join(dir, 'task.md');
    await fs.writeFile(f, '# ok', 'utf-8');
    const r = await check.run('T1', 'reframe', [f], baseScore);
    if (!r.ok) return;
    expect(check.formatFailures(r.value)).toBe('');
  });
});
