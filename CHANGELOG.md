# Changelog

All notable changes to `@arbiter-pipeline/cli` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
