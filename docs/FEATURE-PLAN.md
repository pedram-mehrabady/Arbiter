# Arbiter — Feature Plan & Implementation Roadmap
# STATUS: v1 — authored 2026-05-28. Implementation-ready.
# All existing features are preserved. This document describes what must be ADDED or UPGRADED.

---

## Preface — What Already Exists (Do Not Rebuild)

Before listing gaps, this is the confirmed working baseline. None of it gets torn down.

### Engine (src/)
| Module | File | Lines | Status |
|---|---|---|---|
| Conductor | `src/conductor/Conductor.ts` | 1,085 | Working |
| Preflight | `src/preflight/PreflightCheck.ts` | 154 | Working — secrets scan, crypto gate, complexity |
| ComplexityScorer | `src/preflight/ComplexityScorer.ts` | — | Working |
| SecretsScanner | `src/preflight/SecretsScanner.ts` | — | Working |
| ContextAssembler | `src/context/ContextAssembler.ts` | 186 | Working — per-agent glob allowlists |
| ContextPruner | `src/context/ContextPruner.ts` | — | Working |
| GatePoller | `src/gates/GatePoller.ts` | — | Working |
| GateRegistry | `src/gates/GateRegistry.ts` | — | Working |
| StateStore | `src/state/StateStore.ts` | 95 | Working — JSON-based (will be replaced in M0) |
| GitAutoCommit | `src/git/GitAutoCommit.ts` | 71 | Working — direct branch commits (will be refactored in M0) |
| WebhookNotifier | `src/notifications/WebhookNotifier.ts` | 49 | Working — outbound only (extended in M6) |
| DecisionLog | `src/decisions/DecisionLog.ts` | — | Working |
| EvidenceCache | `src/evidence/EvidenceCache.ts` | — | Working |
| PlanOutput / PlanValidator | `src/plan/` | — | Working |
| RateLimiter / TaskQueue | `src/queue/` | — | Working |
| BuildReceipt | `src/receipts/BuildReceipt.ts` | — | Working |
| TaskInitializer / TaskArchiver | `src/task/` | — | Working |
| Providers | `src/providers/` | — | Working — Anthropic, OpenAI, Gemini, Ollama, Mock |
| Bootstrap | `src/bootstrap/` | — | Working — Scanner, Interview, ConfigGenerator, ProjectRegistry |
| BundleAssembler | `src/bundle/` | — | Working |
| SpecWatcher | `src/watch/SpecWatcher.ts` | — | Working |
| FailureClassifier | `src/classifiers/FailureClassifier.ts` | — | Working |
| CLI | `src/cli/index.ts` | 745 | Working — init, run, gate, watch, sync, report |

### Dashboard (dashboard/src/)
| Feature | Location | Status |
|---|---|---|
| Dashboard grid + widgets | `features/dashboard/` | Working |
| Kanban board view | `features/board/BoardView.tsx` | Working |
| Pipeline stage view | `features/pipeline/PipelineView.tsx` | Working — stage detail modals |
| Flow view (agent docs + templates) | `features/flow/FlowView.tsx` | Working |
| FlowMap tab | `features/flowmap/FlowmapTab.tsx` | Working |
| Plans panel | `features/plans/PlansPanel.tsx` | Working |
| Reports view | `features/reports/ReportsView.tsx` | Working |
| Traces tab | `features/traces/TracesTab.tsx` | Working |
| MCP tab | `features/mcp/McpTab.tsx` | Working |
| Assistant chat | `components/AssistantChat.tsx` | Working |
| Conductor gate UI | `features/arbiter/components/ConductorGate.tsx` | Working |
| Job cards + detail modal | `features/arbiter/components/JobCard.tsx` | Working |
| Improvements drawer | `features/arbiter/components/ImprovementsDrawer.tsx` | Working |
| Developer setup modal | `features/developer/DeveloperSetupModal.tsx` | Working |
| Agent card + watcher modal | `features/arbiter/components/AgentCard.tsx` | Working |

### Agent Templates & Manifests
| Item | Location | Status |
|---|---|---|
| Full pipeline templates (14 agents) | `agents/templates/` | Working |
| Speed pipeline templates (5 agents) | `agents/templates-speed/` | Working |
| Full pipeline manifests | `agents/manifests/` | Working |
| Speed pipeline manifests | `agents/manifests-speed/` | Working |
| Knowledge docs | `agents/knowledge/` | Working |
| Engine directives | `engine/` | Working |
| Project templates | `project-templates/` | Working |
| Exec-plan folder structure | `exec-plan/` | Working |

### Tests
| Suite | Location | Status |
|---|---|---|
| Unit tests (19 files) | `tests/unit/` | Working |
| Integration test | `tests/integration/e2e.test.ts` | Working |
| Dashboard unit tests | `dashboard/src/lib/*.test.ts` | Working |

---

## The Gaps — What Must Be Built

Everything below is either MISSING or PARTIAL. Nothing in this list modifies or removes
anything from the baseline above. All new code is additive or targeted replacements.

---

## MILESTONE 0 — Foundation Infrastructure
**Must be completed first. Everything in Milestones 1–9 writes to or reads from these.**

### M0.1 — SQLite State Store
**Priority: CRITICAL — blocks M1, M2, M3, M5, M6**
**Status: MISSING**
**Replaces: `src/state/StateStore.ts` (95 lines, JSON-based)**

`StateStore.ts` reads and writes a JSON file. Under concurrent agent writes this can
corrupt silently. SQLite with `better-sqlite3` is synchronous — zero race conditions.

**What to build:**
- New file: `src/state/SqliteStore.ts`
- Driver: `better-sqlite3` (synchronous, NOT async ORM)
- Config at open time: `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, `PRAGMA synchronous = NORMAL`
- Implements the same interface as `StateStore` so Conductor import is a one-line swap

**4-table schema:**
```sql
CREATE TABLE tasks (
  task_id     TEXT PRIMARY KEY,
  tier        INTEGER NOT NULL,           -- 1 | 2 | 3
  pipeline    TEXT NOT NULL,              -- 'full' | 'speed'
  profile     TEXT NOT NULL,
  status      TEXT NOT NULL,             -- pending | building | gate | review | completed | failed
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE sub_tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       TEXT NOT NULL REFERENCES tasks(task_id),
  agent_role    TEXT NOT NULL,
  status        TEXT NOT NULL,           -- pending | in_progress | completed | failed
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  elapsed_ms    INTEGER,
  started_at    TEXT,
  completed_at  TEXT,
  output_hash   TEXT                     -- sha256 of output file
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL REFERENCES tasks(task_id),
  event_type  TEXT NOT NULL,             -- gate_triggered | agent_completed | user_chat | pr_comment | ci_result
  payload     TEXT NOT NULL,            -- JSON
  created_at  TEXT NOT NULL
);

CREATE TABLE orchestrator_state (
  task_id      TEXT PRIMARY KEY REFERENCES tasks(task_id),
  phase        TEXT NOT NULL,
  summary      TEXT,
  chat_history TEXT NOT NULL DEFAULT '[]'
);
```

**Files to update after SqliteStore is done:**
- `src/conductor/Conductor.ts` — swap StateStore import for SqliteStore
- `src/task/TaskInitializer.ts` — use SqliteStore
- `src/cli/index.ts` — pass db path, not state file path
- `tests/unit/StateStore.test.ts` — rename + rewrite for SqliteStore

**Database location:** `{workspaceRoot}/arbiter/state.db`
**gitignore rule to add:** `arbiter/state.db`

---

### M0.2 — WorktreeManager
**Priority: CRITICAL — blocks every agent that writes code**
**Status: PARTIAL — `GitAutoCommit.ts` (71 lines) exists but writes to the current branch**

Currently, every agent writes code directly into the developer's active branch. One
hallucinating agent wipes the developer's uncommitted work. This is catastrophic.

**What to build:**
- New file: `src/git/WorktreeManager.ts`
- Keep `GitAutoCommit.ts` as a utility (used inside WorktreeManager for commits)

**Interface:**
```typescript
interface WorktreeManager {
  create(taskId: string, branchName: string): Promise<ServiceResult<string>>;  // returns worktree path
  delete(taskId: string): Promise<ServiceResult<void>>;
  getPath(taskId: string): string;
  merge(taskId: string): Promise<ServiceResult<void>>;                         // squash merge
  listActive(): Promise<ServiceResult<string[]>>;
}
```

**Behavior:**
- `create`: runs `git worktree add ../arbiter-{taskId} -b {branchName}` in workspaceRoot
- All agent code writes go to the worktree path, never to workspaceRoot
- `delete`: `git worktree remove --force ../arbiter-{taskId}`
- `merge`: opens PR (via git push + gh CLI) — does NOT merge locally
- On Conductor task init → create worktree; on task complete/failed → delete worktree

**Files to update:**
- `src/conductor/Conductor.ts` — replace GitAutoCommit usage with WorktreeManager
- `src/types/index.ts` — add `WorktreeConfig` type

---

### M0.3 — Git LFS Config
**Priority: HIGH — prevents repo bloat from day 1**
**Status: MISSING**

**What to add:**
```
# .gitattributes additions
arbiter/tasks/**/*-output.md filter=lfs diff=lfs merge=lfs -text
arbiter/tasks/**/summaries/*.md filter=lfs diff=lfs merge=lfs -text
arbiter/tasks/**/research-output.md filter=lfs diff=lfs merge=lfs -text
arbiter/tasks/**/reframe-output.md filter=lfs diff=lfs merge=lfs -text
```

**What NOT to put in LFS:**
- `agents/` — agent rule books and manifests (small, humans need to read them)
- `engine/` — engine directives
- `contracts/` — machine-enforceable contracts (locked, must be diffable)
- `3-design.md`, `5-plan.json` — final approved artifacts

**Note:** Add `arbiter/state.db` to `.gitignore` (not LFS — rebuilt from events).

---

## MILESTONE 1 — 3-Tier Routing & Triage
**Depends on: M0.1 (SQLite), M0.2 (WorktreeManager)**

### M1.1 — Triage Agent Rule Book + Manifest
**Priority: HIGH**
**Status: MISSING**
**Location when built: `arbiter/triage/rules.md` + `arbiter/triage/manifest.yaml`**

The Triage agent is the upstream router. It runs before any Phase 1 agent.
It reads ONLY `task.md` + `arbiter.config.json`. Hard 4,000-token input limit.

**Rule book must define:**
- Read task.md and classify into Tier 1, 2, or 3
- Tier 1 (trivial): typo, CSS value, copy change, config flag — no Phase 1, no contracts
- Tier 2 (fix): bug with a known location, localized refactor — no Phase 1, uses existing contracts
- Tier 3 (feature): new module, new endpoint, new DB table, new integration — full Phase 1
- Output ONLY valid `triage.json` — no prose, no explanation, strict JSON

**Output schema (`triage.json`):**
```json
{
  "tier": 1 | 2 | 3,
  "profile": "css-fix" | "bug-fix" | "new-feature" | "refactor" | "greenfield" | ...,
  "reason": "one sentence max",
  "bypass_phase1": true | false,
  "estimated_agents": 2 | 5 | 14,
  "complexity_hint": "low" | "medium" | "high"
}
```

**Manifest constraints:**
```yaml
agent: triage
pipeline: both
always:
  - task.md
  - arbiter.config.json
never:
  - agents/templates/
  - agents/knowledge/
  - src/
  - contracts/
token_budget: 4000
model_override: haiku   # cheapest — this is a router, not a reasoner
```

---

### M1.2 — Triage Dispatch in Conductor
**Priority: HIGH**
**Status: MISSING**

**What to add to `src/conductor/Conductor.ts`:**
- Before any Phase 1 agent dispatch, run Triage agent
- Read `triage.json` output
- Route: Tier 1 → single Coder agent; Tier 2 → Investigator → Coder → Iron Funnel; Tier 3 → Phase 1 → Iron Funnel
- Write `tier` field to `tasks` table in SQLite on init
- If `triage.json` is malformed or model fails → default to Tier 3 (safe fallback)

---

### M1.3 — triage.json Schema in Types
**Priority: HIGH**
**Status: MISSING**

Add `TriageResult` interface to `src/types/index.ts`:
```typescript
export interface TriageResult {
  tier: 1 | 2 | 3;
  profile: string;
  reason: string;
  bypass_phase1: boolean;
  estimated_agents: number;
  complexity_hint: 'low' | 'medium' | 'high';
}
```

---

## MILESTONE 2 — The Iron Funnel
**Depends on: M0.1, M0.2, M1**
**This is the single highest-value feature in Arbiter — it is the architectural moat.**

### M2.1 — Compiler Airlock (Gate 1)
**Priority: CRITICAL**
**Status: MISSING**

Gate 1 catches type errors, lint violations, and contract mismatches for zero LLM cost.
Currently Arbiter has GatePoller and GateRegistry but no Compiler Airlock implementation.

**What to build:**
- New file: `src/gates/CompilerAirlockGate.ts`
- Runs deterministically (no LLM): `tsc --noEmit`, `eslint`, `prisma validate` (if Prisma present)
- Must detect: type errors, ESLint violations, forbidden patterns, contract file modifications (Tier 2)
- Returns: `{ passed: boolean, errors: CompilerError[], elapsed_ms: number }`
- Zero retries on fail — returns exact error payload to Conductor; Conductor sends to Generator

**Forbidden pattern rules to enforce in Gate 1:**
```typescript
const FORBIDDEN_PATTERNS = [
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/g, severity: 'error' },
  { name: 'direct_db_in_frontend', pattern: /import.*from.*prisma.*client/g, files: ['**/*.tsx', '**/*.ts'], exclude: ['**/api/**', '**/server/**'], severity: 'error' },
  { name: 'eval_usage', pattern: /\beval\s*\(/g, severity: 'error' },
  { name: 'any_type_explicit', pattern: /:\s*any\b/g, severity: 'warn' },
];
```

**Registration in GateRegistry:**
- Gate ID: `compiler-airlock`
- Type: `deterministic`
- Position: Gate 1 (always first in Iron Funnel)

---

### M2.2 — Iron Funnel Gate Sequence in Conductor
**Priority: CRITICAL**
**Status: MISSING**

Conductor currently runs agents in a linear sequence. The Iron Funnel requires a
specific 5-gate loop:

```
Generators finish
  → Gate 1 (CompilerAirlock): fail → back to Generator with error payload
  → Gate 2 (Test Writer): always runs after Gate 1 pass
  → Gate 3 (Proving Ground): fail → trigger Gate 4
  → Gate 4 (Debugger): max 2 attempts; fail → 07-failed
  → Gate 5 (Orchestrator Semantic Review): reject → back to Generator; approve → open PR
```

**What to add to Conductor.ts:**
- `runIronFunnel(taskId: string, worktreePath: string): Promise<IronFunnelResult>`
- Gate state tracked in SQLite `sub_tasks` table
- Gate 4 attempt counter enforced in SQLite (not in memory)
- On Gate 5 approve → call WorktreeManager to push branch + open PR via `gh pr create`

---

### M2.3 — Proving Ground (Gate 3)
**Priority: HIGH**
**Status: PARTIAL**

GatePoller and GateRegistry exist. Gate 3 needs to be wired as a deterministic runner.

**What to build / wire:**
- `src/gates/ProvingGroundGate.ts` — runs `jest`, `pytest`, or `playwright` (auto-detected from project)
- Checks coverage against ratchet floors from `arbiter.config.json`
- Returns full test output + coverage report to Conductor
- Conductor writes result to SQLite `events` table

---

### M2.4 — Debugger Gate (Gate 4)
**Priority: HIGH**
**Status: MISSING**

Gate 4 activates only when Gate 3 fails. It is a conditional LLM agent (Opus).

**What to build:**
- Debugger agent rule book already exists at `agents/templates/debugger.md`
- What's MISSING: Conductor wiring — the Gate 4 activation logic
- Conductor must: read Gate 3 failure output → build debugger context (test failures + generated code + contracts) → dispatch debugger agent → re-run Gate 3 on fix
- Max 2 Gate 4 activations per task. On 3rd Gate 3 failure → write `07-failed` status

---

### M2.5 — Gate Timeout + Critical Path Detection
**Priority: MEDIUM**
**Status: MISSING**

**What to add:**
- Background timer per gate (stored in SQLite `events` with `event_type = 'gate_started'`)
- On Conductor tick: check all open gates for elapsed time
- At 4h: send Telegram notification to `reporting.owner_chat_id`
- At 8h: escalate to `gate_timeout.tech_lead_chat_id` (new field in `arbiter.config.json`)
- Critical path detection: if a task's `blocking_task_ids` array length ≥ 3 and task is stuck at gate → add `CRITICAL PATH` label in SQLite + notify immediately

**New config fields to add to `arbiter.config.json`:**
```json
"gate_timeout": {
  "warn_hours": 4,
  "escalate_hours": 8,
  "tech_lead_chat_id": "{{TECH_LEAD_CHAT_ID}}",
  "critical_path_threshold": 3
}
```

---

## MILESTONE 3 — Machine-Enforceable Contracts
**Depends on: M0.1, M0.2, M2.1 (Compiler Airlock)**

### M3.1 — Contract Generation by Design Agent (Tier 3 only)
**Priority: HIGH**
**Status: MISSING**

Phase 1 Design agent currently outputs `3-design.md` (prose only). For Tier 3 tasks,
it must also output three compilable contract files.

**What to add to `agents/templates/design.md`:**
- Section: "Tier 3 Contract Generation" — tells agent to produce:
  - `contracts/schema.prisma` — actual Prisma schema (or EF Core model for .NET)
  - `contracts/api.ts` — Zod schemas for every request/response shape
  - `contracts/events.ts` — TypeScript interfaces for FE-BE events
- These files go into `arbiter/tasks/{task_id}/contracts/`

**What to add to Conductor:**
- After Design agent completes → run `tsc --noEmit` on `contracts/api.ts` and `contracts/events.ts`
- Run `prisma validate` on `contracts/schema.prisma` (if Prisma project)
- If validation fails → return contracts to Design agent with exact error; retry once
- On pass → write `contracts_locked: true` to SQLite tasks table

---

### M3.2 — Package Version Injection for Design Agent
**Priority: HIGH**
**Status: MISSING**

Design agents hallucinate API calls for package versions not installed in the project.
Gate 1 catches this but wastes a compile cycle.

**What to add to ContextAssembler:**
- Before dispatching Design agent, read `package.json` (FE) and `*.csproj` / `*.fsproj` (BE)
- Extract name+version for all direct dependencies
- Inject as a locked context block at the TOP of the Design agent's context:
```
# Package versions in this project (injected by Arbiter — do not override):
# zod: 3.22.4
# @prisma/client: 5.14.0
# typescript: 5.4.5
# Use ONLY syntax compatible with these exact versions.
```

---

### M3.3 — Tier 2 Contract Freeze Enforcement
**Priority: HIGH**
**Status: MISSING**

Tier 2 tasks (bug fixes) must not alter contracts. If a fix requires a contract change,
the task must be re-classified to Tier 3.

**What to add:**
- For Tier 2 tasks: add `contracts/**` to the Coder agent's `never:` list in its manifest at runtime (Conductor injects this dynamically)
- Gate 1 checks: if any file in `contracts/` was modified by the agent AND tier = 2 → fail with `CONTRACT_MUTATION_ON_TIER2` error
- Conductor handles this verdict: re-classify task to Tier 3, run Phase 1

---

## MILESTONE 4 — Context Intelligence
**Depends on: M0.1**

### M4.1 — madge Integration in ContextAssembler
**Priority: HIGH**
**Status: MISSING**

`ContextAssembler.ts` (186 lines) uses glob patterns per agent. This is coarse — it
may include files the agent doesn't need and miss files it does need.

**What to add:**
```typescript
// In ContextAssembler.ts
async function buildContextWithMadge(
  agentRole: AgentRole,
  targetFiles: string[],
  taskId: string,
): Promise<AssembledContext> {
  // Step 1: run madge on target files
  const { stdout } = await execFile('npx', ['madge', '--json', ...targetFiles]);
  const deps: Record<string, string[]> = JSON.parse(stdout);
  const depFiles = Object.values(deps).flat().concat(Object.keys(deps));

  // Step 2: intersect with role allowlist
  const allowedGlobs = AGENT_CONTEXT_MANIFESTS[agentRole];
  const sliced = intersect(depFiles, expandGlobs(allowedGlobs, workspaceRoot));

  // Step 3: always include locked contracts (Tier 3)
  const contracts = await glob(`arbiter/tasks/${taskId}/contracts/**`);

  // Step 4: enforce token budget
  return assemble([...sliced, ...contracts], TOKEN_BUDGETS[agentRole]);
}
```

**Token budgets to enforce:**
| Agent | Budget |
|---|---|
| Triage | 4,000 |
| Investigator | 12,000 |
| Tier 1 Coder | 8,000 |
| Frontend | 24,000 |
| Backend | 24,000 |
| Test Writer | 16,000 |
| Orchestrator Gate 5 | 32,000 |

**Fallback:** If madge is not installed (`npx madge` fails), fall back to existing glob
expansion. Log a warning. Never block a task over a missing dev tool.

**Dependency:** `madge` must be listed in `package.json` devDependencies.

---

## MILESTONE 5 — Orchestrator
**Depends on: M0.1, M1, M2**

### M5.1 — Orchestrator Agent Rule Book
**Priority: HIGH**
**Status: MISSING**
**Location when built: `agents/orchestrator/rules.md` + `agents/orchestrator/manifest.yaml`**

Merges the Coordinator and Babysitter roles into one agent. Handles both Full and Speed
pipelines via injected context.

**Rule book sections:**
1. **Identity** — "You are the Orchestrator. You see the full task lifecycle."
2. **Full pipeline behavior** — which agents, which gates, how to interpret each gate result
3. **Speed pipeline behavior** — 5-agent flow, single design pass, no separate Phase 1 artifacts
4. **Chat mode** — when user sends a message, read orchestrator_state.chat_history from SQLite context, answer concisely, do not re-run agents
5. **Gate 5 review mode** — given PR diff + contracts + task.md: approve or reject with one specific reason
6. **Failure mode** — write failure summary and lessons-learned; route to 07-failed
7. **Lessons capture** — on task complete, extract 3 lessons into `engine/CLI-LESSONS-LEARNED.md`

**CRITICAL behavior rule:** The Orchestrator LLM process starts and terminates per event.
It does NOT stay alive between invocations. Its memory is `orchestrator_state.chat_history`
in SQLite — injected fresh at each wakeup. This must be stated explicitly in the rule book.

**Manifest:**
```yaml
agent: orchestrator
pipeline: both
always:
  - agents/orchestrator/rules.md
  - engine/MASTER-DIRECTIVES.md
  - engine/GATE_PLAYBOOK.md
on_demand:
  - 3-design.md
  - 5-plan.json
  - contracts/**
  - arbiter/tasks/{{TASK_ID}}/orchestrator_state.json   # injected by Conductor from SQLite
never:
  - src/
  - dashboard/
token_budget: 32000
```

---

### M5.2 — Event-Driven Orchestrator Dispatch in Conductor
**Priority: HIGH**
**Status: MISSING**

The Orchestrator is invoked on events, not on a schedule.

**What to add to Conductor:**
```typescript
async function wakeOrchestrator(
  taskId: string,
  trigger: OrchestratorTrigger,
  payload: Record<string, unknown>,
): Promise<OrchestratorResponse> {
  // 1. Load orchestrator_state from SQLite
  const state = db.prepare('SELECT * FROM orchestrator_state WHERE task_id = ?').get(taskId);

  // 2. Build context: saved state + trigger event + payload
  const context = buildOrchestratorContext(state, trigger, payload);

  // 3. Dispatch to Orchestrator agent (LLM)
  const response = await llmProvider.run('orchestrator', context);

  // 4. Save response to orchestrator_state.chat_history in SQLite
  db.prepare('UPDATE orchestrator_state SET chat_history = ?, phase = ? WHERE task_id = ?')
    .run(appendToHistory(state.chat_history, response), response.phase, taskId);

  // 5. LLM process terminates here — no persistent session
  return response;
}
```

**Trigger types:**
```typescript
type OrchestratorTrigger =
  | 'user_chat'          // user typed in chat tab
  | 'gate5_reached'      // all gates 1-3 passed, semantic review needed
  | 'gate_failed_twice'  // task → 07-failed
  | 'task_complete'      // PR merged
  | 'pr_comment'         // human left a PR comment (M6.3)
  | 'conductor_query';   // Conductor asks a yes/no question
```

---

### M5.3 — Investigator Agent (Tier 2)
**Priority: HIGH**
**Status: MISSING**
**Location: `agents/investigator/rules.md` + `agents/investigator/manifest.yaml`**

Tier 2 tasks (bug fixes) go to the Investigator before the Coder. The Investigator
reads the bug report + uses the madge context builder to find the exact files
causing the bug. Outputs a "Fix Strategy" document.

**Rule book must define:**
- Read bug description from `task.md`
- Read madge dependency trace (provided in context)
- Identify the root cause file(s) — maximum 5 files
- Write `arbiter/tasks/{task_id}/fix-strategy.md`:
  - Root cause: `{file:line}` — one sentence
  - Impact radius: list of affected files
  - Proposed fix: 3 bullet points max
  - Contract mutation required: yes/no (if yes → escalate to Tier 3)
- Do NOT write any code. Only the strategy.

**Manifest:**
```yaml
agent: investigator
pipeline: both
always:
  - agents/investigator/rules.md
  - engine/MASTER-DIRECTIVES.md
  - task.md
on_demand:
  - "{{madge_dependency_trace}}"   # injected by Conductor
never:
  - agents/templates/
  - contracts/
token_budget: 12000
```

---

## MILESTONE 6 — Webhook Loop
**Depends on: M0.1, M0.2, M5**

### M6.1 — Inbound Webhook Receiver
**Priority: HIGH**
**Status: MISSING**
**`WebhookNotifier.ts` currently only SENDS webhooks — it has no server.**

**What to build:**
- New file: `src/webhooks/WebhookReceiver.ts`
- Lightweight HTTP server (Node.js `http.createServer`, no Express dependency)
- Runs on configurable port (default: 7474) when Conductor is active
- Validates `X-Hub-Signature-256` header (GitHub standard) using project secret
- Handles two event types:
  - `ci_result`: CI pipeline pass/fail for a PR
  - `pr_comment`: human reviewer left a comment on an Arbiter PR

```typescript
interface InboundWebhookEvent {
  type: 'ci_result' | 'pr_comment';
  task_id: string;
  branch: string;
  payload: CiResultPayload | PrCommentPayload;
}
```

---

### M6.2 — Conductor Resume from CI Webhook
**Priority: HIGH**
**Status: MISSING**

Currently: Conductor opens a PR and the pipeline ends. CI result is never consumed.

**What to add to Conductor:**
- On `ci_result` event received by WebhookReceiver:
  - If pass: move task to `06-completed`; notify owner via Telegram
  - If fail: re-read CI failure logs; dispatch Debugger for one final attempt
- Conductor writes CI result to SQLite `events` table on receipt

---

### M6.3 — PR Comment Reactions (The AO Killer)
**Priority: HIGH — Phase 1.5**
**Status: MISSING**

When a human leaves a comment on an Arbiter-generated PR, the pipeline must react.

**What to add:**

1. WebhookReceiver handles `pr_comment` GitHub event
2. Conductor reads comment + PR diff from payload
3. Wakes Orchestrator with trigger `pr_comment`:
   - Orchestrator classifies: code change request vs. question vs. LGTM
4. If code change: Conductor re-opens worktree, dispatches Coder with:
   - PR diff + comment text + contracts (as context)
   - Coder fixes + commits to PR branch
   - Gate 1 re-runs on the patch only
   - Push new commit to PR branch (no new PR)
5. If question: Orchestrator posts reply as PR comment via `gh pr comment`
6. If LGTM: mark task complete; close orchestrator_state

**New event type to add to WebhookNotifier:**
```typescript
export type WebhookEvent = 'gate_created' | 'task_complete' | 'task_failed' | 'pr_comment_received' | 'ci_result_received';
```

---

## MILESTONE 7 — Dashboard Upgrades
**Depends on: M0.1 (SQLite — dashboard reads state from db)**

The dashboard is fully working. These are targeted additions to existing components,
not rebuilds. All existing views (Board, Pipeline, Flow, Reports, Traces, MCP) remain.

### M7.1 — Tier Badge on Task Cards
**Priority: HIGH**
**Status: MISSING**
**File: `dashboard/src/features/arbiter/components/JobCard.tsx`**

Add a small badge to each job card: `T1` (grey), `T2` (amber), `T3` (blue).
Read from SQLite `tasks.tier` column via `serverApi.ts`.

---

### M7.2 — Iron Funnel 5-Gate Progress Bar
**Priority: HIGH**
**Status: MISSING**
**File: `dashboard/src/features/pipeline/PipelineView.tsx`**

In the Pipeline stage view, replace the current linear agent list with the 5-gate
Iron Funnel visualisation:

```
Gate 1 [🔒 Compiler]  Gate 2 [🤖 Test Writer]  Gate 3 [🔒 Tests]  Gate 4 [🤖 Debugger?]  Gate 5 [🤖 Semantic]
  ✓ PASSED                ✓ PASSED                  ✓ PASSED            — skipped              ⏳ IN PROGRESS
```

- 🔒 = deterministic gate (green lock icon)
- 🤖 = LLM gate (blue agent icon)
- Gate 4 shows "— skipped" when Gate 3 passed
- Each gate shows elapsed time
- Read from SQLite `sub_tasks` table where `agent_role LIKE 'gate-%'`

---

### M7.3 — Critical Path Flag
**Priority: MEDIUM**
**Status: MISSING**
**File: `dashboard/src/features/arbiter/components/JobCard.tsx`**

If a task has `blocking_count >= 3` and `status = 'gate'`, show a red `CRITICAL PATH`
banner on the job card. Read from a new `blocking_count` computed column in the
dashboard API layer.

---

### M7.4 — Gate Timeout Escalation UI
**Priority: MEDIUM**
**Status: MISSING**
**File: `dashboard/src/features/pipeline/PipelineView.tsx`**

Show a warning indicator on the stage detail when a gate has been open for > 4h.
Show a red ESCALATED indicator at > 8h.
Read from SQLite `events` where `event_type = 'gate_started'` and compute elapsed.

---

### M7.5 — Orchestrator Chat Wired to SQLite
**Priority: HIGH**
**Status: PARTIAL**

`AssistantChat.tsx` already exists. Currently it talks to `src/api/llm/anthropic.ts`
directly — it does not go through the event-driven Orchestrator.

**What to change:**
- Chat submit → POST to Conductor's local HTTP API → Conductor wakes Orchestrator via `wakeOrchestrator(taskId, 'user_chat', { message })`
- Response comes from SQLite `orchestrator_state.chat_history` (not from a live stream)
- This preserves full chat history across page refreshes (history is in SQLite, not in React state)

---

## MILESTONE 8 — Providers & Extensibility
**Depends on: M0.1**

### M8.1 — SubQ Provider
**Priority: MEDIUM — Phase 1.5**
**Status: MISSING**

SubQ is a 12M-token context model. Used as premium Gate 5 provider only.
It bypasses Context Builder token-slicing for holistic repo-wide review.

**What to build:**
- New file: `src/providers/SubQProvider.ts`
- Implements the `LLMProvider` interface
- Config in `arbiter.config.json` under `planned_providers.subq`
- Conductor checks: if `roles.orchestrator.provider === 'subq'` AND Gate 5 → feed full repo AST
- Full repo AST feeding: ContextAssembler skips token budget enforcement for SubQ (just validates that content fits in 12M)

---

### M8.2 — ACP Stub
**Priority: LOW — Phase 1.5**
**Status: MISSING**

Lay the ACP interface groundwork so external agents can plug into the Iron Funnel in v3
without a breaking change.

**What to build:**
- New file: `src/acp/types.ts`
- Interfaces only — no implementation:
```typescript
export interface AgentCapability {
  id: string;
  name: string;
  input_schema: Record<string, unknown>;    // JSON Schema
  output_schema: Record<string, unknown>;
  supported_tiers: (1 | 2 | 3)[];
  gate_positions: (1 | 2 | 3 | 4 | 5)[];
}

export interface AgentMessage {
  from: string;
  to: string;
  task_id: string;
  payload: Record<string, unknown>;
  ts: string;
}

export interface HandoffPayload {
  context_files: string[];
  contracts_path?: string;
  triage_result: TriageResult;
}
```

This file is imported by nobody in MVP. It is the "shape reservation" for v3 plugins.

---

## MILESTONE 9 — GitHub Distribution
**What's needed for someone to `npm install -g @arbiter-pipeline/cli` and use it.**

### M9.1 — `arbiter sync` Command
**Priority: HIGH**
**Status: MISSING**

`arbiter init` creates `arbiter.config.json`. But agent rule books and manifests need
to be copied from the Arbiter tool installation into the project's `arbiter/` folder.

**What to build:**
- CLI command: `arbiter sync`
- Copies `agents/templates/` → `{workspaceRoot}/arbiter/agents/templates/`
- Copies `agents/templates-speed/` → `{workspaceRoot}/arbiter/agents/templates-speed/`
- Copies `agents/manifests/` → `{workspaceRoot}/arbiter/agents/manifests/`
- Copies `agents/manifests-speed/` → `{workspaceRoot}/arbiter/agents/manifests-speed/`
- Copies `agents/knowledge/` → `{workspaceRoot}/arbiter/agents/knowledge/`
- Copies `engine/` → `{workspaceRoot}/arbiter/engine/`
- After copy: substitutes all `{{TEMPLATE_VAR}}` placeholders using values from `arbiter.config.json`
- Diff mode: `arbiter sync --check` shows what would change without writing

**Idempotent:** `arbiter sync` can run again after an Arbiter upgrade — it only overwrites
files where the source has changed (hash comparison).

---

### M9.2 — Visible `arbiter/` Folder Rename
**Priority: HIGH**
**Status: PARTIAL**

Currently the project uses `.arbiter/` (hidden folder). The architecture mandates a
visible `arbiter/` folder so developers can read and audit agent rule books.

**What to change:**
- `src/state/SqliteStore.ts` (M0.1) writes to `arbiter/state.db`, not `.arbiter/state.db`
- `arbiter init` creates `arbiter/` not `.arbiter/`
- `arbiter sync` copies into `arbiter/`
- Update all path constants in `src/` that reference `.arbiter/`
- Update `.gitignore`: add `arbiter/state.db`; keep `arbiter/tasks/` committed (except LFS files)

**Folder layout after sync:**
```
{projectRoot}/
└── arbiter/
    ├── arbiter.config.json         ← SINGLE SOURCE OF TRUTH (already exists)
    ├── state.db                    ← gitignored, rebuilt from events
    ├── agents/
    │   ├── templates/              ← full pipeline rule books (synced from tool)
    │   ├── templates-speed/        ← speed pipeline rule books (synced from tool)
    │   ├── manifests/              ← full pipeline manifests (synced from tool)
    │   ├── manifests-speed/        ← speed pipeline manifests (synced from tool)
    │   ├── orchestrator/           ← NEW: orchestrator rule book (M5.1)
    │   ├── triage/                 ← NEW: triage rule book (M1.1)
    │   ├── investigator/           ← NEW: investigator rule book (M5.3)
    │   └── knowledge/              ← knowledge docs (synced from tool)
    ├── engine/                     ← MASTER-DIRECTIVES, GATE_PLAYBOOK, etc. (synced)
    ├── tasks/                      ← per-task artifacts (user-owned, LFS for outputs)
    │   └── FEAT-001/
    │       ├── task.md
    │       ├── triage.json
    │       ├── 3-design.md
    │       ├── 5-plan.json
    │       ├── contracts/          ← Tier 3 only, locked
    │       └── fix-strategy.md     ← Tier 2 only
    └── exec-plan/                  ← backlog stages (already exists)
```

---

### M9.3 — `arbiter init` Completeness
**Priority: HIGH**
**Status: PARTIAL — `init` exists but does not run `sync` or create `arbiter/` folder**

**What to add to `init` flow:**
1. Scan project (already works)
2. Run interview / use defaults (already works)
3. Write `arbiter.config.json` (already works)
4. Create `arbiter/` folder structure
5. Run `arbiter sync` automatically to copy templates + engine docs
6. Substitute template vars in all synced files
7. Initialize SQLite state.db (new: M0.1)
8. Print next steps: "Run `arbiter run task.md` to start your first task"

---

### M9.4 — Developer Identity & Multi-dev Support
**Priority: MEDIUM**
**Status: PARTIAL — `.arbiter/developer-identity.json` exists**

**Current gap:** Developer identity is stored in `.arbiter/developer-identity.json`.
When Arbiter moves to visible `arbiter/` this file should move to
`~/.arbiter/identity.json` (user home, NOT committed to project repo).

**Why:** A team of 5 using the same repo must not overwrite each other's identity.
Each developer's identity is personal, not project-level.

---

### M9.5 — Admin Telegram Bot Config
**Priority: MEDIUM**
**Status: MISSING**

The morning report and gate timeout escalations require a Telegram bot.
The bot config must NEVER be committed to a project repo.

**What to add:**
- Config location: `~/.arbiter/admin.config.json` (user home, gitignored everywhere)
- Schema:
```json
{
  "telegram": {
    "bot_token": "{{BOT_TOKEN}}",
    "owner_chat_id": "{{OWNER_CHAT_ID}}",
    "tech_lead_chat_id": "{{TECH_LEAD_CHAT_ID}}"
  }
}
```
- `arbiter init` checks for this file; if missing → prints setup instructions but does NOT block init
- Conductor loads from `~/.arbiter/admin.config.json` if present; silently skips Telegram calls if missing

---

### M9.6 — README + Getting Started
**Priority: HIGH**
**Status: PARTIAL — README.md exists but content is unknown**

README must cover:
1. What Arbiter is (2 sentences)
2. Quick start: `npm install -g @arbiter-pipeline/cli` → `arbiter init` → `arbiter run task.md`
3. Requirements: Claude Max subscription (or API key), Node.js 20+, git
4. Pipeline selection: when to use full (14-agent) vs. speed (5-agent)
5. Dashboard: `arbiter dashboard` (how to open it)
6. Configuration: `arbiter.config.json` template vars explanation
7. Telegram setup (optional)
8. Contributing link

---

### M9.7 — npm Package Polish
**Priority: MEDIUM**
**Status: PARTIAL — `.npmignore` exists**

**What to verify / add:**
- `package.json` `bin` field points to compiled `dist/cli/index.js`
- `files` field in `package.json` includes only `dist/`, `agents/`, `engine/`, `project-templates/`
- `engines` field: `{ "node": ">=20.0.0" }`
- `prepublishOnly` script: runs `tsc && vitest run` — block publish if tests fail
- Verify `.npmignore` excludes: `src/`, `tests/`, `dashboard/src/`, `docs/`, `.git/`
- `arbiter --version` returns semver from `package.json`

---

### M9.8 — CI/CD (GitHub Actions)
**Priority: MEDIUM**
**Status: PARTIAL — `.github/workflows/ci.yml` exists**

**What to verify / add to `ci.yml`:**
- Run on: `push` to main, PR targeting main
- Jobs: `build` → `test` → `smoke-test`
- Smoke test: run `arbiter init --non-interactive` in a temp directory; verify `arbiter.config.json` is created
- Do NOT run full LLM pipeline in CI (costs money). Mock provider for CI.
- On main merge: `npm publish` to npm registry (guarded by `NPM_TOKEN` secret)

---

## MILESTONE 10 — v3 Horizon (Post-Launch)
**Not for initial release. Captured here so they are not relitigated.**

| # | Feature | Why deferred |
|---|---|---|
| V3.1 | ACP full implementation | Stub (M8.2) reserves the interface; full impl requires community feedback |
| V3.2 | ts-morph AST parser in ContextAssembler | madge is sufficient for MVP; ts-morph is overkill until proven needed |
| V3.3 | Cloud/SaaS backend (PostgreSQL) | Local engine ships first; SaaS requires auth, billing, multi-tenant isolation |
| V3.4 | Web version (shared tasks, team assignment) | Local version proves the model; web requires backend infrastructure |
| V3.5 | SubQ full repo ingest (large repo optimization) | Depends on SubQ API availability and pricing model |
| V3.6 | AG-UI (Routa-style third-party agent UI) | Requires ACP full implementation first |
| V3.7 | Greptile RAG provider (memory_rag) | Pending setup — listed in future_providers |
| V3.8 | Exa web search provider | Pending setup — listed in future_providers |

---

## Implementation Order Summary

| Order | Milestone | Blocks | Estimated effort |
|---|---|---|---|
| 1 | M0.1 — SQLite Store | Everything | 1–2 days |
| 2 | M0.2 — WorktreeManager | All code-writing agents | 1 day |
| 3 | M0.3 — Git LFS config | Repo hygiene | 2 hours |
| 4 | M1.1–M1.3 — Triage agent + routing | M2, M3 | 1–2 days |
| 5 | M2.1 — Compiler Airlock (Gate 1) | M3, Iron Funnel | 1 day |
| 6 | M2.2 — Iron Funnel sequence in Conductor | M3, M5, M6 | 2 days |
| 7 | M2.3–M2.4 — Proving Ground + Debugger gates | M6 | 1 day |
| 8 | M3.1–M3.3 — Machine-Enforceable Contracts | M4 | 2 days |
| 9 | M4.1 — madge in ContextAssembler | — | 1 day |
| 10 | M5.1–M5.3 — Orchestrator + Investigator agents | M6, M7.5 | 2 days |
| 11 | M5.2 — Event-driven Orchestrator dispatch | M6 | 1 day |
| 12 | M6.1–M6.2 — Inbound webhooks + CI resume | M6.3 | 1 day |
| 13 | M9.1–M9.3 — arbiter sync + init + folder rename | Distribution | 2 days |
| 14 | M7.1–M7.5 — Dashboard upgrades | — | 2 days |
| 15 | M2.5 + M7.3–M7.4 — Timeout, critical path | — | 1 day |
| 16 | M9.4–M9.8 — npm, README, CI, identity | GitHub launch | 1–2 days |
| 17 | M6.3 — PR Comment Reactions | — | 1 day |
| 18 | M8.1–M8.2 — SubQ + ACP stub | — | 1 day |

**Total: ~24–28 development days to a distributable v1.0 on GitHub.**

---

## Status Codes Used in This Document

| Code | Meaning |
|---|---|
| `EXISTS` | Fully implemented and working |
| `PARTIAL` | Implementation exists but incomplete or needs extension |
| `MISSING` | Not yet written — this document is the spec |
| `PLANNED` | Deferred to v3 — do not implement until explicitly unlocked |
