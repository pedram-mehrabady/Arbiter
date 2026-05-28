# Phase 02 — Triage Agent + 3-Tier Routing
# Status: [x] COMPLETE — 2026-05-28
# Prerequisite: Phase 01 complete (SqliteStore available)

## Objective
Add the Triage agent upstream of every pipeline. Before any Phase 1 agent or code
generator runs, the Conductor calls Triage, reads triage.json, and routes to Tier 1,
Tier 2, or Tier 3. After this phase: every `arbiter run` classifies the task and
routes it correctly. Tier 1 is handled by a single Coder pass. Tier 2 waits for Phase 03
(Investigator). Tier 3 runs the existing full Phase 1 pipeline.

---

## Deliverables

### 1. agents/triage/rules.md  [NEW]
Triage agent rule book. Must be concise — agent has a hard 4,000-token input limit.

Content:
- Identity: stateless router, never a coder
- Input: task.md + arbiter.config.json ONLY
- Output: valid triage.json, no prose
- Tier rules:
  - Tier 1: typo, CSS value, copy change, single config flag, single variable rename
  - Tier 2: localized bug fix (known file), small refactor (≤3 files), dependency version bump
  - Tier 3: new module, new DB table, new API endpoint, new integration, any cross-module change
- If uncertain → Tier 3 (safe fallback)
- Output schema enforced (any deviation → Conductor treats as Tier 3)

### 2. agents/triage/manifest.yaml  [NEW]
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
```

### 3. src/triage/TriageRunner.ts  [NEW]
Lightweight class that:
- Assembles the triage prompt (task.md + config, hard 4k token limit)
- Calls LLM with the triage agent rule book
- Parses and validates triage.json output
- If parse fails → returns Tier 3 fallback (never blocks the pipeline)
- Writes result to SqliteStore events table (event_type: 'triage_complete')

Public interface:
```typescript
interface TriageRunner {
  run(taskId: string, taskMdPath: string): Promise<ServiceResult<TriageResult>>;
}
```

### 4. src/conductor/Conductor.ts  [MODIFIED]
Add triage step at the start of `conduct()`:
1. Instantiate TriageRunner
2. Run triage
3. Read `triage.json` from task dir
4. Write tier to tasks table: `db.upsertTask({ task_id, tier: result.tier, ... })`
5. Route based on tier:
   - Tier 1 → `runTier1(taskId)` (single coder agent, no Phase 1)
   - Tier 2 → `runTier2(taskId)` (Phase 03 adds Investigator; for now, falls through to full pipeline)
   - Tier 3 → existing `runLoop(state)` (full Phase 1 pipeline)
6. Log tier classification to DecisionLog

`runTier1(taskId)`:
- Single agent dispatch: backend OR frontend (auto-detected from task.md)
- Uses WorktreeManager: create worktree → run agent → Gate 1 check (Phase 03) → commit
- No Phase 1, no contracts, no Iron Funnel (added in Phase 03)
- For now: run agent + git commit in worktree, then mark complete

### 5. src/types/index.ts  [MODIFIED]
TriageResult is already added in Phase 01. Verify it matches:
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

### 6. arbiter.config.json  [MODIFIED]
Add triage role:
```json
"triage": {
  "provider": "claude_max_cli",
  "model": "claude-haiku-4-5-20251001",
  "_role": "Upstream router only — classifies tier (1/2/3). Hard 4k token limit. Haiku: cheapest correct option for pure classification."
}
```

---

## Tests Required

### Unit tests
- tests/unit/TriageRunner.test.ts  [NEW]
  - Returns Tier 3 fallback when LLM output is malformed JSON
  - Returns Tier 3 fallback when LLM times out
  - Correctly parses valid Tier 1 response
  - Correctly parses valid Tier 2 response
  - Correctly parses valid Tier 3 response
  - Respects 4k token hard limit (mock ContextAssembler)
  - Writes triage event to SqliteStore

### Conductor integration
- tests/integration/e2e.test.ts  [MODIFIED]
  - Mock LLM returns Tier 1 triage.json → conductor routes to Tier 1 path
  - Mock LLM returns Tier 3 triage.json → conductor routes to existing pipeline

---

## Acceptance Criteria
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `arbiter run` with a Tier 1 task.md: triage.json is written to task dir
- [ ] triage.json is written to `tasks` SQLite table (tier column populated)
- [ ] Tier 3 task routes to existing full pipeline (no regression)
- [ ] Malformed LLM output defaults to Tier 3 (safe fallback verified by test)
- [ ] `agents/triage/rules.md` and `manifest.yaml` exist

---

## Files Changed Summary
| Action | File |
|---|---|
| NEW | agents/triage/rules.md |
| NEW | agents/triage/manifest.yaml |
| NEW | src/triage/TriageRunner.ts |
| MODIFIED | src/conductor/Conductor.ts |
| MODIFIED | src/types/index.ts (verify TriageResult) |
| MODIFIED | arbiter.config.json |
| NEW | tests/unit/TriageRunner.test.ts |
| MODIFIED | tests/integration/e2e.test.ts |

---

## Phase 02 DONE when:
All acceptance criteria checked. Then update plan/README.md: Phase 02 → [x]
