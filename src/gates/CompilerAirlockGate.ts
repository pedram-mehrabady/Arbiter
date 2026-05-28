import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface CompilerError {
  tool: 'tsc' | 'eslint' | 'prisma' | 'forbidden_pattern';
  message: string;
  file?: string;
  line?: number;
  /** 'error' fails the gate; 'warn' is reported but does not fail. Defaults to 'error'. */
  severity?: 'error' | 'warn';
}

export interface CompilerAirlockResult {
  passed: boolean;
  errors: CompilerError[];
  elapsed_ms: number;
}

interface ForbiddenPattern {
  name: string;
  pattern: RegExp;
  tool: 'forbidden_pattern';
  severity: 'error' | 'warn';
  /** Only scan files whose relative path ends with one of these extensions. Empty = all source files. */
  includeExtensions?: string[];
  /** Skip files whose relative path contains any of these path fragments. */
  excludePathFragments?: string[];
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/g, tool: 'forbidden_pattern', severity: 'error' },
  { name: 'eval_usage', pattern: /\beval\s*\(/g, tool: 'forbidden_pattern', severity: 'error' },
  { name: 'document_write', pattern: /document\.write\s*\(/g, tool: 'forbidden_pattern', severity: 'error' },
  {
    name: 'direct_db_in_frontend',
    pattern: /import\s+.*from\s+['"].*prisma.*client['"]/g,
    tool: 'forbidden_pattern',
    severity: 'error',
    includeExtensions: ['.ts', '.tsx'],
    excludePathFragments: ['/api/', '/server/'],
  },
  { name: 'any_type_explicit', pattern: /:\s*any\b/g, tool: 'forbidden_pattern', severity: 'warn' },
];

export class CompilerAirlockGate {
  async run(
    worktreePath: string,
    options: { tier?: 1 | 2 | 3; lockedContractPaths?: string[] } = {},
  ): Promise<CompilerAirlockResult> {
    const startMs = Date.now();
    const errors: CompilerError[] = [];

    // Step 1: TypeScript compile check
    const tscErrors = await this.runTsc(worktreePath);
    errors.push(...tscErrors);

    // Step 2: ESLint (if the project has an eslint config)
    const eslintErrors = await this.runEslint(worktreePath);
    errors.push(...eslintErrors);

    // Step 3: Forbidden pattern scan
    const patternErrors = await this.scanForbiddenPatterns(worktreePath);
    errors.push(...patternErrors);

    // Step 4: Prisma validate (if schema exists)
    const prismaErrors = await this.runPrismaValidate(worktreePath);
    errors.push(...prismaErrors);

    // Step 5: Contract mutation check (Tier 2 only)
    if (options.tier === 2 && options.lockedContractPaths?.length) {
      const mutationErrors = await this.checkContractMutations(worktreePath, options.lockedContractPaths);
      errors.push(...mutationErrors);
    }

    // Only error-severity findings fail the gate; warnings are reported but pass.
    const blocking = errors.filter(e => (e.severity ?? 'error') === 'error');

    return {
      passed: blocking.length === 0,
      errors,
      elapsed_ms: Date.now() - startMs,
    };
  }

  private async runEslint(worktreePath: string): Promise<CompilerError[]> {
    const hasConfig = await firstExisting(worktreePath, [
      'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
      '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
    ]);
    if (!hasConfig) return [];

    try {
      await execFileAsync('npx', ['eslint', '.', '--format', 'json', '--no-error-on-unmatched-pattern'], {
        timeout: 60_000,
        cwd: worktreePath,
      });
      return [];
    } catch (err) {
      const output = String((err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? '');
      return this.parseEslintOutput(output, worktreePath);
    }
  }

  private parseEslintOutput(output: string, worktreePath: string): CompilerError[] {
    const errors: CompilerError[] = [];
    let report: Array<{ filePath: string; messages: Array<{ ruleId?: string; message: string; line?: number; severity: number }> }>;
    try {
      report = JSON.parse(output);
    } catch {
      // eslint produced non-JSON (e.g. crashed) — surface a single generic error
      return output.trim() ? [{ tool: 'eslint', message: output.trim().slice(0, 300), severity: 'error' }] : [];
    }
    for (const fileReport of report) {
      for (const m of fileReport.messages) {
        errors.push({
          tool: 'eslint',
          file: path.relative(worktreePath, fileReport.filePath),
          line: m.line,
          message: `${m.ruleId ? `${m.ruleId}: ` : ''}${m.message}`,
          severity: m.severity === 2 ? 'error' : 'warn',
        });
      }
    }
    return errors;
  }

  private async runTsc(worktreePath: string): Promise<CompilerError[]> {
    const tsconfig = path.join(worktreePath, 'tsconfig.json');
    const hasTsConfig = await fileExists(tsconfig);
    if (!hasTsConfig) return [];

    try {
      await execFileAsync('npx', ['tsc', '--noEmit', '-p', tsconfig], {
        timeout: 60_000,
        cwd: worktreePath,
      });
      return [];
    } catch (err) {
      const output = String((err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout ?? '');
      return this.parseTscOutput(output);
    }
  }

  private parseTscOutput(output: string): CompilerError[] {
    const errors: CompilerError[] = [];
    const lines = output.split('\n');
    for (const line of lines) {
      // Pattern: file(line,col): error TSxxxx: message
      const match = line.match(/^(.+?)\((\d+),\d+\):\s+error\s+TS\d+:\s+(.+)$/);
      if (match) {
        errors.push({
          tool: 'tsc',
          file: match[1],
          line: parseInt(match[2], 10),
          message: match[3],
        });
      } else if (line.includes('error TS')) {
        errors.push({ tool: 'tsc', message: line.trim() });
      }
    }
    return errors;
  }

  private async scanForbiddenPatterns(worktreePath: string): Promise<CompilerError[]> {
    const errors: CompilerError[] = [];
    const files = await findSourceFiles(worktreePath);

    for (const filePath of files) {
      const rel = path.relative(worktreePath, filePath);
      const relPosix = rel.split(path.sep).join('/');
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        for (const fp of FORBIDDEN_PATTERNS) {
          if (fp.includeExtensions && !fp.includeExtensions.some(ext => relPosix.endsWith(ext))) continue;
          if (fp.excludePathFragments?.some(frag => `/${relPosix}`.includes(frag))) continue;
          fp.pattern.lastIndex = 0;
          if (fp.pattern.test(content)) {
            errors.push({
              tool: 'forbidden_pattern',
              file: rel,
              message: `Forbidden pattern "${fp.name}" detected`,
              severity: fp.severity,
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return errors;
  }

  private async runPrismaValidate(worktreePath: string): Promise<CompilerError[]> {
    const schemaPath = path.join(worktreePath, 'prisma', 'schema.prisma');
    const hasSchema = await fileExists(schemaPath);
    if (!hasSchema) return [];

    try {
      await execFileAsync('npx', ['prisma', 'validate', '--schema', schemaPath], {
        timeout: 30_000,
        cwd: worktreePath,
      });
      return [];
    } catch (err) {
      const msg = String((err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? err);
      return [{ tool: 'prisma', message: `Prisma validation failed: ${msg.slice(0, 300)}` }];
    }
  }

  private async checkContractMutations(
    worktreePath: string,
    lockedPaths: string[],
  ): Promise<CompilerError[]> {
    const errors: CompilerError[] = [];

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', worktreePath, 'diff', '--name-only', 'HEAD'],
        { timeout: 10_000 },
      );
      const changedFiles = stdout.split('\n').filter(Boolean);

      for (const changed of changedFiles) {
        for (const locked of lockedPaths) {
          if (changed.startsWith(locked)) {
            errors.push({
              tool: 'forbidden_pattern',
              file: changed,
              message: `CONTRACT_MUTATION_ON_TIER2: ${changed} is locked for Tier 2 tasks. Re-classify as Tier 3 if contract changes are required.`,
            });
          }
        }
      }
    } catch {
      // Git not available in test env — skip
    }

    return errors;
  }
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

async function firstExisting(dir: string, candidates: string[]): Promise<boolean> {
  for (const name of candidates) {
    if (await fileExists(path.join(dir, name))) return true;
  }
  return false;
}

async function findSourceFiles(dir: string, extensions = ['.ts', '.tsx', '.js', '.jsx']): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await findSourceFiles(fullPath, extensions));
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory unreadable
  }
  return results;
}
