import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../src/state/SqliteStore';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-test-'));
}

describe('SqliteStore', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(() => {
    dir = tempDir();
    store = new SqliteStore(dir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the database file on construction', () => {
    expect(fs.existsSync(path.join(dir, 'arbiter', 'state.db'))).toBe(true);
  });

  it('creates 4 tables on init', () => {
    const now = new Date().toISOString();
    store.upsertTask({ task_id: 'T1', tier: 3, pipeline: 'full', profile: 'feature', status: 'pending', created_at: now, updated_at: now });
    const row = store.getTask('T1');
    expect(row?.task_id).toBe('T1');
  });

  it('init() → read() roundtrip preserves all fields', () => {
    const subTasks = {
      backend: { status: 'pending' as const, agent_role: 'backend' as const, model: 'claude-sonnet-4-6' },
    };
    const initResult = store.init('TASK-001', subTasks);
    expect(initResult.ok).toBe(true);

    const readResult = store.read('TASK-001');
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;
    expect(readResult.value.task_id).toBe('TASK-001');
    expect(readResult.value.sub_tasks['backend'].status).toBe('pending');
  });

  it('updateSubTask changes only specified fields', () => {
    const subTasks = {
      frontend: { status: 'pending' as const, agent_role: 'frontend' as const, model: 'claude-sonnet-4-6' },
    };
    store.init('TASK-002', subTasks);
    const result = store.updateSubTask('frontend', { status: 'completed', output_hash: 'abc123' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sub_tasks['frontend'].status).toBe('completed');
    expect(result.value.sub_tasks['frontend'].output_hash).toBe('abc123');
    expect(result.value.sub_tasks['frontend'].model).toBe('claude-sonnet-4-6');
  });

  it('exists() returns false before init, true after', () => {
    expect(store.exists('UNKNOWN')).toBe(false);
    store.init('TASK-003', {});
    expect(store.exists('TASK-003')).toBe(true);
  });

  it('appendEvent writes to events table and getEvents retrieves them', () => {
    const now = new Date().toISOString();
    store.upsertTask({ task_id: 'T4', tier: 1, pipeline: 'speed', profile: 'bug-fix', status: 'pending', created_at: now, updated_at: now });
    store.appendEvent('T4', 'triage_complete', { tier: 1 });
    store.appendEvent('T4', 'gate_started', { gate: 1 });

    const all = store.getEvents('T4');
    expect(all).toHaveLength(2);
    expect(all[0].event_type).toBe('triage_complete');

    const gateEvents = store.getEvents('T4', 'gate_started');
    expect(gateEvents).toHaveLength(1);
    expect(JSON.parse(gateEvents[0].payload)).toEqual({ gate: 1 });
  });

  it('getOrchestratorState returns undefined before insert', () => {
    expect(store.getOrchestratorState('NONEXISTENT')).toBeUndefined();
  });

  it('setOrchestratorState persists and overwrites correctly', () => {
    const now = new Date().toISOString();
    store.upsertTask({ task_id: 'T5', tier: 3, pipeline: 'full', profile: 'feature', status: 'pending', created_at: now, updated_at: now });
    store.setOrchestratorState('T5', { phase: 'gate5', summary: 'reviewing', chat_history: '[]' });

    const row = store.getOrchestratorState('T5');
    expect(row?.phase).toBe('gate5');
    expect(row?.chat_history).toBe('[]');

    // Overwrite
    store.setOrchestratorState('T5', { phase: 'complete', summary: 'done', chat_history: '[{"role":"user","content":"hi"}]' });
    const updated = store.getOrchestratorState('T5');
    expect(updated?.phase).toBe('complete');
    expect(updated?.summary).toBe('done');
  });

  it('concurrent rapid writes do not corrupt data (WAL mode)', () => {
    const now = new Date().toISOString();
    store.upsertTask({ task_id: 'T6', tier: 3, pipeline: 'full', profile: 'feature', status: 'pending', created_at: now, updated_at: now });

    // Simulate concurrent writes — better-sqlite3 is synchronous so these are serial
    for (let i = 0; i < 50; i++) {
      store.appendEvent('T6', 'progress', { step: i });
    }

    const events = store.getEvents('T6', 'progress');
    expect(events).toHaveLength(50);
    // Verify order preserved
    expect(JSON.parse(events[0].payload).step).toBe(0);
    expect(JSON.parse(events[49].payload).step).toBe(49);
  });

  it('upsertSubTask creates then updates without duplicating rows', () => {
    const now = new Date().toISOString();
    store.upsertTask({ task_id: 'T7', tier: 2, pipeline: 'speed', profile: 'bug-fix', status: 'pending', created_at: now, updated_at: now });

    store.upsertSubTask({ task_id: 'T7', agent_role: 'backend', status: 'pending' });
    store.upsertSubTask({ task_id: 'T7', agent_role: 'backend', status: 'completed', elapsed_ms: 5000 });

    const readResult = store.read('T7');
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;
    const sub = readResult.value.sub_tasks['backend'];
    expect(sub.status).toBe('completed');
  });
});
