# Phase 07 — Dashboard Upgrades
# Status: [x] COMPLETE — 2026-05-28
# Prerequisite: Phase 01 (SqliteStore — dashboard reads tier from db), Phase 05 (Orchestrator chat)

## Objective
Add visual features to the existing dashboard that surface the new pipeline architecture.
Tier badge on task cards. 5-gate Iron Funnel progress bar in Pipeline view.
Critical path flag on blocked tasks. Gate timeout escalation indicators.
All existing views (Board, Flow, Reports, Traces, MCP, Plans) remain unchanged.

---

## Deliverables

### 1. dashboard/src/api/types.ts  [MODIFIED]
Add new types that the server API now returns:

```typescript
export interface TaskTier {
  tier: 1 | 2 | 3;
  profile: string;
}

export interface IronFunnelGateStatus {
  gate: 1 | 2 | 3 | 4 | 5;
  name: string;
  type: 'deterministic' | 'llm';
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  elapsed_ms?: number;
  error_count?: number;
}

export interface IronFunnelStatus {
  gates: IronFunnelGateStatus[];
  overall: 'pending' | 'running' | 'passed' | 'failed';
}

export type CriticalPathFlag = {
  isCriticalPath: boolean;
  blockingCount: number;
};
```

### 2. dashboard/src/api/serverApi.ts  [MODIFIED]
Add new read methods:
```typescript
readTaskTier(taskId: string): Promise<TaskTier | null>
readIronFunnelStatus(taskId: string): Promise<IronFunnelStatus | null>
readCriticalPathFlag(taskId: string): Promise<CriticalPathFlag | null>
readGateTimeoutStatus(taskId: string): Promise<{ warnAt: string; escalateAt: string; status: 'ok' | 'warn' | 'escalated' } | null>
```

These read from `.arbiter/iron-funnel-{taskId}.json` (written by IronFunnel.ts on each gate update).

IronFunnel.ts [MODIFIED] writes gate state to a JSON file on each gate change so
the dashboard can poll it without a database connection.

### 3. dashboard/src/features/arbiter/components/JobCard.tsx  [MODIFIED]
Add Tier badge to each job card.

Position: top-right corner of card.
- T1: grey pill — `Tier 1`
- T2: amber pill — `Tier 2`
- T3: blue pill — `Tier 3`

Reads tier from `readTaskTier(taskId)`.
If no tier data (pre-triage or old task): render nothing.

### 4. dashboard/src/features/arbiter/components/JobCard.module.css  [MODIFIED]
Add `.tier-badge`, `.tier-1`, `.tier-2`, `.tier-3` styles.

### 5. dashboard/src/features/pipeline/PipelineView.tsx  [MODIFIED]
Add Iron Funnel 5-gate progress bar to the pipeline detail panel.

Layout:
```
IRON FUNNEL
[🔒 Gate 1: Compiler] → [🤖 Gate 2: Tests Written] → [🔒 Gate 3: Tests Run] → [🤖 Gate 4: Debugger] → [🤖 Gate 5: Review]
  ✓ 1.2s                   ✓ 45s                      ✓ 12s                    — skipped                ⏳ running
```

- 🔒 = deterministic (grey/green icon)
- 🤖 = LLM agent (blue icon)
- Gate 4 shows "— skipped" when Gate 3 passed
- Each gate shows: status icon + name + elapsed time
- Running gate: animated pulse

Reads from `readIronFunnelStatus(taskId)`.
If no Iron Funnel data: render existing stage list (backward compat).

### 6. dashboard/src/features/pipeline/PipelineView.module.css  [MODIFIED]
Add styles: `.iron-funnel`, `.gate`, `.gate-deterministic`, `.gate-llm`,
`.gate-passed`, `.gate-failed`, `.gate-running`, `.gate-skipped`, `.gate-arrow`.

### 7. dashboard/src/features/arbiter/components/JobCard.tsx  [MODIFIED — Critical Path]
If `isCriticalPath: true` from `readCriticalPathFlag(taskId)`: 
Show red banner below task title: `⚠ CRITICAL PATH — blocking {blockingCount} tasks`

### 8. dashboard/src/features/pipeline/PipelineView.tsx  [MODIFIED — Gate Timeout]
Show warning/escalation indicator on stuck gates:
- `status: 'warn'`: amber clock icon + "Open 4h+"
- `status: 'escalated'`: red clock icon + "ESCALATED 8h+" + bold

### 9. IronFunnel.ts  [MODIFIED — gate state file writer]
On each gate state change, write `.arbiter/iron-funnel-{taskId}.json`:
```json
{
  "task_id": "FEAT-001",
  "gates": [
    { "gate": 1, "name": "Compiler Airlock", "type": "deterministic", "status": "passed", "elapsed_ms": 1200 },
    { "gate": 2, "name": "Test Writer", "type": "llm", "status": "passed", "elapsed_ms": 45000 },
    { "gate": 3, "name": "Proving Ground", "type": "deterministic", "status": "running", "elapsed_ms": null },
    { "gate": 4, "name": "Debugger", "type": "llm", "status": "pending" },
    { "gate": 5, "name": "Semantic Review", "type": "llm", "status": "pending" }
  ],
  "updated_at": "2026-05-28T12:00:00Z"
}
```

---

## Tests Required (Playwright — this is the UI phase)

### dashboard/e2e/tier-badge.spec.ts  [NEW]
- Board view: task card with tier=1 shows grey 'T1' badge
- Board view: task card with tier=3 shows blue 'T3' badge
- Task card with no tier data: no badge rendered (no error)

### dashboard/e2e/iron-funnel.spec.ts  [NEW]
- Pipeline view: 5 gates visible when iron-funnel JSON exists
- Gate 1 passed: green check + elapsed time shown
- Gate 4 skipped: "— skipped" text visible
- Gate 3 running: animated pulse on gate indicator
- Pipeline view without iron-funnel data: existing stage list shown (no regression)

### dashboard/e2e/critical-path.spec.ts  [NEW]
- Task with isCriticalPath=true: red banner visible on job card
- Task with isCriticalPath=false: no banner

### dashboard/e2e/smoke.spec.ts  [MODIFIED]
- Extend existing smoke test: verify no console.error() on load after new components

---

## Acceptance Criteria
- [ ] `npm run typecheck` passes (dashboard TypeScript)
- [ ] All Playwright tests pass (tier-badge, iron-funnel, critical-path, smoke)
- [ ] Tier badge appears on job cards (Playwright test)
- [ ] Iron Funnel 5-gate progress bar renders in Pipeline view (Playwright test)
- [ ] Critical path banner renders correctly (Playwright test)
- [ ] Gate timeout warn/escalate indicators render (manual check or test)
- [ ] All existing dashboard views load without errors (smoke test)
- [ ] Dashboard backward compat: tasks without iron-funnel data show existing stage list

---

## Files Changed Summary
| Action | File |
|---|---|
| MODIFIED | dashboard/src/api/types.ts |
| MODIFIED | dashboard/src/api/serverApi.ts |
| MODIFIED | dashboard/src/features/arbiter/components/JobCard.tsx |
| MODIFIED | dashboard/src/features/arbiter/components/JobCard.module.css |
| MODIFIED | dashboard/src/features/pipeline/PipelineView.tsx |
| MODIFIED | dashboard/src/features/pipeline/PipelineView.module.css |
| MODIFIED | src/conductor/IronFunnel.ts |
| NEW | dashboard/e2e/tier-badge.spec.ts |
| NEW | dashboard/e2e/iron-funnel.spec.ts |
| NEW | dashboard/e2e/critical-path.spec.ts |
| MODIFIED | dashboard/e2e/smoke.spec.ts |

---

## Phase 07 DONE when:
All acceptance criteria checked. Then update plan/README.md: Phase 07 → [x]
