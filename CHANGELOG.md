# Changelog

All notable changes to `arbiter-pipeline` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — v0.3.0

See [ROADMAP.md](./ROADMAP.md) for full feature descriptions, acceptance criteria, and implementation notes.

### Planned

- **Telegram + Slack inline gate approval** — native bot/webhook notifications with Approve/Reject buttons; no separate tool needed for mobile gate management
- **Scheduled pipeline runs** — cron-style and one-shot scheduling via `.arbiter/schedule.json`; `arbiter schedule` and `arbiter daemon` commands
- **Codex CLI + Gemini CLI + OpenCode providers** — command-based provider adapters matching the existing `AnthropicProvider` pattern
- **Remote gate approval tunnel** — `arbiter ui --tunnel` exposes the local UI over a secure public URL for cross-machine gate approval
- **Multi-repo task dependencies** — tasks can declare `depends_on_workspace` pointing to another registered project; Arbiter blocks until the remote task completes
- **Server-Sent Events streaming in web UI** — live agent output in the browser; replaces 10-second polling refresh
- **Agent question bus** — structured ask/reply channel in `.arbiter/questions.json`; agents can pose questions that a later agent (or human) answers before the pipeline continues

---

## [0.2.0] — 2026-05-28

### Multi-task support

- **TaskArchiver** — archive active task to `.arbiter/archive/<task-id>.json`, freeing the workspace slot; restore any archived task back to active
- `arbiter task archive <task-id>` / `arbiter task restore <task-id>` commands
- `arbiter task list --archived` shows both active and archived tasks
- `arbiter task templates` lists the four built-in spec templates

### Gate notifications (webhook)

- **WebhookNotifier** — fires `gate_created`, `task_complete`, `task_failed` events to any HTTP endpoint; HMAC-SHA256 signed with optional `secret`
- `notifications` block in `FactoryConfig` (`webhook_url`, `on_gate`, `on_complete`, `on_failure`, `secret`)
- `GatePoller.setNotifier()` — injected by Conductor after config load

### New providers

- **OpenAIProvider** — native `fetch`-based provider; supports gpt-4o, gpt-4o-mini, o1, o1-mini, o3-mini; reads `OPENAI_API_KEY`
- **GeminiProvider** — native `fetch`-based provider; supports gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-pro/flash; reads `GEMINI_API_KEY`
- `arbiter init` interview extended to 5 provider choices (+ openai, gemini)
- `MODEL_COSTS` table updated with 10 new model entries across OpenAI and Gemini
- `ConfigGenerator` generates correct provider config and tiered role-model assignments for all five providers

### Git auto-commit

- **GitAutoCommit** — runs `git add -A && git commit` after each sub-task completes; injection-safe `execFile` (no shell expansion); configurable `message_template` with `{{task_id}}`, `{{sub_task_id}}`, `{{agent_role}}` tokens; optional `author_name`/`author_email`
- `git_auto_commit` block in `FactoryConfig` (`enabled`, `author_name`, `author_email`, `message_template`)

### Task spec templates

- Four built-in templates in `agents/templates/tasks/`: `new-feature.md`, `bug-fix.md`, `refactor.md`, `api-endpoint.md`
- `arbiter task init <task-id> --template <name>` resolves template from workspace-local path first, then package-bundled path

### Web UI

- **UIServer** — local HTTP server (`arbiter ui --port 4747`); renders pipeline status and pending gates; Approve/Reject buttons submit to `POST /gate/approve` and `POST /gate/reject`; auto-refreshes every 10 seconds
- HTML is server-rendered (no client JS framework); no new npm dependencies

### Spec watcher

- **SpecWatcher** — polls a directory for new `.md` files; auto-inits and conducts each file as a task; moves completed specs to `processed/`, failed specs to `error/`
- `arbiter watch --dir <path>` command; configurable `--interval`
- `watch` block in `FactoryConfig` (`spec_dir`, `poll_interval_ms`)

---

## [0.1.1] — 2026-05-27

### Fixed

- **`arbiter init` interview stored "1" literally** for frontend/backend choices — added numbered menu display (`1) react  2) next  …`) and lookup maps (`FRONTEND_MAP`, `BACKEND_MAP`) that resolve number inputs to framework names
- **`bin` field executable bit** — changed build script to `tsc && chmod +x dist/cli/index.js`; npm no longer strips the `bin[arbiter]` entry at publish time
- **Commander.js camelCase options** — `--non-interactive` correctly read as `opts['nonInteractive']`; `--dry-run` as `opts['dryRun']`; `--max-parallel` as `opts['maxParallel']`
- **`task list` missing status annotation** — now reads `state.json` and marks the active task with `*  [status]`
- **`task show` command added** — was missing; now prints per-sub-task status table for a named task

---

## [0.1.0] — 2026-05-27

Initial public release.

### Core pipeline engine

- **Conductor** — orchestrates the 12-agent pipeline with configurable parallelism, resume checkpoints, and gate enforcement
- **StateStore** — atomic JSON state with concurrent-write safety (unique tmp-rename per write)
- **TaskQueue** — dependency-graph scheduling; static helpers `getEligible`, `isComplete`, `hasFailed`, `isDeadlocked`
- **RateLimiter** — per-day USD spend cap with context-token warning threshold; appends to `.arbiter/usage.jsonl`
- **GatePoller** — creates, polls, and resolves the four human gates (design, plan, review, debugger-rewrite)
- **EvidenceCache** — design-phase cache keyed by SHA-256 of sorted module set; skips design+critic when blast radius is unchanged
- **BundleAssembler** — assembles `AUDIT-EVIDENCE-BUNDLE.zip` with Ed25519-signed manifest, SHA-256 artifact hashes, and CC ALC control mapping
- **DebuggerGuard** — enforces four pipeline invariants (P1–P5); triggers a gate when debugger rewrites >20% of original output
- **PlanValidator** — validates plan agent JSON output, enforces complexity cap (max 9), detects dependency cycles, and injects plan-defined sub-tasks into state
- **ComplexityScorer** — weighted scoring: file_count + deps×1 + crypto×2 + migration×3 + cross-module×1
- **PreflightCheck** — secrets scanner + context-size checks before agent invocation
- **ContextAssembler** — per-role context manifests; loads `agents/templates/<role>.md` as system prompt with `{{VAR}}` substitution
- **DecisionLog** — append-only JSONL audit trail at `.arbiter/decision-log.jsonl`
- **BuildReceiptStore** — Ed25519-signed receipts for every completed sub-task

### Providers

- **AnthropicProvider** — spawns the `claude` CLI in headless mode; parses rate-limit headers from stderr
- **AnthropicSdkProvider** — direct `@anthropic-ai/sdk` integration; handles 429/401/5xx, AbortError timeout
- **OllamaProvider** — calls Ollama REST API (`POST /api/generate`, `stream: false`); zero cost; ECONNREFUSED detection

### Bootstrap (`arbiter init`)

- **Scanner** — auto-detects frontend/backend/database/test framework, package manager, TypeScript, architecture
- **Interview** — 6-question interactive CLI setup (provider, stack, conventions, audience, gates)
- **ConfigGenerator** — writes `arbiter.config.json` with model-tiered role assignments, gates section, and `template_vars`; creates `agents/docs/master-directives.md`
- **ProjectRegistry** — global `~/.arbiter/projects.json` registry; tracks active project
- `--non-interactive` flag accepts auto-detected defaults without prompts

### CLI commands

| Command | Description |
|---------|-------------|
| `arbiter init` | Scan repo, interview, generate config |
| `arbiter conduct <task-id>` | Run pipeline; prints cost/time/count summary on completion |
| `arbiter conduct --resume` | Resume from checkpoint, reset interrupted sub-tasks |
| `arbiter task init <task-id> --spec <file>` | Initialise task state from spec |
| `arbiter task reset <task-id>` | Reset sub-tasks to pending, clear stale gates |
| `arbiter gate list / approve / reject` | Manage human gates |
| `arbiter status` | Show current sub-task status table |
| `arbiter usage` | Show today's spend and budget headroom |
| `arbiter bundle create / verify / list` | Assemble and verify audit evidence bundles |
| `arbiter audit verify / log` | Verify receipt chain; print decision log |
| `arbiter projects list` | List registered projects |
| `arbiter preflight check` | Run pre-flight checks without spawning agents |
| `arbiter cache invalidate` | Invalidate evidence cache entries |
| `arbiter queue list` | Show queued tasks |

### Agent templates

13 role templates in `agents/templates/` with `{{STACK_*}}` and `{{PROJECT_CONVENTIONS}}` placeholder substitution:
`reframe`, `research`, `design`, `design-critic`, `integrator`, `plan`, `frontend`, `backend`, `test-writer`, `reviewer`, `tech-writer`, `debugger`, `surveyor`

### Testing

- 103 tests: 77 unit tests (StateStore, TaskQueue, PlanValidator, EvidenceCache, RateLimiter, AnthropicSdkProvider, OllamaProvider) + 10 E2E integration tests + 16 provider tests
- GitHub Actions CI: Node 18/20/22 matrix on every push and PR

### Packaging

- `prepublishOnly` runs typecheck → test → build
- `exports` map for clean ESM/CJS resolution
- `engines: { node: ">=18.0.0" }`

[0.1.0]: https://github.com/pedram-mehrabady/Arbiter/releases/tag/v0.1.0
