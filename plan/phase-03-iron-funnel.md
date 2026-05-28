# Phase 03 — The Iron Funnel (Gates 1–5)
# Status: [x] COMPLETE — 2026-05-28
# Prerequisite: Phase 01 (SqliteStore, WorktreeManager), Phase 02 (Triage)

## Objective
Replace the current linear agent sequence with the 5-gate Iron Funnel. Gate 1
(Compiler Airlock) catches type/lint errors for zero LLM cost. Gate 3 (Proving Ground)
runs tests. Gate 4 (Debugger) activates only on Gate 3 failure. Gate 5 (Orchestrator
Semantic Review — stub in this phase, full LLM in Phase 05). Tier 2 routing gets its
Investigator agent. After this phase: every code-generating task goes through the Iron
Funnel. Type errors are caught before any LLM reviews them.

---

## Deliverables

### 1. src/gates/CompilerAirlockGate.ts  [NEW]
Deterministic Gate 1. Zero LLM calls.

Runs in sequence:
1. `tsc --noEmit` on the worktree path
2. `eslint --no-eslintrc --rule '{"no-eval": "error"}' <worktree>` (or project eslint config if present)
3. `prisma validate` if `prisma/schema.prisma` exists in worktree
4. Custom forbidden pattern scan (uses patterns from PreflightCheck, extended):
   - `dangerouslySetInnerHTML`
   - Direct Prisma import in .tsx files
   - `eval(` usage
   - Contract file modification for Tier 2 tasks

Returns:
```typescript
interface CompilerAirlockResult {
  passed: boolean;
  errors: Array<{ tool: 'tsc' | 'eslint' | 'prisma' | 'forbidden_pattern'; message: string; file?: string; line?: number }>;
  elapsed_ms: number;
}
```

On fail: Conductor sends exact error list to Generator agent for targeted fix.
Retry limit: 3 per gate cycle.

Registration: GateRegistry.register('compiler-airlock', { type: 'deterministic', position: 1 })

### 2. src/gates/ProvingGroundGate.ts  [NEW]
Deterministic Gate 3. Runs the project's test suite.

Auto-detects test runner:
- `jest` or `vitest` if `jest.config.*` or `vitest.config.*` present
- `pytest` if `pytest.ini` or `setup.cfg` present
- `playwright` if `playwright.config.*` present

Checks coverage against floors from `arbiter.config.json`:
```json
"coverage_floors": {
  "statements": 70,
  "branches": 65,
  "functions": 70
}
```

Returns:
```typescript
interface ProvingGroundResult {
  passed: boolean;
  testOutput: string;
  failedTests: string[];
  coveragePct?: { statements: number; branches: number; functions: number };
  elapsed_ms: number;
}
```

### 3. src/conductor/IronFunnel.ts  [NEW]
Encapsulates the 5-gate sequence. Called by Conductor after Generators complete.

```typescript
class IronFunnel {
  async run(taskId: string, worktreePath: string): Promise<IronFunnelResult> {
    // Gate 1: CompilerAirlock
    // Gate 2: TestWriter dispatch (LLM - Sonnet)
    // Gate 3: ProvingGround
    // Gate 4: Debugger (conditional - only if Gate 3 fails, max 2 attempts)
    // Gate 5: OrchestratorReview (stub in Phase 03: auto-approve + log)
  }
}
```

Gate 4 attempt counter: stored in SqliteStore events table, not in memory.
On 3rd Gate 3 failure: write task status 'failed', move to 07-failed folder, stop.

Gate 5 stub (Phase 03): logs "Gate 5 stub: auto-approving" + moves forward.
Gate 5 full LLM: implemented in Phase 05.

### 4. agents/investigator/rules.md  [NEW]
Tier 2 Investigator agent rule book.

Reads: bug description from task.md + madge dependency trace (injected)
Does NOT write code — only produces fix-strategy.md
Output: arbiter/tasks/{task_id}/fix-strategy.md
  - Root cause: `{file:line}` one sentence
  - Impact radius: list of files
  - Proposed fix: 3 bullets max
  - Contract mutation required: yes/no

If contract mutation required → Conductor re-classifies to Tier 3.

### 5. agents/investigator/manifest.yaml  [NEW]
```yaml
agent: investigator
pipeline: both
always:
  - agents/investigator/rules.md
  - engine/MASTER-DIRECTIVES.md
  - task.md
never:
  - agents/templates/
  - contracts/
token_budget: 12000
```

### 6. src/conductor/Conductor.ts  [MODIFIED]
- Wire `runTier2(taskId)`:
  1. Dispatch Investigator agent
  2. Read fix-strategy.md output
  3. Check: contract mutation required? → re-classify to Tier 3
  4. Build targeted context (madge stub: just reads fix-strategy.md files list for now)
  5. Dispatch Coder (backend or frontend based on task)
  6. Run IronFunnel
- Wire IronFunnel into `runTier3(taskId)` after Generators
- Gate state persisted in SqliteStore sub_tasks table
- Gate 1 failure payload sent back to generator as retry context

### 7. Gate timeout detection  [in IronFunnel.ts]
- Record gate start time in SqliteStore events (event_type: 'gate_started')
- Background check interval: every 30 minutes
- At 4h elapsed: log warning in DecisionLog (Telegram in Phase 06)
- At 8h elapsed: log escalation in DecisionLog

### 8. arbiter.config.json  [MODIFIED]
Add:
```json
"coverage_floors": {
  "statements": 70,
  "branches": 65,
  "functions": 70
},
"gate_timeout": {
  "warn_hours": 4,
  "escalate_hours": 8,
  "critical_path_threshold": 3
}
```

---

## Tests Required

### Unit tests
- tests/unit/CompilerAirlockGate.test.ts  [NEW]
  - Returns passed:true for clean TypeScript snippet
  - Catches `eval(` forbidden pattern
  - Catches `dangerouslySetInnerHTML`
  - Captures tsc exit code non-zero as failure
  - Returns elapsed_ms

- tests/unit/ProvingGroundGate.test.ts  [NEW]
  - Auto-detects jest from vitest.config.ts presence
  - Returns failed test list on non-zero exit
  - Returns passed:true when all tests pass (mock)

- tests/unit/IronFunnel.test.ts  [NEW]
  - Gate 1 fail → retries generator up to 3 times
  - Gate 3 fail → Gate 4 triggered once
  - Gate 3 fail twice → 07-failed status
  - Gate 4 success → re-runs Gate 3
  - Gate 5 stub → auto-approves

---

## Acceptance Criteria
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] CompilerAirlockGate catches a real tsc error on a test file
- [ ] IronFunnel.run() completes the 5-gate sequence for a mock task
- [ ] Tier 2 route dispatches Investigator and reads fix-strategy.md
- [ ] Gate attempt counter persists across restarts (SqliteStore, not memory)
- [ ] Gate start time written to events table
- [ ] `agents/investigator/rules.md` and `manifest.yaml` exist
- [ ] Playwright smoke test still passes

---

## Files Changed Summary
| Action | File |
|---|---|
| NEW | src/gates/CompilerAirlockGate.ts |
| NEW | src/gates/ProvingGroundGate.ts |
| NEW | src/conductor/IronFunnel.ts |
| NEW | agents/investigator/rules.md |
| NEW | agents/investigator/manifest.yaml |
| MODIFIED | src/conductor/Conductor.ts |
| MODIFIED | arbiter.config.json |
| NEW | tests/unit/CompilerAirlockGate.test.ts |
| NEW | tests/unit/ProvingGroundGate.test.ts |
| NEW | tests/unit/IronFunnel.test.ts |

---

## Phase 03 DONE when:
All acceptance criteria checked. Then update plan/README.md: Phase 03 → [x]
