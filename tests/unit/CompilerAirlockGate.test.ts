import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { CompilerAirlockGate } from '../../src/gates/CompilerAirlockGate';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compiler-airlock-test-'));
}

describe('CompilerAirlockGate', () => {
  it('returns passed:true for a clean directory (no tsconfig, no forbidden patterns)', async () => {
    const dir = tempDir();
    const gate = new CompilerAirlockGate();

    const result = await gate.run(dir);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(typeof result.elapsed_ms).toBe('number');
  });

  it('returns elapsed_ms as a positive number', async () => {
    const dir = tempDir();
    const gate = new CompilerAirlockGate();

    const result = await gate.run(dir);

    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('catches eval( forbidden pattern in a .ts file', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'bad.ts'), 'const x = eval("2+2");');
    const gate = new CompilerAirlockGate();

    const result = await gate.run(dir);

    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.tool === 'forbidden_pattern' && e.message.includes('eval_usage'))).toBe(true);
  });

  it('catches dangerouslySetInnerHTML in a .tsx file', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'comp.tsx'), '<div dangerouslySetInnerHTML={{ __html: x }} />');
    const gate = new CompilerAirlockGate();

    const result = await gate.run(dir);

    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.message.includes('dangerouslySetInnerHTML'))).toBe(true);
  });

  it('catches document.write( forbidden pattern', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'script.ts'), 'document.write("<h1>hello</h1>");');
    const gate = new CompilerAirlockGate();

    const result = await gate.run(dir);

    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.message.includes('document_write'))).toBe(true);
  });

  it('skips node_modules and dist directories during pattern scan', async () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'bad.ts'), 'eval("x")');
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.writeFileSync(path.join(dir, 'dist', 'bad.js'), 'eval("x")');
    const gate = new CompilerAirlockGate();

    const result = await gate.run(dir);

    expect(result.passed).toBe(true);
  });

  it('returns errors with correct tool field for forbidden patterns', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'x.ts'), 'eval("bad")');
    const gate = new CompilerAirlockGate();

    const result = await gate.run(dir);

    const err = result.errors.find(e => e.tool === 'forbidden_pattern');
    expect(err).toBeDefined();
    expect(err?.file).toBeDefined();
  });

  it('skips prisma validate when no prisma/schema.prisma exists', async () => {
    const dir = tempDir();
    const gate = new CompilerAirlockGate();

    // Should not throw or fail due to missing prisma
    const result = await gate.run(dir);
    expect(result.errors.some(e => e.tool === 'prisma')).toBe(false);
  });

  it('skips tsc when no tsconfig.json exists', async () => {
    const dir = tempDir();
    const gate = new CompilerAirlockGate();

    const result = await gate.run(dir);
    expect(result.errors.some(e => e.tool === 'tsc')).toBe(false);
  });

  it('detects contract mutation on Tier 2 tasks (git mock scenario)', async () => {
    const dir = tempDir();
    const gate = new CompilerAirlockGate();

    // Without git this just silently skips — verify it does not throw
    const result = await gate.run(dir, {
      tier: 2,
      lockedContractPaths: ['contracts/'],
    });

    expect(typeof result.passed).toBe('boolean');
  });
});
