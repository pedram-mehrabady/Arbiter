import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import {
  TaskState,
  SubTaskEntry,
  TaskPhaseStatus,
  ServiceResult,
  TaskRow,
  SubTaskRow,
  OrchestratorStateRow,
} from '../types/index';

const ARBITER_DIR = 'arbiter';

export class SqliteStore {
  private db: Database.Database;
  readonly filePath: string;

  constructor(workspaceRoot: string) {
    const dbDir = path.join(workspaceRoot, ARBITER_DIR);
    fs.mkdirSync(dbDir, { recursive: true });
    this.filePath = path.join(dbDir, 'state.db');
    this.db = new Database(this.filePath);
    this.configure();
    this.migrate();
  }

  private configure(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id    TEXT PRIMARY KEY,
        tier       INTEGER NOT NULL DEFAULT 3,
        pipeline   TEXT NOT NULL DEFAULT 'full',
        profile    TEXT NOT NULL DEFAULT 'unknown',
        status     TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sub_tasks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id       TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
        agent_role    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        model         TEXT,
        input_tokens  INTEGER,
        output_tokens INTEGER,
        elapsed_ms    INTEGER,
        started_at    TEXT,
        completed_at  TEXT,
        output_hash   TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
        event_type  TEXT NOT NULL,
        payload     TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orchestrator_state (
        task_id      TEXT PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
        phase        TEXT NOT NULL DEFAULT 'init',
        summary      TEXT,
        chat_history TEXT NOT NULL DEFAULT '[]'
      );
    `);
  }

  // ─── TaskState compatibility layer (mirrors StateStore interface) ─────────

  read(taskId?: string): ServiceResult<TaskState> {
    const rows = this.db
      .prepare('SELECT * FROM sub_tasks WHERE task_id = ?')
      .all(taskId ?? '') as SubTaskRow[];

    if (rows.length === 0 && taskId) {
      return { ok: false, error: `State not found for task ${taskId} — run arbiter init first`, code: 'ENOENT' };
    }

    const taskRow = this.db
      .prepare('SELECT * FROM tasks WHERE task_id = ?')
      .get(taskId ?? '') as TaskRow | undefined;

    if (!taskRow) {
      return { ok: false, error: `Task ${taskId ?? '(none)'} not found`, code: 'ENOENT' };
    }

    const subTasks: Record<string, SubTaskEntry> = {};
    for (const r of rows) {
      subTasks[r.agent_role] = {
        status: r.status as SubTaskEntry['status'],
        agent_role: r.agent_role as SubTaskEntry['agent_role'],
        model: r.model ?? '',
        completed_at: r.completed_at ?? undefined,
        output_hash: r.output_hash ?? undefined,
      };
    }

    return {
      ok: true,
      value: {
        task_id: taskRow.task_id,
        phase: taskRow.status,
        phase_status: taskRow.status as TaskPhaseStatus,
        created_at: taskRow.created_at,
        updated_at: taskRow.updated_at,
        sub_tasks: subTasks,
      },
    };
  }

  write(state: TaskState): ServiceResult<void> {
    const now = new Date().toISOString();
    const upsertTask = this.db.prepare(`
      INSERT INTO tasks (task_id, tier, pipeline, profile, status, created_at, updated_at)
      VALUES (@task_id, @tier, @pipeline, @profile, @status, @created_at, @updated_at)
      ON CONFLICT(task_id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    upsertTask.run({
      task_id: state.task_id,
      tier: 3,
      pipeline: 'full',
      profile: 'unknown',
      status: state.phase_status,
      created_at: state.created_at,
      updated_at: now,
    });

    const upsertSub = this.db.prepare(`
      INSERT INTO sub_tasks (task_id, agent_role, status, model, completed_at, output_hash)
      VALUES (@task_id, @agent_role, @status, @model, @completed_at, @output_hash)
      ON CONFLICT DO NOTHING
    `);

    const updateSub = this.db.prepare(`
      UPDATE sub_tasks SET status = @status, model = @model,
        completed_at = @completed_at, output_hash = @output_hash
      WHERE task_id = @task_id AND agent_role = @agent_role
    `);

    const writeAll = this.db.transaction(() => {
      for (const [role, entry] of Object.entries(state.sub_tasks)) {
        const params = {
          task_id: state.task_id,
          agent_role: role,
          status: entry.status,
          model: entry.model ?? null,
          completed_at: entry.completed_at ?? null,
          output_hash: entry.output_hash ?? null,
        };
        const existing = this.db
          .prepare('SELECT id FROM sub_tasks WHERE task_id = ? AND agent_role = ?')
          .get(state.task_id, role);
        if (existing) {
          updateSub.run(params);
        } else {
          upsertSub.run(params);
        }
      }
    });

    writeAll();
    return { ok: true, value: undefined };
  }

  init(taskId: string, subTasks: Record<string, SubTaskEntry>): ServiceResult<TaskState> {
    const now = new Date().toISOString();
    const state: TaskState = {
      task_id: taskId,
      phase: 'init',
      phase_status: 'pending',
      created_at: now,
      updated_at: now,
      sub_tasks: subTasks,
    };
    return this.write(state).ok ? { ok: true, value: state } : { ok: false, error: 'init failed' };
  }

  updateSubTask(subTaskId: string, updates: Partial<SubTaskEntry>): ServiceResult<TaskState> {
    const existing = this.db
      .prepare('SELECT * FROM sub_tasks WHERE agent_role = ? LIMIT 1')
      .get(subTaskId) as SubTaskRow | undefined;

    if (!existing) {
      return { ok: false, error: `Sub-task "${subTaskId}" not found`, code: 'NOT_FOUND' };
    }

    this.db.prepare(`
      UPDATE sub_tasks SET
        status = COALESCE(@status, status),
        model = COALESCE(@model, model),
        completed_at = COALESCE(@completed_at, completed_at),
        output_hash = COALESCE(@output_hash, output_hash)
      WHERE task_id = @task_id AND agent_role = @agent_role
    `).run({
      task_id: existing.task_id,
      agent_role: subTaskId,
      status: updates.status ?? null,
      model: updates.model ?? null,
      completed_at: updates.completed_at ?? null,
      output_hash: updates.output_hash ?? null,
    });

    return this.read(existing.task_id);
  }

  setPhaseStatus(taskId: string, phase: string, status: TaskPhaseStatus): ServiceResult<TaskState> {
    this.db.prepare(`
      UPDATE tasks SET phase = ?, status = ?, updated_at = ? WHERE task_id = ?
    `).run(phase, status, new Date().toISOString(), taskId);

    return this.read(taskId);
  }

  exists(taskId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM tasks WHERE task_id = ?')
      .get(taskId);
    return row !== undefined;
  }

  // ─── Extended API (used by Triage, Iron Funnel, Orchestrator) ─────────────

  upsertTask(row: Partial<TaskRow> & Pick<TaskRow, 'task_id'>): void {
    const now = new Date().toISOString();
    const existing = this.getTask(row.task_id);
    this.db.prepare(`
      INSERT INTO tasks (task_id, tier, pipeline, profile, status, created_at, updated_at)
      VALUES (@task_id, @tier, @pipeline, @profile, @status, @created_at, @updated_at)
      ON CONFLICT(task_id) DO UPDATE SET
        tier = excluded.tier,
        pipeline = excluded.pipeline,
        profile = excluded.profile,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run({
      task_id: row.task_id,
      tier: row.tier ?? existing?.tier ?? 3,
      pipeline: row.pipeline ?? existing?.pipeline ?? 'full',
      profile: row.profile ?? existing?.profile ?? 'unknown',
      status: row.status ?? existing?.status ?? 'pending',
      created_at: row.created_at ?? existing?.created_at ?? now,
      updated_at: row.updated_at ?? now,
    });
  }

  getTask(taskId: string): TaskRow | undefined {
    return this.db
      .prepare('SELECT * FROM tasks WHERE task_id = ?')
      .get(taskId) as TaskRow | undefined;
  }

  upsertSubTask(row: Omit<SubTaskRow, 'id'>): void {
    this.db.prepare(`
      INSERT INTO sub_tasks (task_id, agent_role, status, model, input_tokens, output_tokens,
        elapsed_ms, started_at, completed_at, output_hash)
      VALUES (@task_id, @agent_role, @status, @model, @input_tokens, @output_tokens,
        @elapsed_ms, @started_at, @completed_at, @output_hash)
      ON CONFLICT DO NOTHING
    `).run({
      task_id: row.task_id,
      agent_role: row.agent_role,
      status: row.status,
      model: row.model ?? null,
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
      elapsed_ms: row.elapsed_ms ?? null,
      started_at: row.started_at ?? null,
      completed_at: row.completed_at ?? null,
      output_hash: row.output_hash ?? null,
    });

    this.db.prepare(`
      UPDATE sub_tasks SET
        status = @status,
        model = COALESCE(@model, model),
        input_tokens = COALESCE(@input_tokens, input_tokens),
        output_tokens = COALESCE(@output_tokens, output_tokens),
        elapsed_ms = COALESCE(@elapsed_ms, elapsed_ms),
        started_at = COALESCE(@started_at, started_at),
        completed_at = COALESCE(@completed_at, completed_at),
        output_hash = COALESCE(@output_hash, output_hash)
      WHERE task_id = @task_id AND agent_role = @agent_role
    `).run({
      task_id: row.task_id,
      agent_role: row.agent_role,
      status: row.status,
      model: row.model ?? null,
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
      elapsed_ms: row.elapsed_ms ?? null,
      started_at: row.started_at ?? null,
      completed_at: row.completed_at ?? null,
      output_hash: row.output_hash ?? null,
    });
  }

  appendEvent(taskId: string, eventType: string, payload: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT INTO events (task_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?)
    `).run(taskId, eventType, JSON.stringify(payload), new Date().toISOString());
  }

  getEvents(taskId: string, eventType?: string): Array<{ id: number; event_type: string; payload: string; created_at: string }> {
    if (eventType) {
      return this.db
        .prepare('SELECT * FROM events WHERE task_id = ? AND event_type = ? ORDER BY id')
        .all(taskId, eventType) as Array<{ id: number; event_type: string; payload: string; created_at: string }>;
    }
    return this.db
      .prepare('SELECT * FROM events WHERE task_id = ? ORDER BY id')
      .all(taskId) as Array<{ id: number; event_type: string; payload: string; created_at: string }>;
  }

  getOrchestratorState(taskId: string): OrchestratorStateRow | undefined {
    return this.db
      .prepare('SELECT * FROM orchestrator_state WHERE task_id = ?')
      .get(taskId) as OrchestratorStateRow | undefined;
  }

  setOrchestratorState(taskId: string, row: Omit<OrchestratorStateRow, 'task_id'>): void {
    this.db.prepare(`
      INSERT INTO orchestrator_state (task_id, phase, summary, chat_history)
      VALUES (@task_id, @phase, @summary, @chat_history)
      ON CONFLICT(task_id) DO UPDATE SET
        phase = excluded.phase,
        summary = excluded.summary,
        chat_history = excluded.chat_history
    `).run({ task_id: taskId, ...row });
  }

  close(): void {
    this.db.close();
  }
}
