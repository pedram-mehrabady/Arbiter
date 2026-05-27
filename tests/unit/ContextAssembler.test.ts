import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContextAssembler } from '../../src/context/ContextAssembler';

const makeRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-ctx-'));

describe('ContextAssembler', () => {
  let root: string;
  let assembler: ContextAssembler;
  let taskDir: string;

  beforeEach(async () => {
    root = await makeRoot();
    assembler = new ContextAssembler(root);
    taskDir = path.join(root, '.arbiter', 'tasks', 'T1');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, 'task.md'), '# Feature\nDo the thing.', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('assemble returns ok with prompt and contextHash', async () => {
    const r = await assembler.assemble('reframe', taskDir, 'You are reframe.', 'My task');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.prompt).toContain('You are reframe.');
    expect(r.value.prompt).toContain('My task');
    expect(r.value.contextHash).toMatch(/^sha256:/);
    expect(r.value.pruned).toBe(false);
    expect(typeof r.value.tokenEstimate).toBe('number');
  });

  it('includes existing context files in prompt', async () => {
    const r = await assembler.assemble('reframe', taskDir, 'SYS', 'USER');
    if (!r.ok) return;
    expect(r.value.prompt).toContain('# Feature');
    expect(r.value.filesIncluded).toHaveLength(1);
  });

  it('skips missing optional context files without error', async () => {
    const r = await assembler.assemble('design', taskDir, 'SYS', 'USER');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // design needs research.json which doesn't exist — should not error
    expect(r.value.filesIncluded.every(f => f.includes('task.md') || f.includes('MASTER-DIRECTIVES'))).toBe(true);
  });

  it('loads template from agents/templates/<role>.md when systemPrompt is empty', async () => {
    const templatesDir = path.join(root, 'agents', 'templates');
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, 'reframe.md'), 'Template content for reframe', 'utf-8');

    const r = await assembler.assemble('reframe', taskDir, '', 'USER');
    if (!r.ok) return;
    expect(r.value.prompt).toContain('Template content for reframe');
  });

  it('substitutes template vars when provided', async () => {
    const templatesDir = path.join(root, 'agents', 'templates');
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(
      path.join(templatesDir, 'reframe.md'),
      'Project: {{PROJECT_NAME}}, Frontend: {{STACK_FRONTEND}}, DB: {{STACK_DATABASE}}',
      'utf-8',
    );

    const r = await assembler.assemble('reframe', taskDir, '', 'USER', undefined, {
      PROJECT_NAME: 'my-app',
      STACK_FRONTEND: 'react',
    });
    if (!r.ok) return;
    expect(r.value.prompt).toContain('Project: my-app');
    expect(r.value.prompt).toContain('Frontend: react');
    expect(r.value.prompt).toContain('DB: (not specified)');
  });

  it('clears unfilled placeholders to (not specified)', async () => {
    const templatesDir = path.join(root, 'agents', 'templates');
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, 'reframe.md'), '{{STACK_BACKEND}}', 'utf-8');

    const r = await assembler.assemble('reframe', taskDir, '', 'USER', undefined, {});
    if (!r.ok) return;
    expect(r.value.prompt).toContain('(not specified)');
    expect(r.value.prompt).not.toContain('{{STACK_BACKEND}}');
  });

  it('uses explicit systemPrompt even when template file exists', async () => {
    const templatesDir = path.join(root, 'agents', 'templates');
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, 'reframe.md'), 'Template content', 'utf-8');

    const r = await assembler.assemble('reframe', taskDir, 'Explicit system prompt', 'USER');
    if (!r.ok) return;
    expect(r.value.prompt).toContain('Explicit system prompt');
    expect(r.value.prompt).not.toContain('Template content');
  });

  it('overrideFiles replaces role context manifest', async () => {
    await fs.writeFile(path.join(taskDir, 'custom.md'), 'custom file content', 'utf-8');
    const r = await assembler.assemble('reframe', taskDir, 'SYS', 'USER', ['custom.md']);
    if (!r.ok) return;
    expect(r.value.prompt).toContain('custom file content');
  });

  it('getContextFiles returns manifest for known role', () => {
    const files = assembler.getContextFiles('reframe');
    expect(files).toContain('task.md');
  });

  it('getContextFiles returns empty array for unknown role', () => {
    expect(assembler.getContextFiles('unknown-role' as never)).toEqual([]);
  });

  it('produces deterministic contextHash for same inputs', async () => {
    const r1 = await assembler.assemble('reframe', taskDir, 'SYS', 'USER');
    const r2 = await assembler.assemble('reframe', taskDir, 'SYS', 'USER');
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.contextHash).toBe(r2.value.contextHash);
  });
});
