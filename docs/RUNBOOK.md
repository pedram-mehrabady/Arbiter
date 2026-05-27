# Arbiter Operational Runbook

**Audience:** Developer with zero prior Arbiter knowledge.
**Goal:** From zero to first completed task run in under 30 minutes.
**Version:** 1.0 (2026-05-27)

---

## 1. Prerequisites and Fresh-Machine Setup

### Requirements

- Node.js ≥ 20 (for `tsx` and the `arbiter` CLI)
- Claude Code CLI installed (`claude`) — used by `AnthropicProvider` to invoke LLMs
- Git (for commit tracking in evidence bundles)
- `ANTHROPIC_API_KEY` set in your shell environment

### Install

```bash
# Clone and install
git clone https://github.com/your-org/arbiter
cd arbiter
npm install
npm run build
npm link           # Adds `arbiter` to PATH

# Verify
arbiter --version  # → @arbiter-pipeline/cli 0.1.0
```

### Workspace Initialisation

Every project that uses Arbiter needs an `arbiter.config.json` in its root:

```json
{
  "providers": {
    "anthropic": {
      "cmd": "claude",
      "headless_flag": "-p"
    }
  },
  "roles": {
    "reframe":      { "model": "claude-sonnet-4-6" },
    "research":     { "model": "claude-sonnet-4-6" },
    "design":       { "model": "claude-sonnet-4-6" },
    "design-critic":{ "model": "claude-haiku-4-5-20251001" },
    "integrator":   { "model": "claude-opus-4-7" },
    "plan":         { "model": "claude-opus-4-7" },
    "backend":      { "model": "claude-sonnet-4-6" },
    "frontend":     { "model": "claude-sonnet-4-6" },
    "test-writer":  { "model": "claude-haiku-4-5-20251001" },
    "reviewer":     { "model": "claude-opus-4-7" },
    "tech-writer":  { "model": "claude-sonnet-4-6" },
    "debugger":     { "model": "claude-opus-4-7" }
  }
}
```

The signing key pair is generated automatically on the first `arbiter conduct` run.
Keys are written to `.arbiter/signing-key.pem` and `.arbiter/signing-key-pub.pem`.
**Back up the private key. Loss means all existing receipts become unverifiable.**

### Directory Structure Created by Arbiter

```
.arbiter/
  state.json              # Live pipeline state (atomic writes)
  decision-log.jsonl      # Append-only event log (never truncated)
  receipts.jsonl          # Append-only build receipt chain
  usage.jsonl             # Token/cost ledger
  pending-gates.json      # Active human gates (resolved = removed)
  signing-key.pem         # Ed25519 private key (keep secret)
  signing-key-pub.pem     # Ed25519 public key (distribute with AFTA bundle)
  tasks/
    <task-id>/
      task.md             # Copy of the feature spec
      <agent>-output.md   # Agent outputs (one file per agent)
  bundles/
    <task-id>-AFTA-EVIDENCE-BUNDLE.zip   # Signed evidence ZIP
    <task-id>-AFTA-EVIDENCE-BUNDLE.zip.sig
  evidence-cache/
    design/               # Cached design artifacts (blast-radius skip)
  docs/
    RUNBOOK.md            # This file
```

---

## 2. Normal Run Lifecycle

### Step 1 — Initialise a task

```bash
arbiter task init FEAT-42 --spec ./specs/FEAT-42.md --workspace /path/to/foederata
```

This copies the spec, creates `.arbiter/state.json` with the 11-agent pipeline, and prints the dependency graph.

### Step 2 — Start the pipeline

```bash
arbiter conduct FEAT-42 --workspace /path/to/foederata
```

The conductor loops through eligible sub-tasks, runs preflight checks, invokes the LLM, writes output, creates a signed receipt, and advances state. Terminal output looks like:

```
Arbiter — task FEAT-42
  ✓ reframe (reframe/claude-sonnet-4-6)
  ✓ research (research/claude-sonnet-4-6)

  ⏸ Gate required: gate-design_approval-FEAT-42-1716825600000
    Approve: arbiter gate approve gate-design_approval-FEAT-42-1716825600000

```

### Step 3 — Approve gates

Gates block the pipeline until you review and approve. Each gate shows the triggering agent and the output file to review.

```bash
# List pending gates
arbiter gate list --workspace /path/to/foederata

# Approve (pipeline resumes automatically)
arbiter gate approve <gate-id> --comment "Design looks good"

# Reject (pipeline halts, task stays in failed state)
arbiter gate reject <gate-id> --comment "Design misses the caching requirement"
```

There are three mandatory gates (Discovery, Design, Review) and one conditional gate (Debugger Rewrite, fires only if debugger changed >20% of output).

### Step 4 — Monitor progress

```bash
arbiter status --workspace /path/to/foederata
```

Shows each sub-task: `pending`, `in_progress`, `completed`, or `failed`, along with strike counts.

### Step 5 — Task completion

When all sub-tasks complete, Arbiter automatically assembles the AFTA-EVIDENCE-BUNDLE ZIP and prints:

```
✓ Task FEAT-42 complete. Assembling AFTA evidence bundle...
  ✓ Bundle: .arbiter/bundles/FEAT-42-AFTA-EVIDENCE-BUNDLE.zip
    ID: FEAT-42-bundle-20260527T180000Z
    ALC artifacts: 10 present
```

### Step 6 — Verify the bundle

```bash
arbiter bundle verify .arbiter/bundles/FEAT-42-AFTA-EVIDENCE-BUNDLE.zip
# → ✓ Bundle signature valid
#     Hash: sha256:abc123...
```

---

## 3. Failure State Recovery Procedures

### 3.1 — `infrastructure_failure`

**Symptom:** Sub-task moves to `failed` with `last_failure_class: infrastructure`. Decision log shows `preflight_reject` or `context_assembly_fail`.

**Diagnosis:**
```bash
arbiter audit log --task FEAT-42 | grep '"class":"infrastructure"'
# → Look for: missing context file, wrong template, secrets detected
```

**Recovery:**
1. Fix the underlying cause (add missing file, remove secret from context)
2. Reset the sub-task and retry:
```bash
arbiter task reset FEAT-42 --workspace /path/to/foederata
arbiter conduct FEAT-42 --resume --workspace /path/to/foederata
```
Infrastructure failures consume **zero strikes**. The sub-task retries immediately after the fix.

---

### 3.2 — `scope_overload`

**Symptom:** Sub-task `plan` fails with `last_failure_class: scope_overload`. Terminal shows the split recommendation with breakdown.

**Diagnosis:**
```
✗ Plan rejected — complexity overload:
  Complexity score 14 exceeds maximum (9)...
  Score breakdown:
    file_count                 = 5
    subprocess_or_migration × 3 = 9  (raw: 3)
    ...
  → Each migration/subprocess change should be its own task (each scores +3).
```

**Recovery:**
1. Split the task into two or more tasks per the recommendation in the terminal output
2. Create new spec files with reduced scope
3. Initialise separate tasks:
```bash
arbiter task init FEAT-42a --spec ./specs/FEAT-42a.md
arbiter task init FEAT-42b --spec ./specs/FEAT-42b.md
```

---

### 3.3 — `stochastic_failure_max_strikes`

**Symptom:** Sub-task hits 2 stochastic failures (strike count = 2) and escalates to the Debugger agent.

**What happens automatically:**
- Debugger agent runs with Opus model
- Four AFTA constraints are enforced (P-CRYPTO check, diff logged, new-abstraction block, >20% gate)
- If debugger output is clean: sub-task completes, pipeline continues
- If debugger output fails constraint 1 or 4: sub-task moves to `failed`

**Decision log entries to look for:**
```
debugger_invoked     — confirms escalation happened
debugger_diff        — diff_pct and diff_hash recorded
debugger_constraint1_fail / debugger_constraint4_fail — if debugger was blocked
```

**Recovery after debugger failure:**
```bash
# Review what the debugger tried to do
arbiter audit log --task FEAT-42 | grep debugger

# Reset and retry (you may need to adjust context or task scope)
arbiter task reset FEAT-42
arbiter conduct FEAT-42 --resume
```

---

### 3.4 — `debugger_major_rewrite`

**Symptom:** Terminal shows a pending gate after debugger runs:

```
  ⚠ backend-auth — debugger rewrote 34% — gate required: gate-debugger_major_rewrite-FEAT-42-...
```

**What to review:**
- The diff percentage is shown in the gate context
- Check the original output at `.arbiter/tasks/FEAT-42/backend-auth-output.md`
- The debugger's new version replaced it in-place

**Decision:**
```bash
# If the rewrite looks correct
arbiter gate approve gate-debugger_major_rewrite-FEAT-42-... --comment "Rewrite is correct"

# If the rewrite introduces problems
arbiter gate reject gate-debugger_major_rewrite-FEAT-42-... --comment "Debugger changed the API surface"
# → Sub-task moves to failed; split the original task or fix the spec
```

---

### 3.5 — `rate_limit_pause`

**Symptom:** Pipeline pauses mid-run with output like:

```
Rate limit info: requests_remaining=0, reset_at=2026-05-27T14:30:00Z
```

**What happens:** The conductor's `RateLimiter` detects the reset timestamp and waits before the next spawn. No action needed — the pipeline auto-resumes.

**Check spend:**
```bash
arbiter usage --workspace /path/to/foederata
# Today's spend: $4.12
# Budget headroom: 86%
```

---

### 3.6 — `budget_cap_reached`

**Symptom:** Pipeline halts with:
```
Daily cap reached ($30.00 / $30). Pipeline paused.
```

**Recovery:**
```bash
# Option 1: Wait until the next day (cap resets at midnight UTC)

# Option 2: Raise the cap in arbiter.config.json
# Add: "daily_cap_usd": 50

# Resume after cap reset or config change
arbiter conduct FEAT-42 --resume --workspace /path/to/foederata
```

---

### 3.7 — `api_unavailable`

**Symptom:** Multiple consecutive infrastructure failures with `claude: command failed` or HTTP 503 in the decision log.

**Diagnosis:**
```bash
arbiter audit log --task FEAT-42 | grep '"event":"agent_fail"' | tail -5
```

**Recovery:**
1. Verify `claude` CLI works: `claude --version && echo "ok"`
2. Check Anthropic status page
3. Once API is available:
```bash
arbiter conduct FEAT-42 --resume --workspace /path/to/foederata
```
The `--resume` flag re-verifies all completed sub-tasks and skips them; only interrupted/failed sub-tasks re-run.

---

## 4. Audit Log Interpretation

### decision-log.jsonl

Every orchestrator decision is recorded here. Key events:

| Event | Meaning |
|-------|---------|
| `pipeline_start` / `pipeline_resume` | Run began |
| `agent_start` | Sub-task spawned |
| `agent_complete` | Sub-task finished, receipt created |
| `agent_fail` | Sub-task failed with `class` and `strike_count` |
| `preflight_spawn` | Preflight passed, agent about to run |
| `preflight_halt` / `preflight_split` | Preflight blocked the spawn |
| `gate_created` / `gate_approved` / `gate_rejected` | Human gate lifecycle |
| `plan_validation_pass` / `plan_validation_fail` | Plan agent complexity check |
| `debugger_invoked` / `debugger_diff` | Debugger escalation events |
| `design_phase_cache_hit` / `design_phase_skipped` | Blast-radius skip events |
| `bundle_created` | AFTA-EVIDENCE-BUNDLE assembled |
| `pipeline_complete` | All sub-tasks done |

```bash
# Print all events for a task
arbiter audit log --task FEAT-42 | jq .

# Print only failures
arbiter audit log --task FEAT-42 | jq 'select(.class != null)'
```

### receipts.jsonl

Each receipt covers one agent invocation. Key fields:

- `receipt_id` — unique ID (also recorded in git commit trailers)
- `context_hash` — SHA-256 of the assembled prompt (proves no context tampering)
- `output_hashes` — SHA-256 of each output file (proves output integrity)
- `signature` — Ed25519 over `receipt_id|task_id|agent_role|...` (tamper-proof)
- `debugger_invoked`, `debugger_diff_hash`, `debugger_diff_pct` — Debugger chain of custody

```bash
# Verify all receipts
arbiter audit verify --workspace /path/to/foederata
# → ✓ rec_20260527T... (pass)
#   ✓ rec_20260527T... (pass)
#   14 passed, 0 failed
```

### usage.jsonl

Token ledger. Each entry is one API call.

```bash
arbiter usage --workspace /path/to/foederata
```

### Verify a bundle

```bash
arbiter bundle verify .arbiter/bundles/FEAT-42-AFTA-EVIDENCE-BUNDLE.zip \
  --workspace /path/to/foederata
```

---

## 5. AFTA Submission Checklist

For each completed feature task, the AFTA submission package consists of:

- [ ] `.arbiter/bundles/<task-id>-AFTA-EVIDENCE-BUNDLE.zip` — the evidence ZIP
- [ ] `.arbiter/bundles/<task-id>-AFTA-EVIDENCE-BUNDLE.zip.sig` — the sidecar signature file
- [ ] `.arbiter/signing-key-pub.pem` — public key for independent verification

**Checklist before submission:**

```bash
# 1. All receipts verify
arbiter audit verify --workspace /path/to/foederata

# 2. Bundle verifies
arbiter bundle verify .arbiter/bundles/<task-id>-AFTA-EVIDENCE-BUNDLE.zip

# 3. All 10 ALC controls are present
# (Shown in `arbiter bundle create` output and manifest.json inside ZIP)

# 4. No missing artifacts
arbiter bundle list --workspace /path/to/foederata
# Inspect manifest.json inside the ZIP for missingArtifacts: []
```

**Artifacts inside the ZIP and their ALC controls:**

| Directory | Artifact | ALC Control |
|-----------|----------|-------------|
| `01-requirements/` | `spec.md`, `reframe-output.md` | ALC_REQ |
| `02-impact-analysis/` | `research-output.md` | ALC_IMP.1 |
| `03-design/` | `design.md`, `design-critic.md`, `integrator-output.md` | ALC_TDS.1/2/3 |
| `04-implementation-plan/` | `plan-output.md` | ALC_IMP.2 |
| `05-implementation/` | `git-commits.json`, `receipts/*.json` | ALC_IMP |
| `06-tests/` | `test-writer-output.md` | ALC_TEC |
| `07-review/` | `reviewer-report.md` | ALC_QA |
| `08-documentation/` | `tech-writer-output.md` | AGD_OPE |
| `09-audit-trail/` | `decision-log-excerpt.jsonl`, `receipt-chain-verify.txt` | Supporting evidence |
