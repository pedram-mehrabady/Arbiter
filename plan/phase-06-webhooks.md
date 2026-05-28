# Phase 06 — Webhook Loop + PR Comment Reactions
# Status: [x] COMPLETE — 2026-05-28
# Prerequisite: Phase 05 (OrchestratorDispatcher, OrchestratorHttpApi running)

## Objective
Close the loop between the Iron Funnel and the outside world. When CI finishes on an
Arbiter PR, the Conductor resumes automatically. When a human leaves a PR comment,
the Conductor wakes the Orchestrator, classifies the comment, and if it's a code change
request dispatches the Coder back into the existing Worktree to fix and push.
After this phase: zero manual intervention for CI + human review feedback loop.

---

## Deliverables

### 1. src/webhooks/WebhookReceiver.ts  [NEW]
Lightweight HTTP server, no Express. Runs on port 7475 (separate from OrchestratorHttpApi).

Handles POST /webhook:
- Validates `X-Hub-Signature-256` header (HMAC-SHA256 with project secret from arbiter.config.json)
- Parses GitHub webhook event type from `X-GitHub-Event` header
- Routes to handler:
  - `workflow_run` (completed) → CiResultHandler
  - `pull_request_review_comment` or `issue_comment` on PR → PrCommentHandler
- Writes raw event to SqliteStore events table (event_type: 'inbound_webhook')
- Returns 200 immediately (async handler, never blocks webhook delivery)

Signature validation utility:
```typescript
function validateSignature(body: Buffer, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

### 2. src/webhooks/CiResultHandler.ts  [NEW]
Handles GitHub `workflow_run` webhook.

```typescript
interface CiResultPayload {
  taskId: string;      // extracted from PR branch name: arbiter-{taskId}
  conclusion: 'success' | 'failure' | 'cancelled';
  prUrl: string;
  runUrl: string;
}
```

On success:
- Move task to `06-completed` in exec-plan folder
- Update tasks.status = 'completed' in SqliteStore
- Wake Orchestrator with 'task_complete' trigger

On failure:
- Read CI failure logs (via GitHub API if token available, else log URL)
- Dispatch Debugger agent for one final fix attempt
- Re-run Iron Funnel Gates 1–3 on the fix
- If fix passes: re-push PR branch
- If fix fails: mark task 'failed', notify owner

Branch name convention for task ID extraction:
Arbiter PR branches follow pattern: `feat/arbiter-{taskId}-*`

### 3. src/webhooks/PrCommentHandler.ts  [NEW]
Handles GitHub PR comment webhook.

```typescript
interface PrCommentPayload {
  taskId: string;
  comment: string;
  prNumber: number;
  prDiff: string;       // populated from GitHub API
  author: string;
  isReviewComment: boolean;
}
```

Flow:
1. Wake Orchestrator with 'pr_comment' trigger + comment + diff
2. Orchestrator classifies: `code_change | question | lgtm`
3. If `code_change`:
   - Verify worktree still exists (or recreate from PR branch)
   - Dispatch Coder with: diff + comment + contracts
   - Run Gate 1 on patch only (targeted re-check)
   - Git commit + push to same PR branch (no new PR)
4. If `question`:
   - Post reply via `gh pr comment {prNumber} --body "{response}"`
5. If `lgtm`:
   - Move task to 06-completed

### 4. WebhookNotifier.ts  [MODIFIED]
Add new outbound event types:
```typescript
export type WebhookEvent =
  | 'gate_created'
  | 'task_complete'
  | 'task_failed'
  | 'pr_comment_received'
  | 'ci_result_received'
  | 'gate_timeout_warn'
  | 'gate_timeout_escalate';
```

Add `notify()` calls for timeout events (from IronFunnel.ts gate timer).

### 5. arbiter.config.json  [MODIFIED]
Add webhook receiver config:
```json
"webhook_receiver": {
  "port": 7475,
  "secret": "{{WEBHOOK_SECRET}}",
  "enabled": true
}
```

Also add GitHub token field for reading CI logs:
```json
"github": {
  "token": "{{GITHUB_TOKEN}}",
  "owner": "{{GITHUB_OWNER}}",
  "repo": "{{GITHUB_REPO}}"
}
```

### 6. src/conductor/Conductor.ts  [MODIFIED]
- Start WebhookReceiver when `--webhooks` flag is present
- CiResultHandler and PrCommentHandler receive reference to Conductor methods
- Wire: conductor.resumeFromCiResult() and conductor.handlePrComment()

---

## Tests Required

### Unit tests
- tests/unit/WebhookReceiver.test.ts  [NEW]
  - Rejects request with invalid HMAC signature
  - Accepts request with valid HMAC signature
  - Routes workflow_run to CiResultHandler
  - Routes pull_request_review_comment to PrCommentHandler
  - Returns 200 immediately (non-blocking)

- tests/unit/CiResultHandler.test.ts  [NEW]
  - Extracts taskId from PR branch name `feat/arbiter-FEAT-001-add-login`
  - On success: updates SqliteStore task status to 'completed'
  - On failure: dispatches Debugger agent (mock)

- tests/unit/PrCommentHandler.test.ts  [NEW]
  - Orchestrator returns 'code_change' → Coder dispatched (mock)
  - Orchestrator returns 'question' → gh pr comment called (mock execFile)
  - Orchestrator returns 'lgtm' → task marked completed

---

## Acceptance Criteria
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] WebhookReceiver rejects invalid HMAC signatures (unit test)
- [ ] CiResultHandler extracts taskId from branch name (unit test)
- [ ] PrCommentHandler dispatches coder on 'code_change' classification (unit test)
- [ ] WebhookNotifier sends gate_timeout_warn and gate_timeout_escalate events
- [ ] `arbiter.config.json` has webhook_receiver and github fields
- [ ] Playwright smoke test still passes

---

## Files Changed Summary
| Action | File |
|---|---|
| NEW | src/webhooks/WebhookReceiver.ts |
| NEW | src/webhooks/CiResultHandler.ts |
| NEW | src/webhooks/PrCommentHandler.ts |
| MODIFIED | src/notifications/WebhookNotifier.ts |
| MODIFIED | arbiter.config.json |
| MODIFIED | src/conductor/Conductor.ts |
| NEW | tests/unit/WebhookReceiver.test.ts |
| NEW | tests/unit/CiResultHandler.test.ts |
| NEW | tests/unit/PrCommentHandler.test.ts |

---

## Phase 06 DONE when:
All acceptance criteria checked. Then update plan/README.md: Phase 06 → [x]
