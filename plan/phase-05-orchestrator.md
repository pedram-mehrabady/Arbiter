# Phase 05 — Orchestrator Agent + Event-Driven Dispatch
# Status: [x] COMPLETE — 2026-05-28
# Prerequisite: Phase 03 (IronFunnel — Gate 5 stub live), Phase 04 (Contracts)

## Objective
Replace Gate 5's stub with a real LLM Orchestrator (Opus). Write the Orchestrator
and Investigator agent rule books. Wire event-driven dispatch: LLM process starts per
event, reads SQLite state, responds, terminates. Dashboard chat tab wired through
Conductor → Orchestrator → SQLite rather than directly to the LLM. After this phase:
Gate 5 does real semantic review. Chat tab maintains full history across page refreshes.

---

## Deliverables

### 1. agents/orchestrator/rules.md  [NEW]
Merged Coordinator + Babysitter rule book.

Sections:
1. Identity: "You are the Orchestrator. You see the full task lifecycle across both pipelines."
2. Memory model: "Your memory is orchestrator_state.chat_history injected each wakeup. No persistent session."
3. Full pipeline behavior: Phase 1 → Phase 2 → Iron Funnel sequence. Which agents run.
4. Speed pipeline behavior: design (single pass) → frontend → backend → test-writer → reviewer.
5. Chat mode: read injected history + new message → answer concisely → do not re-run agents.
6. Gate 5 review mode: given PR diff + contracts + task.md → approve OR reject with ONE specific reason.
7. Failure mode: given failed gate logs → write failure summary to 07-failed. Extract 3 lessons.
8. Lessons capture: on task complete → append 3 lessons to engine/CLI-LESSONS-LEARNED.md.
9. PR comment mode (Phase 06): classify comment as code_change | question | lgtm.

Critical rule (must be in rule book):
"You START when Conductor wakes you. You STOP when you have responded.
 You have NO memory outside what is injected in your context. Never assume continuity."

### 2. agents/orchestrator/manifest.yaml  [NEW]
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
never:
  - src/
  - dashboard/
token_budget: 32000
```

### 3. src/orchestrator/OrchestratorDispatcher.ts  [NEW]
The event-driven wrapper. Called by Conductor and by the HTTP API.

```typescript
type OrchestratorTrigger =
  | 'user_chat'
  | 'gate5_reached'
  | 'gate_failed_twice'
  | 'task_complete'
  | 'pr_comment'      // Phase 06
  | 'conductor_query';

interface OrchestratorDispatcher {
  wake(
    taskId: string,
    trigger: OrchestratorTrigger,
    payload: Record<string, unknown>,
  ): Promise<OrchestratorResponse>;
}
```

Internals:
1. Load orchestrator_state from SqliteStore
2. Build context: saved chat_history + trigger + payload + task artifacts
3. Enforce token budget (32k): prune oldest chat_history entries if needed
4. Call LLM with orchestrator rule book
5. Parse response
6. Save response to orchestrator_state.chat_history in SqliteStore
7. Return response
8. LLM process terminates — no session held open

### 4. src/conductor/IronFunnel.ts  [MODIFIED]
Replace Gate 5 stub with real OrchestratorDispatcher call:
```typescript
// Gate 5: Orchestrator Semantic Review
const g5 = await orchestrator.wake(taskId, 'gate5_reached', {
  prDiff: worktreeDiff,
  contracts: contractFiles,
  taskMd: taskMdContent,
});
if (g5.decision === 'approve') {
  await worktreeManager.pushAndOpenPR(taskId);
} else {
  // g5.reason is one specific reason — send back to Generator
  return { passed: false, gate: 5, reason: g5.reason };
}
```

### 5. src/api/OrchestratorHttpApi.ts  [NEW]
Lightweight HTTP handler (no Express) used by dashboard chat tab.

Endpoints:
- `POST /api/orchestrator/chat` — body: `{ taskId, message }` → wakes Orchestrator with trigger 'user_chat'
- `GET /api/orchestrator/history?taskId=X` → returns chat_history from SqliteStore

This server is started by the Conductor when `--dashboard` flag is present.
Listens on port 7474.

### 6. dashboard/src/features/flow/AgentDocModal.tsx  [MODIFIED — minor]
AgentDocModal already exists. No change needed — agent docs are already displayed.
Verify: clicking an agent card in FlowView opens the correct rule book content.

### 7. dashboard/src/components/AssistantChat.tsx  [MODIFIED]
Current: sends messages directly to `src/api/llm/anthropic.ts`
Change: sends to `http://localhost:7474/api/orchestrator/chat` when a taskId is set.
  - If no taskId (no active task): keep existing direct-to-LLM behavior as fallback
  - On response: read full history from `GET /api/orchestrator/history?taskId=X`
  - History renders from SQLite (persists across page refresh)

Change is additive — existing behavior preserved when no Conductor is running.

### 8. src/conductor/Conductor.ts  [MODIFIED]
- Instantiate OrchestratorDispatcher
- On task_complete: wake Orchestrator with 'task_complete' trigger
- On gate_failed_twice: wake Orchestrator with 'gate_failed_twice' trigger
- Start OrchestratorHttpApi when dashboard mode active

---

## Tests Required

### Unit tests
- tests/unit/OrchestratorDispatcher.test.ts  [NEW]
  - Loads orchestrator_state from SqliteStore before calling LLM (mock)
  - Appends response to chat_history in SqliteStore after call
  - Prunes oldest history entries when token budget exceeded
  - Gate 5 'approve' decision triggers PR open
  - Gate 5 'reject' decision sends reason back to generator
  - task_complete trigger causes lessons to be extracted

### Dashboard E2E (Playwright)
- dashboard/e2e/chat.spec.ts  [NEW]
  - Chat tab visible when dashboard loads
  - Type a message → response appears (mock OrchestratorHttpApi)
  - History persists after page refresh (reads from mock SqliteStore)
  - No direct LLM calls when OrchestratorHttpApi is reachable

---

## Acceptance Criteria
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `agents/orchestrator/rules.md` and `manifest.yaml` exist
- [ ] OrchestratorDispatcher correctly appends to chat_history in SqliteStore (unit test)
- [ ] Gate 5 no longer auto-approves — calls OrchestratorDispatcher with LLM (mock in tests)
- [ ] Dashboard chat sends to `http://localhost:7474/api/orchestrator/chat` when available
- [ ] Chat history survives page refresh (reads from SQLite via HTTP API)
- [ ] Playwright chat test passes
- [ ] All existing Playwright tests still pass

---

## Files Changed Summary
| Action | File |
|---|---|
| NEW | agents/orchestrator/rules.md |
| NEW | agents/orchestrator/manifest.yaml |
| NEW | src/orchestrator/OrchestratorDispatcher.ts |
| NEW | src/api/OrchestratorHttpApi.ts |
| MODIFIED | src/conductor/IronFunnel.ts |
| MODIFIED | src/conductor/Conductor.ts |
| MODIFIED | dashboard/src/components/AssistantChat.tsx |
| NEW | tests/unit/OrchestratorDispatcher.test.ts |
| NEW | dashboard/e2e/chat.spec.ts |

---

## Phase 05 DONE when:
All acceptance criteria checked. Then update plan/README.md: Phase 05 → [x]
