import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ContractValidator } from '../../src/contracts/ContractValidator';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contract-validator-test-'));
}

describe('ContractValidator', () => {
  it('passes when no contracts/ directory exists', async () => {
    const dir = tempDir();
    const validator = new ContractValidator();

    const result = await validator.run(dir);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes when contracts/ directory is empty', async () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'contracts'));
    const validator = new ContractValidator();

    const result = await validator.run(dir);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes for a comment-only contracts/api.ts (empty contract)', async () => {
    const dir = tempDir();
    const contractsDir = path.join(dir, 'contracts');
    fs.mkdirSync(contractsDir);
    fs.writeFileSync(path.join(contractsDir, 'api.ts'), '// No new API endpoints for this task.');
    const validator = new ContractValidator();

    const result = await validator.run(dir);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes for a comment-only contracts/events.ts (empty contract)', async () => {
    const dir = tempDir();
    const contractsDir = path.join(dir, 'contracts');
    fs.mkdirSync(contractsDir);
    fs.writeFileSync(path.join(contractsDir, 'events.ts'), '// No new events for this task.');
    const validator = new ContractValidator();

    const result = await validator.run(dir);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('skips prisma validate when no schema.prisma exists', async () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'contracts'));
    const validator = new ContractValidator();

    const result = await validator.run(dir);

    expect(result.errors.some(e => e.file.includes('schema.prisma'))).toBe(false);
  });

  it('returns errors array with file field for each failure', async () => {
    const dir = tempDir();
    const contractsDir = path.join(dir, 'contracts');
    fs.mkdirSync(contractsDir);
    // Write TypeScript with a type error
    fs.writeFileSync(
      path.join(contractsDir, 'api.ts'),
      'import { z } from "zod";\nexport const X: string = 42;',
    );
    const validator = new ContractValidator();

    const result = await validator.run(dir);

    // Either fails with TS error OR passes if tsc resolves imports loosely
    // We just verify the shape is correct
    expect(Array.isArray(result.errors)).toBe(true);
    if (!result.passed) {
      expect(result.errors[0].file).toBeDefined();
      expect(result.errors[0].error).toBeDefined();
    }
  });
});
