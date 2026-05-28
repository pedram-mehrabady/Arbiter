import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskInitializer } from '../../src/task/TaskInitializer';

const makeRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-task-'));

describe('TaskInitializer', () => {
  let root: string;
  let initializer: TaskInitializer;
  let specFile: string;

  beforeEach(async () => {
    root = await makeRoot();
    initializer = new TaskInitializer(root);
    specFile = path.join(root, 'spec.md');
    await fs.writeFile(specFile, '# My Feature\n\nAdd a button.', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('init creates task directory and task.md', async () => {
    const r = await initializer.init({ taskId: 'feat-1', specFile, workspaceRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const taskMd = path.join(root, '.arbiter', 'tasks', 'feat-1', 'task.md');
    const content = await fs.readFile(taskMd, 'utf-8');
    expect(content).toContain('Add a button');
  });

  it('init writes state.json with all 11 standard sub-tasks', async () => {
    const r = await initializer.init({ taskId: 'feat-1', specFile, workspaceRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.subTaskCount).toBe(11);
    // Per-task state lives at .arbiter/tasks/<taskId>/state.json
    const stateRaw = await fs.readFile(
      path.join(root, '.arbiter', 'tasks', 'feat-1', 'state.json'),
      'utf-8',
    );
    const state = JSON.parse(stateRaw);
    expect(state.task_id).toBe('feat-1');
    expect(Object.keys(state.sub_tasks)).toHaveLength(11);
  });

  it('init returns paths to taskDir and stateFile', async () => {
    const r = await initializer.init({ taskId: 'feat-1', specFile, workspaceRoot: root });
    if (!r.ok) return;
    expect(r.value.taskDir).toContain('feat-1');
    expect(r.value.stateFile).toContain('state.json');
  });

  it('init respects skipAgents and reduces sub-task count', async () => {
    const r = await initializer.init({
      taskId: 'feat-1',
      specFile,
      workspaceRoot: root,
      skipAgents: ['frontend', 'tech-writer'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.subTaskCount).toBe(9);
    expect(Object.keys(r.value.pipeline.reduce((a, s) => ({ ...a, [s.id]: s }), {}))).not.toContain('frontend');
  });

  it('allows multiple different tasks to coexist in the same workspace', async () => {
    await initializer.init({ taskId: 'feat-1', specFile, workspaceRoot: root });
    const r2 = await initializer.init({ taskId: 'feat-2', specFile, workspaceRoot: root });
    // Per-task state isolation: each task has its own .arbiter/tasks/<id>/state.json
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.taskId).toBe('feat-2');
  });

  it('returns ALREADY_INIT when the same task id is used twice', async () => {
    await initializer.init({ taskId: 'feat-1', specFile, workspaceRoot: root });
    const r2 = await initializer.init({ taskId: 'feat-1', specFile, workspaceRoot: root });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('ALREADY_INIT');
  });

  it('returns error when spec file does not exist', async () => {
    const r = await initializer.init({
      taskId: 'feat-1',
      specFile: path.join(root, 'nonexistent.md'),
      workspaceRoot: root,
    });
    expect(r.ok).toBe(false);
  });

  describe('describePipeline()', () => {
    it('returns a string with all 11 pipeline steps', () => {
      const desc = TaskInitializer.describePipeline();
      expect(desc).toContain('reframe');
      expect(desc).toContain('tech-writer');
      const lines = desc.split('\n').filter(Boolean);
      expect(lines).toHaveLength(11);
    });

    it('excludes skipped agents', () => {
      const desc = TaskInitializer.describePipeline(['frontend']);
      expect(desc).not.toContain('frontend');
    });

    it('adjusts dependency labels when deps are skipped', () => {
      const desc = TaskInitializer.describePipeline(['frontend']);
      expect(desc).toContain('test-writer');
    });
  });
});
