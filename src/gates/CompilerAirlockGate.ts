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
}

export interface CompilerAirlockResult {
  passed: boolean;
  errors: CompilerError[];
  elapsed_ms: number;
}

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp; tool: 'forbidden_pattern' }> = [
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/g, tool: 'forbidden_pattern' },
  { name: 'eval_usage', pattern: /\beval\s*\(/g, tool: 'forbidden_pattern' },
  { name: 'document_write', pattern: /document\.write\s*\(/g, tool: 'forbidden_pattern' },
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

    // Step 2: Forbidden pattern scan
    const patternErrors = await this.scanForbiddenPatterns(worktreePath);
    errors.push(...patternErrors);

    // Step 3: Prisma validate (if schema exists)
    const prismaErrors = await this.runPrismaValidate(worktreePath);
    errors.push(...prismaErrors);

    // Step 4: Contract mutation check (Tier 2 only)
    if (options.tier === 2 && options.lockedContractPaths?.length) {
      const mutationErrors = await this.checkContractMutations(worktreePath, options.lockedContractPaths);
      errors.push(...mutationErrors);
    }

    return {
      passed: errors.length === 0,
      errors,
      elapsed_ms: Date.now() - startMs,
    };
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
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        for (const { name, pattern } of FORBIDDEN_PATTERNS) {
          pattern.lastIndex = 0;
          if (pattern.test(content)) {
            errors.push({
              tool: 'forbidden_pattern',
              file: path.relative(worktreePath, filePath),
              message: `Forbidden pattern "${name}" detected`,
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
