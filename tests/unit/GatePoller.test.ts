import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GatePoller } from '../../src/gates/GatePoller';
import { DecisionLog } from '../../src/decisions/DecisionLog';

const makeRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-gate-'));

describe('GatePoller', () => {
  let root: string;
  let poller: GatePoller;

  beforeEach(async () => {
    root = await makeRoot();
    poller = new GatePoller(root, new DecisionLog(root));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('listPending returns empty array when no gates file exists', async () => {
    const r = await poller.listPending();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it('createGate returns error for unknown gate type', async () => {
    const r = await poller.createGate('T1', 'unknown_type' as never, 'ctx');
    expect(r.ok).toBe(false);
  });

  it('createGate writes a pending gate and returns definition', async () => {
    const r = await poller.createGate('T1', 'design_approval', 'design context');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.task_id).toBe('T1');
    expect(r.value.type).toBe('design_approval');
    expect(r.value.status).toBe('pending');
    expect(r.value.gate_id).toMatch(/^gate-design_approval-T1-/);
  });

  it('listPending returns only pending gates', async () => {
    const g1 = await poller.createGate('T1', 'design_approval', 'ctx');
    const g2 = await poller.createGate('T2', 'plan_approval', 'ctx');
    if (!g1.ok || !g2.ok) return;

    await poller.resolve(g1.value.gate_id, 'approved');

    const pending = await poller.listPending();
    if (!pending.ok) return;
    expect(pending.value).toHaveLength(1);
    expect(pending.value[0].gate_id).toBe(g2.value.gate_id);
  });

  it('listPending filters by taskId when provided', async () => {
    await poller.createGate('T1', 'design_approval', 'ctx');
    await poller.createGate('T2', 'plan_approval', 'ctx');

    const r = await poller.listPending('T1');
    if (!r.ok) return;
    expect(r.value).toHaveLength(1);
    expect(r.value[0].task_id).toBe('T1');
  });

  describe('resolve()', () => {
    it('resolves a pending gate to approved', async () => {
      const c = await poller.createGate('T1', 'design_approval', 'ctx');
      if (!c.ok) return;
      const r = await poller.resolve(c.value.gate_id, 'approved', 'LGTM');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.status).toBe('approved');
      expect(r.value.comment).toBe('LGTM');
      expect(r.value.resolved_at).toBeDefined();
    });

    it('resolves a pending gate to rejected', async () => {
      const c = await poller.createGate('T1', 'plan_approval', 'ctx');
      if (!c.ok) return;
      const r = await poller.resolve(c.value.gate_id, 'rejected', 'needs work');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.status).toBe('rejected');
    });

    it('returns error for non-existent gate id', async () => {
      const r = await poller.resolve('gate-nonexistent', 'approved');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('NOT_FOUND');
    });

    it('returns error when gate already resolved', async () => {
      const c = await poller.createGate('T1', 'design_approval', 'ctx');
      if (!c.ok) return;
      await poller.resolve(c.value.gate_id, 'approved');
      const r2 = await poller.resolve(c.value.gate_id, 'rejected');
      expect(r2.ok).toBe(false);
    });
  });

  describe('clearTask()', () => {
    it('removes all gates for a task and returns count', async () => {
      await poller.createGate('T1', 'design_approval', 'ctx');
      await poller.createGate('T1', 'plan_approval', 'ctx');
      await poller.createGate('T2', 'design_approval', 'ctx');

      const r = await poller.clearTask('T1');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toBe(2);

      const remaining = await poller.listPending();
      if (!remaining.ok) return;
      expect(remaining.value).toHaveLength(1);
      expect(remaining.value[0].task_id).toBe('T2');
    });

    it('returns 0 when task has no gates', async () => {
      const r = await poller.clearTask('NONEXISTENT');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toBe(0);
    });

    it('sequential creates all persist correctly (write integrity)', async () => {
      // createGate is read-modify-write; sequential calls must all survive.
      // Concurrent cross-process safety is guaranteed by unique tmp filenames
      // (tested via the rename-rename idiom — not tested here since it requires
      // two real OS processes).
      for (let i = 0; i < 5; i++) {
        await poller.createGate(`TASK-${i}`, 'design_approval', `ctx-${i}`);
      }
      const r = await poller.listPending();
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toHaveLength(5);
    });
  });
});
