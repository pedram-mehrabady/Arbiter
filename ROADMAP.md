# Arbiter v0.3 Roadmap

This document describes the seven features planned for v0.3. Together they close every gap
between Arbiter and tools like Repowire — covering mobile gate approval, scheduled runs,
broader CLI provider support, remote access, multi-repo coordination, live streaming output,
and agent-to-agent communication.

---

## Feature 1 — Telegram + Slack inline gate approval

### Why
Repowire's primary UX advantage is its Telegram/Slack control surface: a gate fires,
your phone buzzes, you tap Approve or Reject without opening a terminal. Today Arbiter's
only human-facing surfaces are the CLI and the local web UI — both require you to be at
your machine. This feature makes Arbiter fully mobile-operable.

### What to build

**`src/notifications/TelegramNotifier.ts`**
Uses the Telegram Bot API (`sendMessage` with `InlineKeyboardMarkup`). When a gate fires,
it sends a message like:

```
⏸ GATE: Design Gate
Task: FEAT-42  |  design_approval
Context: Agent design completed. Review output at .arbiter/tasks/…

[✅ Approve]   [❌ Reject]
```

Each button encodes `gate_id` and action in the `callback_data`. A long-polling loop in
`startPolling()` listens for `callback_query` updates and calls `GatePoller.resolve()`.

**`src/notifications/SlackNotifier.ts`**
Uses Slack Block Kit. Sends a message with two `button` action elements. Slack sends
the button click to an `interactivity_request_url` — a second HTTP endpoint in
`UIServer` handles it (`POST /slack/action`).

**Config additions to `FactoryConfig`:**
```json
"notifications": {
  "telegram": {
    "bot_token": "...",
    "chat_id": "..."
  },
  "slack": {
    "bot_token": "...",
    "channel_id": "...",
    "interactivity_request_url": "https://..."
  }
}
```

**Files to create / modify:**
- `src/notifications/TelegramNotifier.ts` (new)
- `src/notifications/SlackNotifier.ts` (new)
- `src/notifications/WebhookNotifier.ts` — extract shared `notify()` interface
- `src/ui/UIServer.ts` — add `POST /slack/action` handler
- `src/conductor/Conductor.ts` — instantiate notifiers from config
- `src/types/index.ts` — extend `NotificationsConfig`
- `src/bootstrap/Interview.ts` — optional prompt for Telegram/Slack setup
- `src/bootstrap/ConfigGenerator.ts` — emit notification block if configured

**Acceptance criteria:**
- Gate fires → Telegram message arrives with two inline buttons
- Tapping Approve resolves the gate; pipeline continues without terminal input
- Tapping Reject resolves rejected; pipeline halts with `GATE_REJECTED`
- Slack button click calls `POST /slack/action` and resolves the same way
- Both notifiers are fire-and-forget (non-blocking); failure logs a warning, does not halt pipeline
- Works with the existing `WebhookNotifier` alongside (all three can be active simultaneously)

---

## Feature 2 — Scheduled pipeline runs

### Why
Repowire lets agents schedule themselves for future wake-ups. Arbiter's `arbiter watch`
handles file-drop automation, but there is no way to say "run this task every weekday at 9am"
or "run this task once in four hours." This matters for recurring pipelines (nightly doc
generation, scheduled surveys, periodic audits).

### What to build

**`src/scheduler/ScheduleStore.ts`**
Reads/writes `.arbiter/schedule.json` — a list of schedule entries:
```json
[
  {
    "id": "sched-abc123",
    "task_id": "nightly-audit",
    "spec_file": "./specs/audit.md",
    "cron": "0 9 * * 1-5",
    "next_run": "2026-05-29T09:00:00.000Z",
    "last_run": null,
    "enabled": true
  }
]
```
One-shot entries use `run_at` instead of `cron`. Uses the same atomic tmp+rename write
pattern as `GatePoller`.

**`src/scheduler/CronParser.ts`**
A minimal 5-field cron parser (minute, hour, day, month, weekday). No npm dependency —
evaluates next-fire time from a `Date` and a cron string. Only the subset needed:
`*`, specific values, comma lists, and `/` step syntax.

**`arbiter schedule add <task-id>` command**
```
arbiter schedule add nightly-audit \
  --spec ./specs/audit.md \
  --cron "0 9 * * 1-5"

arbiter schedule add one-off \
  --spec ./specs/hotfix.md \
  --at "2026-05-29T14:00"

arbiter schedule list
arbiter schedule remove <id>
arbiter schedule pause <id> / resume <id>
```

**`arbiter daemon` command**
A persistent background process that:
1. Reads `.arbiter/schedule.json` every 60 seconds
2. Fires due entries by calling `TaskInitializer.init()` + `Conductor.conduct()` in-process
3. Updates `last_run` and `next_run` after each fire
4. Writes a PID file to `.arbiter/daemon.pid` (prevents double-start)
5. Graceful shutdown on `SIGINT`/`SIGTERM`

**Files to create / modify:**
- `src/scheduler/ScheduleStore.ts` (new)
- `src/scheduler/CronParser.ts` (new)
- `src/scheduler/Scheduler.ts` (new — the run loop)
- `src/cli/index.ts` — add `schedule` and `daemon` command groups
- `src/types/index.ts` — add `ScheduleEntry` type

**Acceptance criteria:**
- `arbiter schedule add` writes a valid entry to `.arbiter/schedule.json`
- `arbiter daemon` fires the task within 60 seconds of the scheduled time
- `last_run` and `next_run` update correctly after each fire
- Daemon exits cleanly on SIGINT without leaving an orphaned PID file
- `arbiter schedule list` shows ID, task, next run, last run, enabled state
- One-shot entries are automatically disabled (not deleted) after firing

---

## Feature 3 — Codex CLI + Gemini CLI + OpenCode providers

### Why
Repowire's core value proposition is being provider-agnostic — it works with Claude Code,
Codex, Gemini CLI, OpenCode, and Pi via hooks. Arbiter has API providers for OpenAI and
Gemini, but no CLI-based providers for these tools. Users who prefer the CLI tools (or need
them for rate-limit or billing reasons) currently cannot use Arbiter with them.

### What to build

Three new provider files, all following the exact `AnthropicProvider` pattern: spawn the
CLI process, pass the assembled prompt, parse the output.

**`src/providers/CodexProvider.ts`**
Invokes `codex` (OpenAI Codex CLI). Uses `codex --quiet "<prompt>"` or pipes via stdin
depending on the installed version. Parses cost from stderr if available. Falls back to
`MODEL_COSTS` lookup for cost estimation.

**`src/providers/GeminiCliProvider.ts`**
Invokes `gemini` (Google Gemini CLI). Uses `gemini -p "<prompt>"`. Parses the response
from stdout. `estimateCost()` delegates to the existing `MODEL_COSTS` table.

**`src/providers/OpenCodeProvider.ts`**
Invokes `opencode` (OpenCode CLI). Uses `opencode run --no-interactive "<prompt>"` or
equivalent headless flag. Parses stdout for the response.

**Config provider names:**
```json
"providers": {
  "codex":      { "cmd": "codex",    "headless_flag": "--quiet" },
  "gemini_cli": { "cmd": "gemini",   "headless_flag": "-p" },
  "opencode":   { "cmd": "opencode", "headless_flag": "run" }
}
```

**`arbiter init` interview:**
Add three more provider options (choices 6/7/8). `ConfigGenerator` emits the correct
`cmd` + `headless_flag` block.

**Files to create / modify:**
- `src/providers/CodexProvider.ts` (new)
- `src/providers/GeminiCliProvider.ts` (new)
- `src/providers/OpenCodeProvider.ts` (new)
- `src/conductor/Conductor.ts` — add `codex`, `gemini_cli`, `opencode` branches in `loadConfig()`
- `src/bootstrap/Interview.ts` — extend provider menu
- `src/bootstrap/ConfigGenerator.ts` — add cases to `buildProviderConfig()`

**Acceptance criteria:**
- `arbiter conduct` with `codex` provider spawns the `codex` binary and captures output
- Token/cost estimates use `MODEL_COSTS` when the CLI doesn't report them
- `ENOENT` (binary not found) returns `{ ok: false, error: "codex not found in PATH" }` — not an uncaught exception
- All three providers are covered by unit tests using a mock `execFile` (same pattern as `OllamaProvider.test.ts`)

---

## Feature 4 — Remote gate approval tunnel

### Why
`arbiter ui` binds to `127.0.0.1` — it is only reachable on the local machine. Repowire
solves this with an optional relay so you can reach your local agent from a laptop, phone,
or CI machine without opening firewall ports. This feature brings the same capability to
Arbiter without requiring a third-party service.

### What to build

**`src/tunnel/TunnelServer.ts`**
Establishes a persistent TCP connection to a relay server and forwards HTTP traffic to the
local `UIServer` port. The relay assigns a unique subdomain (`<random>.arbiter-relay.io`)
and proxies incoming HTTPS requests over the TCP tunnel.

The self-hosted relay is a separate lightweight Node.js process (published as
`arbiter-relay` on npm). Users can run their own relay or use the public one at
`relay.arbiter-pipeline.dev`.

Protocol: the tunnel client sends a `REGISTER` frame with a random token; the relay
assigns a subdomain and tunnels all subsequent HTTP frames to the client over the same
TCP connection. TLS is terminated at the relay.

**`arbiter ui --tunnel` flag**
```
arbiter ui --tunnel
# Output:
Arbiter UI listening at http://localhost:4747
Tunnel active at https://abc123.arbiter-relay.dev
```

**`arbiter ui --tunnel --relay <url>` flag**
Points at a self-hosted relay instead of the public one.

**Files to create / modify:**
- `src/tunnel/TunnelServer.ts` (new)
- `src/ui/UIServer.ts` — accept optional `TunnelServer` and print the public URL on start
- `src/cli/index.ts` — add `--tunnel` and `--relay` options to `arbiter ui`
- `packages/arbiter-relay/` (new package, separate npm publish) — the relay server

**Acceptance criteria:**
- `arbiter ui --tunnel` prints a working HTTPS URL within 5 seconds
- Opening the URL on a different machine loads the gate approval page
- Approving a gate via the tunnel URL resolves it locally; the pipeline continues
- Killing `arbiter ui` tears down the tunnel cleanly (TCP FIN sent to relay)
- If relay is unreachable, `--tunnel` logs a warning and falls back to local-only mode

---

## Feature 5 — Multi-repo task dependencies

### Why
Repowire's defining architectural feature is its mesh: agents across multiple repos know
about each other and can coordinate. Today Arbiter is entirely per-workspace — there is no
way for a `foederata-api` task to wait for a `foederata-web` task to complete, or for a
shared-library task to block downstream consumers.

### What to build

**`depends_on_workspace` in `TaskState`**
```json
{
  "task_id": "FEAT-12",
  "depends_on_workspace": [
    { "project_id": "foederata-api", "task_id": "FEAT-12", "required_status": "completed" }
  ]
}
```

**`WorkspaceDependencyChecker`**
At the top of `runLoop()`, before checking eligible sub-tasks, the conductor reads the
`depends_on_workspace` list. For each entry it looks up the project root from
`~/.arbiter/projects.json`, reads that workspace's `.arbiter/state.json`, and checks
whether the required task has the required status. If not, it sleeps and polls (same
pattern as `waitForApproval`).

**`arbiter conduct --wait-for <project-id>@<task-id>` flag**
Shortcut to add a workspace dependency at runtime without editing `state.json`:
```
arbiter conduct FEAT-12 --wait-for foederata-api@FEAT-12
```

**`arbiter status --all` command**
Prints status for all registered workspaces:
```
foederata-web    FEAT-12  in_progress  (5/11 sub-tasks)
foederata-api    FEAT-12  completed
foederata-docs   FEAT-13  pending
```

**Files to create / modify:**
- `src/dependencies/WorkspaceDependencyChecker.ts` (new)
- `src/conductor/Conductor.ts` — call `WorkspaceDependencyChecker` at top of `runLoop()`
- `src/cli/index.ts` — add `--wait-for` flag to `conduct`; add `--all` to `status`
- `src/types/index.ts` — add `WorkspaceDependency` type and `depends_on_workspace` to `TaskState`
- `src/bootstrap/ProjectRegistry.ts` — add `getRoot(projectId)` helper

**Acceptance criteria:**
- `arbiter conduct FEAT-12 --wait-for foederata-api@FEAT-12` blocks until `foederata-api`'s task is `completed`
- Polls every 10 seconds; logs a single status line each poll cycle
- `arbiter status --all` prints the cross-workspace summary table
- If a depended-upon workspace is not registered, returns a clear error (not a crash)
- Dependency check is skipped in `--dry-run` mode

---

## Feature 6 — Server-Sent Events streaming in web UI

### Why
The current web UI auto-refreshes every 10 seconds. This means up to a 10-second lag
between "agent completes" and "browser shows it." Repowire provides live visibility into
what agents are doing. SSE gives the same experience without WebSockets and without any
client-side framework.

### What to build

**`EventBus` in `src/ui/EventBus.ts`**
A singleton `EventEmitter` shared between `Conductor` and `UIServer`. Events:
```typescript
type PipelineEvent =
  | { type: 'agent_start';    taskId: string; subTaskId: string; role: string; model: string }
  | { type: 'agent_complete'; taskId: string; subTaskId: string; role: string; durationMs: number }
  | { type: 'agent_output';   taskId: string; subTaskId: string; chunk: string }
  | { type: 'gate_created';   taskId: string; gateId: string; gateType: string }
  | { type: 'gate_resolved';  taskId: string; gateId: string; status: 'approved' | 'rejected' }
  | { type: 'pipeline_done';  taskId: string }
  | { type: 'pipeline_error'; taskId: string; message: string }
```

**SSE endpoint in `UIServer`**
`GET /events` returns `text/event-stream`. Each `PipelineEvent` is serialized as
`data: <json>\n\n`. The server keeps the response open and writes events as they arrive
from the `EventBus`. On client disconnect, the listener is removed.

**Updated `pages.ts`**
Removes `<meta http-equiv="refresh">`. Adds a small inline `<script>` block that opens an
`EventSource('/events')` and updates the DOM on each event: sub-task rows update status,
gate rows appear/disappear, a live log panel streams `agent_output` chunks.

**Conductor integration**
`Conductor` accepts an optional `EventBus` in its constructor (injected from `arbiter ui`
command, not during `arbiter conduct`). Emits events at each significant point in
`runSubTask()` and `runLoop()`.

**Files to create / modify:**
- `src/ui/EventBus.ts` (new)
- `src/ui/UIServer.ts` — add `GET /events` SSE handler; accept optional `EventBus`
- `src/ui/pages.ts` — remove polling `<meta>`; add SSE client script
- `src/conductor/Conductor.ts` — accept optional `EventBus`; emit events
- `src/cli/index.ts` — pass `EventBus` from `arbiter ui` to `Conductor`

**Acceptance criteria:**
- Sub-task status changes appear in the browser within 500ms of the event
- Gate rows appear immediately when a gate fires; disappear after approval/rejection
- `agent_output` chunks stream into a live log panel as the model writes them
- On pipeline completion, the page shows a "Pipeline complete" banner
- SSE client reconnects automatically if the connection drops (EventSource built-in)
- No new npm dependencies

---

## Feature 7 — Agent question bus

### Why
Repowire's P2P mesh lets agents send messages to each other and wait for replies. Arbiter
agents currently cannot communicate — each one runs in isolation and writes its output
file. A question bus gives agents a structured way to ask a clarifying question that either
a later agent or a human answers before the pipeline continues. This enables dynamic
pipelines without breaking Arbiter's determinism guarantee.

### What to build

**`src/questions/QuestionBus.ts`**
Reads/writes `.arbiter/questions.json` using the same atomic tmp+rename pattern as
`GatePoller`. A question entry:
```json
{
  "question_id": "q-plan-FEAT-12-1748400000",
  "task_id": "FEAT-12",
  "asked_by": "plan",
  "addressed_to": "integrator",
  "question": "Does the contracts module expose a bulk-fetch endpoint we can reuse?",
  "status": "open",
  "answer": null,
  "asked_at": "2026-05-29T09:00:00Z",
  "answered_at": null
}
```

`addressed_to` can be an agent role name **or** the special value `"human"`. Questions
addressed to a human create a gate (type `question_approval`) that the human resolves via
`arbiter gate approve <gate-id> --answer "Yes, endpoint is /api/contracts/bulk"`.

Questions addressed to an agent role are injected into that agent's context on its next
invocation as an extra `# QUESTIONS` section. The addressed agent answers by writing
a structured response at the end of its output file; `QuestionBus` parses it and marks
the question `answered`.

**New gate type: `question_approval`**
Added to `GateRegistry`. The context field carries the question text; the `comment`
field on resolution carries the human's answer.

**Context injection in `ContextAssembler`**
Before building the final prompt, `assemble()` calls `QuestionBus.getPending(role, taskId)`.
Any open questions addressed to this role are appended as a `# QUESTIONS FOR YOU` section.
After the agent output is written, `QuestionBus.parseAnswers(output, role, taskId)` scans
for a `## My Answers` section and marks questions answered.

**`arbiter questions list` command**
```
arbiter questions list
  q-plan-FEAT-12-1   [open]     asked by: plan → integrator
  q-plan-FEAT-12-2   [answered] asked by: plan → human
```

**Files to create / modify:**
- `src/questions/QuestionBus.ts` (new)
- `src/gates/GateRegistry.ts` — add `question_approval` gate type
- `src/context/ContextAssembler.ts` — inject pending questions; parse answers
- `src/conductor/Conductor.ts` — pass `QuestionBus` to `ContextAssembler`; handle `question_approval` gates
- `src/cli/index.ts` — add `arbiter questions list`; extend `gate approve` to accept `--answer`
- `src/types/index.ts` — add `QuestionEntry` type

**Acceptance criteria:**
- Agent writes a question in its output → `QuestionBus` parses and stores it
- Human-addressed question creates a `question_approval` gate; `arbiter gate approve --answer` resolves it and stores the answer
- Agent-addressed question appears in the addressed agent's context on next invocation
- Answered questions are injected as context for all subsequent agents in the task
- `arbiter questions list` shows all questions and their status for the active task
- Questions do not block the pipeline unless `addressed_to` is `"human"` (agent questions are best-effort)

---

## Implementation order

| # | Feature | Estimated effort | Dependency |
|---|---|---|---|
| 3 | Codex / Gemini CLI / OpenCode providers | 1 day | none |
| 2 | Scheduled pipeline runs | 2 days | none |
| 1 | Telegram + Slack inline approval | 2 days | none |
| 6 | SSE streaming UI | 2 days | none |
| 4 | Remote gate approval tunnel | 3 days | Feature 1 (tunnel complements UI) |
| 5 | Multi-repo dependencies | 2 days | none |
| 7 | Agent question bus | 3 days | Feature 6 (SSE makes Q&A live) |

Features 1, 2, 3, and 6 are independent and can be parallelised. Features 4 and 7 have
soft dependencies on earlier features but can be started any time.
