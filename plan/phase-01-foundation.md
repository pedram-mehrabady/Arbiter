# Phase 01 — Foundation: SQLite + WorktreeManager + Playwright
# Status: [x] COMPLETE — 2026-05-28
# Prerequisite: None — this is the base.

## Objective
Replace the JSON state store with SQLite (better-sqlite3, synchronous, WAL mode).
Refactor GitAutoCommit into WorktreeManager that isolates agent writes to git worktrees.
Set up Playwright for integration tests used in later phases.
After this phase: `arbiter init`, `arbiter run`, all existing CLI commands, and the
dashboard all continue to work — now backed by SQLite instead of JSON files.

---

## Deliverables

### 1. Install Dependencies
```
better-sqlite3          (production dependency)
@types/better-sqlite3   (dev dependency)
@playwright/test        (dev dependency — dashboard/ package.json)
```

### 2. src/state/SqliteStore.ts  [NEW]
Full replacement for StateStore.ts. Implements identical public interface so Conductor
import is a one-line swap.

Schema (4 tables):
- tasks(task_id PK, tier INT, pipeline TEXT, profile TEXT, status TEXT, created_at, updated_at)
- sub_tasks(id AUTOINCREMENT, task_id FK, agent_role, status, model, input_tokens,
  output_tokens, elapsed_ms, started_at, completed_at, output_hash)
- events(id AUTOINCREMENT, task_id FK, event_type, payload JSON, created_at)
- orchestrator_state(task_id PK FK, phase, summary, chat_history JSON DEFAULT '[]')

Pragmas: WAL mode, foreign_keys ON, synchronous NORMAL.
DB path: `{workspaceRoot}/.arbiter/state.db` (Phase 08 renames to arbiter/state.db)

Public methods (must match StateStore interface):
- read(taskId?: string): ServiceResult<TaskState>
- write(state: TaskState): ServiceResult<void>  [synchronous]
- init(taskId, subTasks): ServiceResult<TaskState>
- updateSubTask(subTaskId, updates): ServiceResult<TaskState>
- setPhaseStatus(phase, status): ServiceResult<TaskState>
- exists(): boolean

Additional methods (new, used by later phases):
- upsertTask(task: TaskRow): void
- getTask(taskId: string): TaskRow | undefined
- upsertSubTask(row: SubTaskRow): void
- appendEvent(taskId, eventType, payload): void
- getOrchestratorState(taskId): OrchestratorStateRow | undefined
- setOrchestratorState(taskId, row): void

### 3. src/git/WorktreeManager.ts  [NEW]
Wraps GitAutoCommit. Adds worktree create/delete/merge.

Public interface:
- create(taskId: string, branchName: string): Promise<ServiceResult<string>>
  → runs: git worktree add ../arbiter-{taskId} -b {branchName}
  → returns worktree absolute path
- getPath(taskId: string): string
  → returns ../arbiter-{taskId} path relative to workspaceRoot
- delete(taskId: string): Promise<ServiceResult<void>>
  → runs: git worktree remove --force ../arbiter-{taskId}
- commit(taskId, subTaskId, agentRole): Promise<ServiceResult<string>>
  → delegates to GitAutoCommit inside worktree path
- listActive(): Promise<ServiceResult<string[]>>
  → runs: git worktree list --porcelain, parses output

GitAutoCommit.ts stays unchanged. WorktreeManager uses it internally.

### 4. src/types/index.ts  [MODIFIED]
Add:
- TriageResult interface (tier 1|2|3, profile, reason, bypass_phase1, estimated_agents, complexity_hint)
- WorktreeConfig interface
- TaskRow interface (for SQLite tasks table)
- SubTaskRow interface (for SQLite sub_tasks table)
- OrchestratorStateRow interface
- IronFunnelGateResult interface
- Extend PipelineName: 'standard' | 'fast' | 'full' | 'speed'  (keep old values for compat)
- Extend AgentRole: add 'triage' | 'investigator' | 'orchestrator'

### 5. src/conductor/Conductor.ts  [MODIFIED]
- Import SqliteStore instead of StateStore
- Constructor: new SqliteStore(root) instead of new StateStore(root)
- WorktreeManager instantiated alongside GitAutoCommit
- All state reads/writes use SqliteStore
- Existing logic unchanged — interface is the same

### 6. .gitignore  [MODIFIED]
Add: `.arbiter/state.db`

### 7. .gitattributes  [MODIFIED or NEW]
Add LFS rules:
```
.arbiter/tasks/**/*-output.md filter=lfs diff=lfs merge=lfs -text
.arbiter/tasks/**/summaries/*.md filter=lfs diff=lfs merge=lfs -text
.arbiter/tasks/**/research-output.md filter=lfs diff=lfs merge=lfs -text
.arbiter/tasks/**/reframe-output.md filter=lfs diff=lfs merge=lfs -text
```

### 8. dashboard/playwright.config.ts  [NEW]
Basic Playwright config:
- baseURL: http://localhost:3070
- testDir: dashboard/e2e/
- reporter: list
- use: { headless: true }

### 9. dashboard/e2e/smoke.spec.ts  [NEW]
Smoke test: dashboard loads, no console errors, title visible.
This test runs in every subsequent phase to catch regressions.

---

## Tests Required

### Unit tests
- tests/unit/SqliteStore.test.ts  [NEW]
  - init creates 4 tables
  - write + read roundtrip preserves all fields
  - updateSubTask updates only specified fields
  - concurrent writes do not corrupt (WAL mode test: two rapid writes)
  - exists() returns false before init, true after
  - appendEvent writes to events table
  - getOrchestratorState returns null before insert

- tests/unit/WorktreeManager.test.ts  [NEW]
  - create calls git worktree add with correct args (mock execFile)
  - getPath returns correct path
  - delete calls git worktree remove with --force
  - listActive parses git worktree list output

### Existing tests
All 19 existing unit tests must continue to pass unchanged.
StateStore.test.ts continues to test the old StateStore (not deleted in this phase).

---

## Acceptance Criteria
- [ ] `npm run typecheck` passes (zero type errors)
- [ ] `npm run test` passes (all unit tests green)
- [ ] `better-sqlite3` installs and database opens without errors
- [ ] `arbiter init --non-interactive` creates `.arbiter/state.db`
- [ ] Dashboard loads on http://localhost:3070 without errors
- [ ] Playwright smoke test passes: `npm run test:e2e` in dashboard/
- [ ] `.gitignore` contains `**/state.db`
- [ ] Git LFS rules present in `.gitattributes`

---

## Files Changed Summary
| Action | File |
|---|---|
| NEW | src/state/SqliteStore.ts |
| NEW | src/git/WorktreeManager.ts |
| MODIFIED | src/types/index.ts |
| MODIFIED | src/conductor/Conductor.ts |
| MODIFIED | .gitignore |
| NEW/MODIFIED | .gitattributes |
| NEW | dashboard/playwright.config.ts |
| NEW | dashboard/e2e/smoke.spec.ts |
| NEW | tests/unit/SqliteStore.test.ts |
| NEW | tests/unit/WorktreeManager.test.ts |

---

## Phase 01 DONE when:
All acceptance criteria checked. Then update plan/README.md: Phase 01 → [x]
