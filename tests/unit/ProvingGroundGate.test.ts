import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ProvingGroundGate } from '../../src/gates/ProvingGroundGate';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'proving-ground-test-'));
}

describe('ProvingGroundGate', () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
  });

  it('returns runner:unknown and passed:true when no test config exists', async () => {
    const gate = new ProvingGroundGate();

    const result = await gate.run(dir);

    expect(result.runner).toBe('unknown');
    expect(result.passed).toBe(true);
    expect(result.failedTests).toHaveLength(0);
  });

  it('detects vitest runner when vitest.config.ts exists', async () => {
    fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
    const gate = new ProvingGroundGate();

    // We can't actually run vitest here; verify detection path triggers
    // by mocking runTestSuite. We test runner detection directly.
    const runner = await (gate as unknown as {
      detectRunner(d: string): Promise<string>;
    }).detectRunner(dir);

    expect(runner).toBe('vitest');
  });

  it('detects jest runner when jest.config.js exists', async () => {
    fs.writeFileSync(path.join(dir, 'jest.config.js'), 'module.exports = {}');
    const gate = new ProvingGroundGate();

    const runner = await (gate as unknown as {
      detectRunner(d: string): Promise<string>;
    }).detectRunner(dir);

    expect(runner).toBe('jest');
  });

  it('detects pytest runner when pytest.ini exists', async () => {
    fs.writeFileSync(path.join(dir, 'pytest.ini'), '[pytest]');
    const gate = new ProvingGroundGate();

    const runner = await (gate as unknown as {
      detectRunner(d: string): Promise<string>;
    }).detectRunner(dir);

    expect(runner).toBe('pytest');
  });

  it('detects playwright runner when playwright.config.ts exists', async () => {
    fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
    const gate = new ProvingGroundGate();

    const runner = await (gate as unknown as {
      detectRunner(d: string): Promise<string>;
    }).detectRunner(dir);

    expect(runner).toBe('playwright');
  });

  it('returns elapsed_ms as a positive number', async () => {
    const gate = new ProvingGroundGate();

    const result = await gate.run(dir);

    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('parses jest-style failed test output', async () => {
    const gate = new ProvingGroundGate();
    const output = [
      '  ✓ should work',
      '  FAIL src/auth.test.ts',
      '  ✗ should fail on empty input',
      '  × should reject bad token',
    ].join('\n');

    const failed = (gate as unknown as {
      parseFailedTests(output: string, runner: string): string[];
    }).parseFailedTests(output, 'jest');

    expect(failed.length).toBeGreaterThan(0);
    expect(failed.some(f => f.includes('FAIL') || f.includes('✗') || f.includes('×'))).toBe(true);
  });

  it('parses pytest-style failed test output', async () => {
    const gate = new ProvingGroundGate();
    const output = [
      'FAILED tests/test_auth.py::test_login_invalid',
      'FAILED tests/test_user.py::test_create_user',
      '2 failed in 0.42s',
    ].join('\n');

    const failed = (gate as unknown as {
      parseFailedTests(output: string, runner: string): string[];
    }).parseFailedTests(output, 'pytest');

    expect(failed).toHaveLength(2);
    expect(failed[0]).toContain('test_auth.py::test_login_invalid');
  });

  it('returns empty failedTests when output has no failures', async () => {
    const gate = new ProvingGroundGate();
    const output = '  ✓ all tests passed\n  2 tests passed';

    const failed = (gate as unknown as {
      parseFailedTests(output: string, runner: string): string[];
    }).parseFailedTests(output, 'vitest');

    expect(failed).toHaveLength(0);
  });
});
