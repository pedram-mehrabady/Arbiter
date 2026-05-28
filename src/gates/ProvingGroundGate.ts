import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface CoverageFloors {
  statements: number;
  branches: number;
  functions: number;
}

export interface ProvingGroundResult {
  passed: boolean;
  testOutput: string;
  failedTests: string[];
  coveragePct?: { statements: number; branches: number; functions: number };
  elapsed_ms: number;
  runner: 'jest' | 'vitest' | 'pytest' | 'playwright' | 'unknown';
}

export class ProvingGroundGate {
  async run(worktreePath: string, coverageFloors?: CoverageFloors): Promise<ProvingGroundResult> {
    const startMs = Date.now();
    const runner = await this.detectRunner(worktreePath);

    if (runner === 'unknown') {
      return {
        passed: true,
        testOutput: 'No test runner detected — skipping Proving Ground gate',
        failedTests: [],
        elapsed_ms: Date.now() - startMs,
        runner: 'unknown',
      };
    }

    const { output, exitCode } = await this.runTestSuite(worktreePath, runner);
    const failedTests = this.parseFailedTests(output, runner);
    const passed = exitCode === 0 && failedTests.length === 0;

    return {
      passed,
      testOutput: output.slice(0, 10_000),
      failedTests,
      elapsed_ms: Date.now() - startMs,
      runner,
    };
  }

  private async detectRunner(dir: string): Promise<ProvingGroundResult['runner']> {
    const checks: Array<[string, ProvingGroundResult['runner']]> = [
      ['vitest.config.ts', 'vitest'],
      ['vitest.config.js', 'vitest'],
      ['jest.config.ts', 'jest'],
      ['jest.config.js', 'jest'],
      ['pytest.ini', 'pytest'],
      ['setup.cfg', 'pytest'],
      ['playwright.config.ts', 'playwright'],
      ['playwright.config.js', 'playwright'],
    ];

    for (const [file, runner] of checks) {
      const exists = await fileExists(path.join(dir, file));
      if (exists) return runner;
    }
    return 'unknown';
  }

  private async runTestSuite(
    worktreePath: string,
    runner: ProvingGroundResult['runner'],
  ): Promise<{ output: string; exitCode: number }> {
    const commands: Record<string, [string, string[]]> = {
      vitest:     ['npx', ['vitest', 'run', '--reporter=verbose']],
      jest:       ['npx', ['jest', '--no-coverage']],
      pytest:     ['python', ['-m', 'pytest', '-v']],
      playwright: ['npx', ['playwright', 'test']],
    };

    const cmd = commands[runner];
    if (!cmd) return { output: '', exitCode: 0 };

    try {
      const { stdout, stderr } = await execFileAsync(cmd[0], cmd[1], {
        cwd: worktreePath,
        timeout: 300_000,
      });
      return { output: (stdout + stderr).trim(), exitCode: 0 };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      return {
        output: ((e.stdout ?? '') + (e.stderr ?? '')).trim(),
        exitCode: typeof e.code === 'number' ? e.code : 1,
      };
    }
  }

  private parseFailedTests(output: string, runner: ProvingGroundResult['runner']): string[] {
    const failed: string[] = [];
    const lines = output.split('\n');

    if (runner === 'vitest' || runner === 'jest') {
      for (const line of lines) {
        if (line.match(/^\s*✗\s|FAIL\s|× |✕ /)) {
          failed.push(line.trim());
        }
      }
    } else if (runner === 'pytest') {
      for (const line of lines) {
        if (line.startsWith('FAILED ')) {
          failed.push(line.replace('FAILED ', '').trim());
        }
      }
    }

    return failed;
  }
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}
