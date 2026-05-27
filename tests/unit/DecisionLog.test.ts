import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DecisionLog } from '../../src/decisions/DecisionLog';

const makeRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-log-'));

describe('DecisionLog', () => {
  let root: string;
  let log: DecisionLog;

  beforeEach(async () => {
    root = await makeRoot();
    log = new DecisionLog(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('readAll returns empty array when file does not exist', async () => {
    const r = await log.readAll();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it('append creates file and writes a JSONL entry', async () => {
    const r = await log.append({ task_id: 'T1', event: 'task_init', detail: 'test' });
    expect(r.ok).toBe(true);
    const all = await log.readAll();
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.value).toHaveLength(1);
    expect(all.value[0].task_id).toBe('T1');
    expect(all.value[0].event).toBe('task_init');
    expect(typeof all.value[0].ts).toBe('string');
  });

  it('append adds entries without overwriting existing ones', async () => {
    await log.append({ task_id: 'T1', event: 'task_init', detail: 'first' });
    await log.append({ task_id: 'T1', event: 'agent_start', detail: 'second' });
    const all = await log.readAll();
    if (!all.ok) return;
    expect(all.value).toHaveLength(2);
  });

  it('logAgentStart writes correct event', async () => {
    await log.logAgentStart('T1', 'reframe', 'reframe', 'claude-sonnet-4-6');
    const all = await log.readAll();
    if (!all.ok) return;
    expect(all.value[0].event).toBe('agent_start');
    expect(all.value[0].agent_role).toBe('reframe');
    expect(all.value[0].model).toBe('claude-sonnet-4-6');
  });

  it('logAgentComplete writes receipt id in detail', async () => {
    await log.logAgentComplete('T1', 'reframe', 'reframe', 'rec_123');
    const all = await log.readAll();
    if (!all.ok) return;
    expect(all.value[0].event).toBe('agent_complete');
    expect(all.value[0].detail).toContain('rec_123');
  });

  it('logFailure writes failure class and strike count', async () => {
    await log.logFailure('T1', 'reframe', 'stochastic', 1, 'timeout');
    const all = await log.readAll();
    if (!all.ok) return;
    expect(all.value[0].event).toBe('agent_failure');
    expect(all.value[0].detail).toContain('stochastic');
    expect(all.value[0].detail).toContain('strike=1');
  });

  it('logGateCreated and logGateResolved write correct events', async () => {
    await log.logGateCreated('T1', 'gate-abc', 'design_approval');
    await log.logGateResolved('T1', 'gate-abc', 'approved');
    const all = await log.readAll();
    if (!all.ok) return;
    expect(all.value[0].event).toBe('gate_created');
    expect(all.value[1].event).toBe('gate_resolved');
    expect(all.value[1].detail).toContain('approved');
  });

  it('logPreflightReject writes preflight_reject event', async () => {
    await log.logPreflightReject('T1', 'reframe', 'missing_file', '/path/task.md');
    const all = await log.readAll();
    if (!all.ok) return;
    expect(all.value[0].event).toBe('preflight_reject');
    expect(all.value[0].detail).toContain('missing_file');
  });
});
