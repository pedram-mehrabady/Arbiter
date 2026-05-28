import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface ContractValidationError {
  file: string;
  error: string;
}

export interface ContractValidationResult {
  passed: boolean;
  errors: ContractValidationError[];
}

export class ContractValidator {
  async run(worktreePath: string): Promise<ContractValidationResult> {
    const errors: ContractValidationError[] = [];

    const contractsDir = path.join(worktreePath, 'contracts');
    const exists = await dirExists(contractsDir);
    if (!exists) {
      return { passed: true, errors: [] };
    }

    const apiPath = path.join(contractsDir, 'api.ts');
    const eventsPath = path.join(contractsDir, 'events.ts');
    const schemaPath = path.join(contractsDir, 'schema.prisma');

    const [apiErrors, eventsErrors, prismaErrors] = await Promise.all([
      this.validateTsFile(apiPath, worktreePath),
      this.validateTsFile(eventsPath, worktreePath),
      this.validatePrismaSchema(schemaPath),
    ]);

    errors.push(...apiErrors, ...eventsErrors, ...prismaErrors);

    return { passed: errors.length === 0, errors };
  }

  private async validateTsFile(filePath: string, worktreePath: string): Promise<ContractValidationError[]> {
    const exists = await fileExists(filePath);
    if (!exists) return [];

    const content = await fs.readFile(filePath, 'utf-8').catch(() => '');
    if (isEmptyContract(content)) return [];

    try {
      await execFileAsync(
        'npx',
        ['tsc', '--noEmit', '--strict', '--target', 'ES2020', '--module', 'commonjs',
          '--moduleResolution', 'node', '--esModuleInterop', filePath],
        { cwd: worktreePath, timeout: 30_000 },
      );
      return [];
    } catch (err) {
      const output = String(
        (err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout ?? '',
      );
      return parseTscErrors(filePath, output);
    }
  }

  private async validatePrismaSchema(schemaPath: string): Promise<ContractValidationError[]> {
    const exists = await fileExists(schemaPath);
    if (!exists) return [];

    const content = await fs.readFile(schemaPath, 'utf-8').catch(() => '');
    if (isEmptyContract(content)) return [];

    try {
      await execFileAsync('npx', ['prisma', 'validate', '--schema', schemaPath], {
        timeout: 30_000,
      });
      return [];
    } catch (err) {
      const msg = String(
        (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? err,
      );
      return [{ file: schemaPath, error: `Prisma validation failed: ${msg.slice(0, 300)}` }];
    }
  }
}

function parseTscErrors(filePath: string, output: string): ContractValidationError[] {
  const errors: ContractValidationError[] = [];
  for (const line of output.split('\n')) {
    if (line.includes('error TS')) {
      errors.push({ file: path.basename(filePath), error: line.trim() });
    }
  }
  if (errors.length === 0 && output.trim()) {
    errors.push({ file: path.basename(filePath), error: output.trim().slice(0, 300) });
  }
  return errors;
}

function isEmptyContract(content: string): boolean {
  return content.trim().startsWith('//') && content.trim().split('\n').length <= 3;
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

async function dirExists(p: string): Promise<boolean> {
  return fs.stat(p).then(s => s.isDirectory()).catch(() => false);
}
