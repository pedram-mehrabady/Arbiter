# Arbiter

**Ship with AI agents that ask before they act.**

Arbiter is an open-source, human-in-the-loop AI development pipeline. It runs 13 specialized agents in a fixed sequence — reframe, research, design, design-critic, integrator, plan, implementation agents, reviewer, tech-writer — and pauses at human gates before each major phase transition. Every agent output is signed with Ed25519 and collected into a signed AUDIT-EVIDENCE-BUNDLE.zip for compliance audit.

- CLI: `arbiter`
- Package: `arbiter-pipeline`
- GitHub: [pedram-mehrabady/Arbiter](https://github.com/pedram-mehrabady/Arbiter)

---

## Why Arbiter

Most AI coding tools sit at one of two extremes: co-pilots that assist line by line, or autonomous agents that run until they are done. Arbiter occupies a third position — a pipeline of specialists where you retain authority at every phase boundary.

| Tool | Model | Human control |
|---|---|---|
| Cursor / Copilot | Co-pilot every line | Always on |
| Devin / OpenHands | Fully autonomous | Minimal |
| Claude Code | Chat-driven single agent | You direct each step |
| **Arbiter** | **Pipeline of specialists** | **Gates at every major phase** |

---

## Features

- **13 specialized agents** — each agent has a single role and a scoped system prompt; no agent is asked to do more than one job.
- **Human gates** — the pipeline pauses at the Design gate, Plan gate, and Review gate. Nothing continues until you approve. Gates are configurable.
- **Ed25519 receipt chain** — every agent output is hashed and signed. Receipts chain to the previous receipt, making tampering detectable.
- **Audit evidence bundle** — a signed ZIP (`AUDIT-EVIDENCE-BUNDLE.zip`) containing all receipts, artifacts, and the decision log, ready for compliance audit.
- **Resume from checkpoint** — `--resume` re-reads verified receipts and skips sub-tasks that have already passed, so a failed run does not restart from scratch.
- **Design evidence cache** — when the blast radius of a change is unchanged from a previous run, Arbiter reuses cached design artifacts and skips the design phase entirely.
- **Provider-agnostic** — works with Claude Max CLI, Anthropic SDK, and Ollama. Mix providers per role.
- **Model tiering per role** — assign expensive models (Opus) to high-stakes roles (integrator, plan, reviewer) and faster models (Haiku) to cheaper roles (design-critic, test-writer).
- **Enforced invariants** — I6 guarantees test-writer uses a different model family from implementation agents; I7 guarantees design-critic uses a different model family from the design agent. Both are checked at preflight.

---

## Install

```
npm install -g arbiter-pipeline
```

Requires Node 18+ and the [Claude Code CLI](https://github.com/anthropics/claude-code).

---

## Quick Start

**Step 1 — Initialize Arbiter in your project.**

Run this once per repository. Arbiter scans the repo, asks a few questions, and generates `arbiter.config.json` and the `.arbiter/` directory.

```
arbiter init
```

**Step 2 — Write a spec file.**

Create a short markdown file that describes the feature or change. Example:

```markdown
# FEAT-01 — User CSV export

## Goal
Allow authenticated users to export their transaction list as a CSV file.

## Constraints
- Max 10,000 rows per export
- Filename must include the UTC timestamp
- Respect existing row-level permission filters
```

**Step 3 — Initialize the task and run the pipeline.**

```
arbiter task init FEAT-01 --spec spec.md
arbiter conduct FEAT-01
```

The pipeline runs phases 1–2, then pauses at the Design gate.

**Step 4 — Work the gates.**

```
arbiter gate list
arbiter gate approve <gate-id>
```

After approval the pipeline continues to the next phase. Repeat for the Plan gate and Review gate.

---

## Pipeline

```
Phase 1  Analysis
         reframe --> research
                          |
Phase 2  Design           v
         design --> design-critic --> integrator
                                           |
                                      [DESIGN GATE] <-- human approval required
                                           |
Phase 3  Plan             v
         plan  (complexity score + granular sub-tasks)
                          |
                     [PLAN GATE] <-- human approval required
                          |
Phase 4  Implementation   v
         frontend / backend / ... --> test-writer
                                           |
                                    [REVIEW GATE] <-- human approval required
                                           |
                                     reviewer --> tech-writer
                                                      |
Phase 5  Bundle           v
         AUDIT-EVIDENCE-BUNDLE.zip  (Ed25519-signed)
```

**Plan agent detail.** The plan agent scores the complexity of the approved design and emits granular, named sub-tasks in place of generic labels like "frontend" or "backend". A complexity score above 9 triggers a split verdict, prompting you to break the task into smaller tasks before implementation begins.

---

## Configuration

`arbiter.config.json` at the project root controls providers, model assignment per role, and pipeline behavior.

```json
{
  "auto_merge": false,
  "providers": {
    "claude_max_cli": { "cmd": "claude", "headless_flag": "-p" }
  },
  "roles": {
    "reframe":       { "provider": "claude_max_cli", "model": "claude-sonnet-4-6" },
    "research":      { "provider": "claude_max_cli", "model": "claude-sonnet-4-6" },
    "design":        { "provider": "claude_max_cli", "model": "claude-sonnet-4-6" },
    "design-critic": { "provider": "claude_max_cli", "model": "claude-haiku-4-5-20251001" },
    "integrator":    { "provider": "claude_max_cli", "model": "claude-opus-4-7" },
    "plan":          { "provider": "claude_max_cli", "model": "claude-opus-4-7" },
    "frontend":      { "provider": "claude_max_cli", "model": "claude-sonnet-4-6" },
    "backend":       { "provider": "claude_max_cli", "model": "claude-sonnet-4-6" },
    "test-writer":   { "provider": "claude_max_cli", "model": "claude-haiku-4-5-20251001" },
    "reviewer":      { "provider": "claude_max_cli", "model": "claude-opus-4-7" },
    "tech-writer":   { "provider": "claude_max_cli", "model": "claude-sonnet-4-6" },
    "debugger":      { "provider": "claude_max_cli", "model": "claude-opus-4-7" }
  }
}
```

Set `auto_merge: true` to skip gate prompts and run the pipeline unattended (not recommended for production changes).

---

## CLI Reference

### Task management

| Command | Description |
|---|---|
| `arbiter init` | Set up Arbiter in a project (generates config + `.arbiter/`) |
| `arbiter task init <task-id> --spec <file>` | Initialize a task from a spec file |
| `arbiter task reset <task-id>` | Reset a task to pending (clears receipts for that task) |
| `arbiter conduct <task-id>` | Run the pipeline for a task |
| `arbiter conduct <task-id> --resume` | Resume from the last verified checkpoint |
| `arbiter conduct <task-id> --dry-run` | Validate config and preflight without running agents |
| `arbiter conduct <task-id> --shadow` | Run agents but do not write receipts or advance gates |

### Gates

| Command | Description |
|---|---|
| `arbiter gate list` | List all open gates with their IDs and status |
| `arbiter gate approve <gate-id>` | Approve a gate and allow the pipeline to continue |
| `arbiter gate reject <gate-id>` | Reject a gate (pipeline stops; task state set to blocked) |

### Observability

| Command | Description |
|---|---|
| `arbiter status` | Show current pipeline state, active phase, and open gates |
| `arbiter usage` | Show token count and estimated cost per role and in total |

### Audit and compliance

| Command | Description |
|---|---|
| `arbiter audit verify` | Verify the Ed25519 receipt chain for the current task |
| `arbiter audit log` | Print the decision log (decision-log.jsonl) in human-readable form |
| `arbiter bundle create` | Assemble and sign the AUDIT-EVIDENCE-BUNDLE.zip |
| `arbiter bundle verify` | Verify the signature on an existing bundle |
| `arbiter bundle list` | List all bundles in `.arbiter/bundles/` |
| `arbiter preflight check <task-id>` | Run preflight validation (invariants I6, I7, config schema) |

### Cache

| Command | Description |
|---|---|
| `arbiter cache invalidate` | Invalidate all design evidence cache entries |
| `arbiter cache invalidate --module <pattern>` | Invalidate cache entries matching a module path pattern |

---

## The .arbiter/ Protocol

Arbiter writes all state into a `.arbiter/` directory at the project root. The structure is:

```
.arbiter/
  state.json                          # current pipeline state
  decision-log.jsonl                  # append-only gate decision log
  signing-key.pem                     # Ed25519 private key (gitignored)
  signing-key-pub.pem                 # Ed25519 public key (committed)
  receipts/
    <receipt-id>.json                 # one receipt per agent invocation
  tasks/
    <task-id>/
      task.md                         # task description and metadata
      reframe-output.md               # agent output files
      research-output.md
      design-output.md
      plan-output.md
      ...
  bundles/
    <task-id>-AUDIT-EVIDENCE-BUNDLE.zip
    <task-id>-AUDIT-EVIDENCE-BUNDLE.zip.sig
  gates/
    <gate-id>.json                    # gate record with status and approver
  evidence-cache/
    design/
      <cache-key>.json                # cached design artifacts keyed by blast radius hash
```

Add `.arbiter/signing-key.pem` to `.gitignore`. The public key and all other files are safe to commit.

---

## Agent Templates

`agents/templates/` contains 13 generic system prompts, one per role. Each prompt uses `{{PLACEHOLDER}}` tokens for task-specific context that Arbiter fills at runtime.

To customize a prompt for your project, copy the relevant template to `agents/local/` and reference it in `arbiter.config.json` under the role's `template` key. Local templates override the defaults without modifying the package.

---

## Contributing

```
git clone https://github.com/pedram-mehrabady/Arbiter.git
cd Arbiter
npm install
npm test          # full test suite — no API calls, uses MockProvider
npm run typecheck
```

The test suite uses `MockProvider` to simulate all agent responses. No Claude Max subscription or API key is needed to run tests.

Key modules:

| Module | Responsibility |
|---|---|
| `Conductor.ts` | Orchestrates phase sequencing, gate pauses, and resume logic |
| `TaskInitializer.ts` | Parses spec files and writes the initial task record |
| `BuildReceipt.ts` | Hashes agent output and signs the receipt with Ed25519 |
| `BundleAssembler.ts` | Collects receipts and artifacts into the signed ZIP |
| `EvidenceCache.ts` | Computes blast radius hash and reads/writes design cache entries |
| `providers/` | Provider adapters (ClaudeMaxCli, AnthropicSDK, Ollama) |

Pull requests are welcome. Open an issue first for anything that changes the receipt format, gate protocol, or invariant enforcement — those are part of the public protocol and breaking changes need discussion.

---

## License

MIT © Pedram Mehrabady
