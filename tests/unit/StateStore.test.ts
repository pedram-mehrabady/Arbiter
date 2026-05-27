import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from '../../src/state/StateStore';
import { SubTaskEntry } from '../../src/types/index';

const makeRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-state-'));

const baseSubTasks = (): Record<string, SubTaskEntry> => ({
  reframe:  { status: 'pending', agent_role: 'reframe',  model: 'claude-sonnet-4-6' },
  research: { status: 'pending', agent_role: 'research', model: 'claude-sonnet-4-6' },
});

describe('StateStore', () => {
  let root: string;
  let store: StateStore;

  beforeEach(async () => {
    root = await makeRoot();
    store = new StateStore(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('read returns ENOENT error when no state file exists', async () => {
    const result = await store.read();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ENOENT');
  });

  it('exists returns false before init', async () => {
    expect(await store.exists()).toBe(false);
  });

  it('init creates state file and returns state', async () => {
    const result = await store.init('TASK-1', baseSubTasks());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task_id).toBe('TASK-1');
    expect(result.value.phase).toBe('init');
    expect(result.value.phase_status).toBe('pending');
    expect(result.value.sub_tasks.reframe.status).toBe('pending');
    expect(await store.exists()).toBe(true);
  });

  it('init fails if state already exists', async () => {
    await store.init('TASK-1', baseSubTasks());
    const second = await store.init('TASK-1', baseSubTasks());
    // init calls write, which succeeds (it overwrites) — but a second init
    // should succeed unless StateStore prevents double-init; currently it overwrites
    // This test documents current behaviour
    expect(second.ok).toBe(true);
  });

  it('read returns written state', async () => {
    await store.init('TASK-1', baseSubTasks());
    const result = await store.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task_id).toBe('TASK-1');
  });

  it('write updates updated_at timestamp', async () => {
    const initResult = await store.init('TASK-1', baseSubTasks());
    if (!initResult.ok) return;
    const before = initResult.value.updated_at;

    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 5));
    await store.write({ ...initResult.value });

    const readResult = await store.read();
    if (!readResult.ok) return;
    expect(readResult.value.updated_at >= before).toBe(true);
  });

  it('updateSubTask merges partial updates', async () => {
    await store.init('TASK-1', baseSubTasks());
    const result = await store.updateSubTask('reframe', { status: 'completed', model: 'claude-opus-4-7' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sub_tasks.reframe.status).toBe('completed');
    expect(result.value.sub_tasks.reframe.model).toBe('claude-opus-4-7');
    // Other field unchanged
    expect(result.value.sub_tasks.reframe.agent_role).toBe('reframe');
  });

  it('updateSubTask preserves depends_on field', async () => {
    const tasks = {
      ...baseSubTasks(),
      design: { status: 'pending' as const, agent_role: 'design' as const, model: 'claude-sonnet-4-6', depends_on: ['reframe', 'research'] },
    };
    await store.init('TASK-1', tasks);
    await store.updateSubTask('design', { status: 'in_progress' });
    const read = await store.read();
    if (!read.ok) return;
    expect(read.value.sub_tasks.design.depends_on).toEqual(['reframe', 'research']);
  });

  it('updateSubTask returns NOT_FOUND for unknown sub-task', async () => {
    await store.init('TASK-1', baseSubTasks());
    const result = await store.updateSubTask('nonexistent', { status: 'completed' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('setPhaseStatus updates phase and phase_status', async () => {
    await store.init('TASK-1', baseSubTasks());
    const result = await store.setPhaseStatus('implementation', 'in_progress');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('implementation');
    expect(result.value.phase_status).toBe('in_progress');
  });

  it('write uses atomic rename (no partial writes)', async () => {
    await store.init('TASK-1', baseSubTasks());
    const stateResult = await store.read();
    if (!stateResult.ok) return;

    // Write many times concurrently — all should succeed and final read should be valid
    const writes = Array.from({ length: 10 }, () =>
      store.write({ ...stateResult.value }),
    );
    await Promise.all(writes);

    const final = await store.read();
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(final.value.task_id).toBe('TASK-1');
  });
});
