import { describe, it, expect } from 'vitest';
import { ContextPruner } from '../../src/context/ContextPruner';
import { AssembledContext } from '../../src/types/index';

const SEP = '\n\n' + '─'.repeat(60) + '\n\n';

const makeCtx = (prompt: string, tokenEstimate?: number): AssembledContext => ({
  prompt,
  tokenEstimate: tokenEstimate ?? Math.ceil(prompt.length / 4),
  contextHash: 'sha256:abc',
  filesIncluded: [],
  pruned: false,
  prunedTokensSaved: 0,
});

describe('ContextPruner', () => {
  const pruner = new ContextPruner();

  it('returns context unchanged when under threshold', () => {
    const ctx = makeCtx('# SYSTEM\n\nHello', 100);
    const result = pruner.prune(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pruned).toBe(false);
    expect(result.value.prompt).toBe(ctx.prompt);
  });

  it('returns context unchanged when at threshold boundary', () => {
    const ctx = makeCtx('# SYSTEM\n\nHello', 70_000);
    const result = pruner.prune(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pruned).toBe(false);
  });

  it('prunes large non-protected section when over threshold', () => {
    const bigBody = 'x'.repeat(10_000);
    const prompt = `# SYSTEM\n\nSystem prompt${SEP}# FILE: big.ts\n\n${bigBody}${SEP}# TASK\n\nDo something`;
    const ctx = makeCtx(prompt, 100_000);
    const result = pruner.prune(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pruned).toBe(true);
    expect(result.value.prunedTokensSaved).toBeGreaterThan(0);
    expect(result.value.prompt).toContain('[PRUNED:');
  });

  it('never prunes # SYSTEM section', () => {
    const bigSystem = '# SYSTEM\n\n' + 'y'.repeat(10_000);
    const bigFile = '# FILE: big.ts\n\n' + 'x'.repeat(10_000);
    const prompt = `${bigSystem}${SEP}${bigFile}${SEP}# TASK\n\nDo something`;
    const ctx = makeCtx(prompt, 100_000);
    const result = pruner.prune(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prompt).toContain('y'.repeat(100));
  });

  it('never prunes # TASK section', () => {
    const bigFile = '# FILE: big.ts\n\n' + 'x'.repeat(10_000);
    const taskBody = 'IMPORTANT TASK CONTENT';
    const prompt = `# SYSTEM\n\nSys${SEP}${bigFile}${SEP}# TASK\n\n${taskBody}`;
    const ctx = makeCtx(prompt, 100_000);
    const result = pruner.prune(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prompt).toContain(taskBody);
  });

  it('never prunes # FILE: task.md section', () => {
    const taskMd = '# FILE: task.md\n\nCRITICAL SPEC';
    const bigFile = '# FILE: big.ts\n\n' + 'x'.repeat(10_000);
    const prompt = `# SYSTEM\n\nSys${SEP}${taskMd}${SEP}${bigFile}${SEP}# TASK\n\nDo`;
    const ctx = makeCtx(prompt, 100_000);
    const result = pruner.prune(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prompt).toContain('CRITICAL SPEC');
  });

  it('does not prune sections smaller than 200 tokens', () => {
    const smallBody = 'small content';
    const bigBody = 'x'.repeat(10_000);
    const prompt = `# SYSTEM\n\nSys${SEP}# FILE: small.ts\n\n${smallBody}${SEP}# FILE: big.ts\n\n${bigBody}${SEP}# TASK\n\nDo`;
    const ctx = makeCtx(prompt, 100_000);
    const result = pruner.prune(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prompt).toContain(smallBody);
  });
});
