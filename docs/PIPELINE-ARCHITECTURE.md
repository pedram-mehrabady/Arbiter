# Arbiter — Pipeline Architecture
# STATUS: v3 LOCKED — Senior Architect review complete 2026-05-28. Implementation approved.
# Sections 1–28: original design (valid unless noted as superseded).
# Sections 29–35: v2 upgrades — these override any conflicting content above.
# Sections 38–39: v3 additions (DB rationale + competitive analysis) — override any conflicts.
# Last updated: 2026-05-28

---

## 1. The two-phase model

Every piece of work in Arbiter moves through exactly two phases, regardless of which
execution pipeline the user selects.

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1 — Discovery & Planning                                  │
│  Always runs. Always uses the full 14-agent pipeline.            │
│                                                                  │
│  reframe → question → research → design → integrator → plan     │
│                                                                  │
│  Outputs: 3-design.md, 5-plan.json, per-agent task files        │
│  Human checkpoint: you review and approve the plan              │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Dashboard: tasks   │
                    │  appear in inbox    │
                    │  awaiting dispatch  │
                    └─────────┬──────────┘
                              │
          ┌───────────────────┴────────────────────┐
          │  You choose the execution pipeline      │
          │  per task at dispatch time              │
          └───────┬──────────────────────┬──────────┘
                  │                      │
    ┌─────────────▼──────┐   ┌───────────▼──────────────┐
    │  FULL EXECUTION     │   │  SPEED EXECUTION          │
    │  (14-agent)         │   │  (5-agent)                │
    │                     │   │                           │
    │  frontend           │   │  frontend                 │
    │  backend            │   │  backend                  │
    │  test-writer        │   │  test-writer              │
    │  debugger           │   │  reviewer → PR            │
    │  reviewer           │   │                           │
    │  tech-writer        │   │  No debugger.             │
    │  surveyor           │   │  No tech-writer.          │
    │                     │   │  No surveyor.             │
    └─────────────────────┘   └───────────────────────────┘
```

**Key constraint:** Phase 1 always produces the same artifacts regardless of which
execution pipeline will be used. The design, plan, and task files are the same.
The execution pipeline selection only affects Phase 2.

---

## 2. What Phase 1 produces (the handoff contract)

Phase 1 always outputs these artifacts into the task folder
(`exec-plan/02-incubating/<task-id>/`):

| Artifact | Written by | Read by Phase 2 |
|---|---|---|
| `spec.md` | you (input) | design, research |
| `0-reframe.md` | reframe agent | question |
| `1-questions.md` | question agent | research |
| `2-research.md` | research agent | design |
| `3-design.md` | design agent | frontend, backend, reviewer |
| `generated/db-schema/<task>.mmd` | design agent | schema gate |
| `generated/api-contracts/<task>.json` | design agent | backend, reviewer |
| `integration.md` | integrator agent | frontend, backend, reviewer |
| `5-plan.md` | plan agent | human review |
| `5-plan.json` | plan agent | conductor (machine manifest) |
| `tasks/frontend.task.md` | plan agent | frontend agent |
| `tasks/backend.task.md` | plan agent | backend agent |
| `tasks/test-writer.task.md` | plan agent | test-writer agent |

These artifacts are the single source of truth for Phase 2. Neither execution
pipeline modifies them — they only consume them.

---

## 3. Execution pipeline comparison

### Full execution (14-agent Phase 2)

```
frontend → [UI gate if ui_first] → backend → [schema gate if DB] →
test-writer → debugger (on failure) → reviewer → tech-writer → surveyor
```

**Use when:**
- The task is a greenfield feature with unknown complexity
- You expect gate failures and want the debugger to investigate automatically
- You want documentation updated and a post-delivery survey
- You are in a regulated environment (compliance gates required)

**Agents that run:**
1. `frontend` — builds UI to `tasks/frontend.task.md`
2. `backend` — builds API/DB to `tasks/backend.task.md`
3. `test-writer` — writes tests to coverage thresholds
4. `debugger` — triggered automatically on gate failure (max 2 retries)
5. `reviewer` — security + compliance + registry audit; opens PR
6. `tech-writer` — updates docs after merge
7. `surveyor` — scans codebase post-delivery; proposes next backlog items

**Gates in full execution:**
- Schema gate (before backend, if DB layer exists)
- UI gate (after frontend, if `ui_first: true`)
- Review gate (reviewer must pass before PR opens)

---

### Speed execution (5-agent Phase 2)

```
frontend → [UI gate if ui_first] → backend → test-writer → reviewer → PR
```

**Use when:**
- The task is a well-understood bugfix, small feature, or refactor
- Phase 1 already produced a clear, unambiguous design and plan
- You want to ship fast and will handle docs/survey yourself
- You are confident the gate will pass first time

**Agents that run:**
1. `frontend` — same rule book as full pipeline
2. `backend` — same rule book as full pipeline
3. `test-writer` — same rule book as full pipeline
4. `reviewer` — same rule book as full pipeline (opens PR on green)

**Gates in speed execution:**
- UI gate (if `ui_first: true`) — same as full
- Review gate — same as full
- Schema gate — **skipped** (design agent already validated schema in Phase 1; reviewer
  checks it manually as part of the review rubric)

**What speed execution drops:**
- No `debugger` — if a gate fails in speed mode, task returns to the coder directly
  (one retry). If it fails twice, task moves to `07-failed/` for manual inspection.
- No `tech-writer` — documentation is not auto-updated after merge.
- No `surveyor` — no post-delivery backlog scan.

---

## 4. Pipeline selection — how a user chooses

### At task creation (default routing)

When Phase 1 completes and the plan agent writes `5-plan.json`, it includes a
`pipeline` field with a default recommendation based on the task archetype:

```json
{
  "task_id": "FEAT-051",
  "archetype": "feature",
  "pipeline": "full",
  "pipeline_auto": true,
  ...
}
```

`pipeline_auto: true` means the conductor auto-selected the pipeline. The user can
override it at dispatch time.

### Auto-routing rules (archetype → default pipeline)

| Archetype | Default pipeline | Reason |
|---|---|---|
| `feature` (greenfield) | `full` | Unknown complexity; debugger + tech-writer + surveyor all add value |
| `backend-fix` | `speed` | Well-scoped; no UI gate; debugger rarely needed |
| `db-migration` | `full` | Schema gate is critical; tech-writer must update docs |
| `test-backfill` | `speed` | Pure test code; no frontend/backend build needed |
| `refactor` | `speed` | Scope is clear; regression tests cover the risk |
| `docs` | `speed` | No build step; reviewer light-pass only |

### At dispatch time (dashboard override)

On the task card in the dashboard, the user sees the auto-selected pipeline and can
change it before pressing "Dispatch":

```
┌──────────────────────────────────────────────────────┐
│  FEAT-051 — Add subscription upgrade flow             │
│  Archetype: feature   Status: ready to dispatch       │
│                                                       │
│  Execution pipeline:  [ Full (14-agent) ▼ ]          │
│                        Full (14-agent)                │
│                        Speed (5-agent)                │
│                                                       │
│  [ Dispatch ]                                         │
└──────────────────────────────────────────────────────┘
```

The conductor reads the `pipeline` field from `5-plan.json` (or the dashboard override
stored in `.arbiter/dispatch/<task-id>.json`) and routes to the correct manifest folder
(`agents/manifests/` vs `agents/manifests-speed/`).

---

## 5. The `5-plan.json` schema additions

The existing `5-plan.json` needs two new fields:

```json
{
  "task_id": "FEAT-051",
  "archetype": "feature",
  "layers": ["frontend", "backend"],
  "execution_order": "sequential",
  "ui_first": true,
  "skip": [],
  "agents": ["frontend", "backend", "test-writer", "reviewer"],

  "pipeline": "speed",
  "pipeline_auto": true
}
```

| New field | Type | Description |
|---|---|---|
| `pipeline` | `"full"` \| `"speed"` | Which execution pipeline Phase 2 uses |
| `pipeline_auto` | `boolean` | `true` = auto-routed by archetype; `false` = user override |

The `agents[]` array is derived from `pipeline` + `archetype`. The conductor does not
need to compute it — the plan agent writes it explicitly.

### `agents[]` per pipeline per archetype

| Archetype | Full agents[] | Speed agents[] |
|---|---|---|
| `feature` | frontend, backend, test-writer, debugger, reviewer, tech-writer, surveyor | frontend, backend, test-writer, reviewer |
| `backend-fix` | backend, test-writer, debugger, reviewer, tech-writer | backend, test-writer, reviewer |
| `db-migration` | backend, test-writer, debugger, reviewer, tech-writer | backend, test-writer, reviewer |
| `test-backfill` | test-writer, reviewer, tech-writer | test-writer, reviewer |
| `refactor` | frontend*, backend*, test-writer, reviewer, tech-writer | frontend*, backend*, test-writer, reviewer |
| `docs` | tech-writer, reviewer | tech-writer, reviewer |

`*` = only if the layer exists in `layers[]`

---

## 6. The `tasks/` per-agent frontmatter addition

Each per-agent task file gets one new frontmatter field:

```yaml
---
task_id: FEAT-051
agent: frontend
pipeline: speed
manifest: agents/manifests-speed/frontend.manifest.yaml
...
---
```

When `pipeline: speed`, the conductor resolves `manifest` from
`agents/manifests-speed/<agent>.manifest.yaml`. When `pipeline: full`, it resolves
from `agents/manifests/<agent>.manifest.yaml`.

---

## 7. State machine — pipeline-aware

The exec-plan state machine is unchanged except that the state folder now carries
the pipeline label in its task manifest. The conductor's move logic:

```
01-inbox/<task-id>/
  → human reads spec → triggers Phase 1 → 02-incubating/

02-incubating/<task-id>/
  → Phase 1 completes → human reviews plan
  → human approves (or edits pipeline field) → 03-building/

03-building/<task-id>/
  → conductor reads 5-plan.json.pipeline
  → dispatches agents from agents/manifests/ OR agents/manifests-speed/
  → gate pass → 04-human-gate/ (if gate exists) OR 05-review/

04-human-gate/<task-id>/
  → human approves → back to 03-building/ for next layer

05-review/<task-id>/
  → reviewer runs → PR opened → 06-completed/ or back to 03-building/
```

---

## 8. Dashboard — early summary (superseded)

> Full dashboard specification is in **Section 17**. Full build list is in **Section 9 (Updated)**.

---

## 9. What needs to be built (early draft — superseded)

> Full and updated build list is in **Updated Section 9** near the end of this document.

---

## 10. What does NOT change

- Phase 1 agents (reframe, research, design, integrator, plan) — same for everyone, always
- Task artifact naming (`<agent>-output.md`) — same for both pipelines
- `arbiter/knowledge/` KB docs — shared between full and fast pipelines
- `arbiter/engine/` docs (MASTER-DIRECTIVES, GATE_PLAYBOOK, etc.) — shared
- Human gate mechanics — same (`arbiter approve` / `arbiter reject` / dashboard buttons)
- Coverage thresholds and ratchet rule — same
- Git PR hard rules — same for all agents (see Section 25)
- `arbiter.config.json` format — same; `speed_roles` block added for fast pipeline models

---

## 11. Open questions (early draft — superseded)

> Resolved and new open questions are in **Updated Section 11** near the end of this document.

---

## 13. Task structure — where everything lives

### The two locations: project repo vs `.arbiter/`

When Arbiter is installed on a project, the project repo ends up with two classes of files:

```
<project-root>/
│
├── arbiter.config.json          ← Arbiter configuration (hydrated from template)
│
├── .arbiter/                    ← ALL Arbiter runtime state lives here
│   ├── tasks/                   ← one folder per task, holds all artifacts
│   ├── state.json               ← machine state: which agents ran, status, hashes
│   ├── bundles/                 ← signed evidence archives (zip + .sig)
│   ├── decision-log.jsonl       ← append-only audit trail of every agent action
│   ├── signing-key.pem          ← private key (never committed; in .gitignore)
│   ├── signing-key-pub.pem      ← public key (committed for verification)
│   ├── registry.json            ← component/service registry used by reviewer
│   ├── vision/                  ← screenshots captured by UI gate
│   │   └── <task-id>/           ← per-task screenshots
│   └── dispatch/                ← pipeline override files written by dashboard
│       └── <task-id>.json
│
├── web/                         ← your frontend source code
├── api/                         ← your backend source code
└── CLAUDE.md                    ← root workspace instructions
```

**Rule:** Arbiter artifacts (plans, agent outputs, state) go into `.arbiter/`.
Source code changes (React components, API controllers, migrations) go into the
project source folders (`web/`, `api/`). They are in the same repo but never mixed.

`.arbiter/` is committed to the repo. `.arbiter/signing-key.pem` is the only file
that goes in `.gitignore`.

---

### Inside `.arbiter/tasks/<task-id>/`

Every task gets its own folder. The folder contains the raw requirement plus one
output file per agent that ran:

```
.arbiter/tasks/FEAT-051/
├── task.md                  ← the requirement as written by the user (plain markdown)
├── reframe-output.md        ← reframe agent output
├── research-output.md       ← research agent output
├── design-output.md         ← design agent output (the design doc)
├── design-critic-output.md  ← design-critic agent output
├── integrator-output.md     ← integrator agent output
├── plan-output.md           ← plan agent output (human-readable plan)
├── frontend-output.md       ← frontend agent output (build notes)
├── backend-output.md        ← backend agent output (build notes)
├── test-writer-output.md    ← test-writer output
├── reviewer-output.md       ← reviewer verdict + PR link
└── tech-writer-output.md    ← tech-writer doc update notes
```

**Both pipelines use this exact same folder structure.** The only difference is
which `<agent>-output.md` files exist — a speed-pipeline task will have fewer
files because fewer agents ran.

```
Speed pipeline task folder:
.arbiter/tasks/FEAT-051/
├── task.md
├── reframe-output.md        ← Phase 1 (same for both)
├── research-output.md       ← Phase 1
├── design-output.md         ← Phase 1
├── integrator-output.md     ← Phase 1
├── plan-output.md           ← Phase 1
├── frontend-output.md       ← Phase 2 (speed)
├── backend-output.md        ← Phase 2 (speed)
├── test-writer-output.md    ← Phase 2 (speed)
└── reviewer-output.md       ← Phase 2 (speed)
          — no debugger-output.md
          — no tech-writer-output.md
          — no surveyor-output.md
```

---

### The machine state — `state.json`

`state.json` at `.arbiter/state.json` tracks status for every task and every
sub-task (agent). The conductor reads and writes this file to know where each
task is in the pipeline:

```json
{
  "task_id": "FEAT-051",
  "phase": "building",
  "phase_status": "in_progress",
  "pipeline": "speed",
  "created_at": "2026-05-28T09:00:00Z",
  "updated_at": "2026-05-28T10:30:00Z",
  "sub_tasks": {
    "reframe":   { "status": "completed", "completed_at": "...", "output_hash": "sha256:..." },
    "research":  { "status": "completed", "depends_on": ["reframe"], ... },
    "design":    { "status": "completed", "depends_on": ["research"], ... },
    "integrator":{ "status": "completed", "depends_on": ["design"], ... },
    "plan":      { "status": "completed", "depends_on": ["integrator"], ... },
    "frontend":  { "status": "in_progress", "depends_on": ["plan"], ... },
    "backend":   { "status": "pending", "depends_on": ["plan"], ... },
    "test-writer":{ "status": "pending", "depends_on": ["frontend","backend"], ... },
    "reviewer":  { "status": "pending", "depends_on": ["test-writer"], ... }
  }
}
```

`state.json` is the single source of truth for the conductor. The dashboard reads
it to show live task progress. The `output_hash` field is the SHA-256 of each
agent's output file — used for tamper detection and evidence bundle signing.

---

### How a task is created — the full flow

#### Step 1 — User writes the requirement

The user either:
- Types the requirement into the dashboard (New Task form), or
- Drops a markdown file into `.arbiter/tasks/new/` via the CLI (`arbiter add`)

The requirement is a plain markdown file. There is no required schema — just write
what you want built. Examples of valid requirements:

```markdown
# Add subscription upgrade flow
Users on the free plan should be able to upgrade to Pro from the settings page.
Show the plan comparison, collect payment via Stripe, and activate the new plan immediately.
```

```markdown
# Fix: contacts list paginates incorrectly when filter is active
When a search filter is applied and the user goes to page 2, the filter is dropped
and all contacts are shown. Expected: filter persists across pages.
```

The conductor wraps this in `task.md` and assigns it a task ID (`FEAT-xxx`,
`FIX-xxx`, `REFACTOR-xxx` depending on how it is classified by the reframe agent).

#### Step 2 — Task ID assignment

Task IDs are generated by the conductor at creation time:

| Prefix | When used |
|---|---|
| `FEAT-xxx` | New feature (archetype: `feature`) |
| `FIX-xxx` | Bug fix (archetype: `backend-fix`) |
| `MIGR-xxx` | DB migration (archetype: `db-migration`) |
| `TEST-xxx` | Test backfill (archetype: `test-backfill`) |
| `REFAC-xxx` | Refactor (archetype: `refactor`) |
| `DOCS-xxx` | Documentation (archetype: `docs`) |

The prefix is provisional — the reframe agent confirms or corrects it as its first
output. The ID never changes after creation.

#### Step 3 — Phase 1 runs (always full-pipeline discovery)

The conductor dispatches the 6 Phase 1 agents in sequence, writing outputs to
`.arbiter/tasks/<task-id>/`:

```
reframe-output.md  →  research-output.md  →  design-output.md
                                                      ↓
                          plan-output.md  ←  integrator-output.md
```

The `plan-output.md` contains two things:
1. The human-readable plan (what will be built, file list, layer breakdown)
2. An embedded `5-plan.json` block — the machine manifest the conductor parses

#### Step 4 — Human checkpoint

When Phase 1 completes, the task appears in the dashboard in the **"Ready to dispatch"**
column. The user:
1. Reads `design-output.md` and `plan-output.md`
2. Selects the execution pipeline (Full or Speed; auto-routed default shown)
3. Clicks **Dispatch** — or rejects with a reason (sends it back to Phase 1)

If rejected, the reframe agent re-reads the rejection reason and the cycle repeats
from the beginning of Phase 1.

#### Step 5 — Phase 2 runs (user's chosen pipeline)

The conductor reads `pipeline` from the embedded `5-plan.json`, loads the correct
manifest folder (`agents/manifests/` or `agents/manifests-speed/`), and dispatches
the execution agents. Each agent appends its output to the task folder as it
completes.

`state.json` is updated after each agent completes. The dashboard shows live progress.

#### Step 6 — Human gates (if applicable)

Gate checks pause the pipeline and move the task to a "waiting" state. The user
approves or rejects via `arbiter approve <task-id> <gate>` or the dashboard button.

#### Step 7 — Reviewer opens PR

When all execution agents pass, the reviewer agent opens a PR. The task moves to
the "In review" column in the dashboard. After merge (manual or auto-merge), the
task is marked `completed` and archived.

---

### The `exec-plan/` folder — conceptual vs runtime

The `exec-plan/` folder in the Arbiter template repo (`~/arbiter/exec-plan/`) is
the **reference design** for the state machine — it shows the folder layout concept
and contains schema documentation. It is also used as a **file-based alternative**
for teams that prefer browsing state as folders on disk instead of reading `state.json`.

In the file-based mode, the conductor ALSO moves the task folder between state
sub-folders (`00-proposed/` → `01-inbox/` → `02-incubating/` → ...) in addition
to updating `state.json`. The two representations are always in sync.

In the default mode (`state.json` only), the `exec-plan/` folder structure is not
created in the project — only `.arbiter/tasks/<task-id>/` exists.

---

### What the source code repo looks like during a task

At any point during a task, the project repo contains:

```
<project-root>/
├── .arbiter/
│   ├── tasks/FEAT-051/         ← all agent outputs, plan, design
│   └── state.json              ← current status
├── web/                        ← FE source; agent edits land here
├── api/                        ← BE source; agent edits land here
└── arbiter.config.json
```

The frontend agent writes directly to `web/`. The backend agent writes directly
to `api/`. The reviewer sees those diffs when it runs. There is no intermediate
staging area — agents write to the real source folders, and the gate scripts
(`gate-web`, `gate-api`) run against those real folders.

---

### Task ID naming — example sequence

```
FEAT-051 — Add subscription upgrade flow       → full pipeline
FIX-052  — Fix contacts pagination with filter → speed pipeline
FEAT-053 — Add bulk export to CSV              → full pipeline
REFAC-054 — Extract shared date utilities      → speed pipeline
TEST-055 — Backfill tests for auth module      → speed pipeline
```

Each lives at `.arbiter/tasks/<id>/` independently. Tasks never share a folder.

---

---

## 14. Complete project folder structure

When Arbiter is installed on a project, the following folder structure is created
at the project root. The `arbiter/` folder is **visible** (not hidden) and is committed
to the repo — it is intellectual property of the project (PRDs, designs, plans, rule books).

```
<project-root>/
│
├── arbiter.config.json              ← Arbiter configuration (hydrated from template)
│
├── arbiter/                         ← ALL Arbiter files. Visible. Committed.
│   │
│   ├── requirement-gathering/       ← Phase 1 agent rule books
│   │   ├── reframe/
│   │   │   ├── rules.md             ← reframe agent instructions
│   │   │   └── manifest.yaml        ← context manifest (what this agent reads)
│   │   ├── research/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── design/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── integrator/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   └── plan/
│   │       ├── rules.md
│   │       └── manifest.yaml
│   │
│   ├── tasks/                       ← runtime task artifacts (one folder per task)
│   │   ├── FEAT-051/
│   │   │   ├── task.md              ← original requirement as written
│   │   │   ├── reframe-output.md
│   │   │   ├── research-output.md
│   │   │   ├── design-output.md
│   │   │   ├── integrator-output.md
│   │   │   ├── plan-output.md
│   │   │   ├── frontend-output.md
│   │   │   ├── backend-output.md
│   │   │   ├── test-output.md
│   │   │   ├── reviewer-output.md   ← full pipeline only
│   │   │   ├── debugger-output.md   ← full pipeline only, on failure
│   │   │   ├── tech-writer-output.md← full pipeline only
│   │   │   └── summaries/
│   │   │       ├── phase1-summary.md  ← written by coordinator/babysitter
│   │   │       ├── phase2-summary.md
│   │   │       └── lessons-learned.md
│   │   └── FIX-052/
│   │       └── ...
│   │
│   ├── fast/                        ← 5-agent speed pipeline rule books
│   │   ├── babysitter/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── frontend/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── backend/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── test/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   └── push/
│   │       ├── rules.md
│   │       └── manifest.yaml
│   │
│   ├── 14agent/                     ← full pipeline Phase 2 agent rule books
│   │   ├── coordinator/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── frontend/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── backend/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── test-writer/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── debugger/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   ├── reviewer/
│   │   │   ├── rules.md
│   │   │   └── manifest.yaml
│   │   └── tech-writer/
│   │       ├── rules.md
│   │       └── manifest.yaml
│   │
│   ├── knowledge/                   ← shared KB docs (both pipelines read these)
│   │   ├── frontend-standards.md
│   │   ├── backend-standards.md
│   │   ├── security.md
│   │   ├── design-system.md
│   │   ├── test-patterns.md
│   │   ├── quality-score.md
│   │   ├── reliability.md
│   │   ├── product-sense.md
│   │   ├── core-beliefs.md
│   │   └── plans.md
│   │
│   ├── engine/                      ← shared engine docs (directives, playbooks)
│   │   ├── MASTER-DIRECTIVES.md
│   │   ├── GATE_PLAYBOOK.md
│   │   ├── TASK-ARCHETYPES.md
│   │   ├── SEQUENCING-POLICY.md
│   │   ├── RECOVERY-POLICY.md
│   │   ├── DOC-STANDARDS.md
│   │   └── CLI-LESSONS-LEARNED.md
│   │
│   ├── state.json                   ← machine state for all tasks
│   ├── decision-log.jsonl           ← append-only audit trail
│   ├── registry.json                ← component/service registry for reviewer
│   ├── signing-key-pub.pem          ← committed — used for bundle verification
│   ├── vision/                      ← screenshots from UI gate
│   │   └── <task-id>/
│   └── dispatch/                    ← pipeline override files (set by dashboard)
│       └── <task-id>.json
│
├── web/                             ← frontend source (agents write here)
├── api/                             ← backend source (agents write here)
└── CLAUDE.md                        ← root workspace instructions
```

**`arbiter/signing-key.pem`** (private key) goes in `.gitignore` — it is the only
Arbiter file that is NOT committed.

**Agents write source code directly into `web/` and `api/`** — there is no staging
area. Gate scripts run against the real source folders.

**Both pipelines use the same `arbiter/tasks/` structure.** A speed-pipeline task
simply has fewer output files (no debugger-output.md, no tech-writer-output.md).

---

## 15. Agent documents — lifecycle and update flow

### Source of truth hierarchy

```
Arbiter tool (~/.arbiter/templates/)      ← templates shipped with the tool
        │
        │  arbiter init   (first time)
        │  arbiter sync   (update — shows diff, user decides)
        ▼
Project repo (arbiter/requirement-gathering/, arbiter/fast/, arbiter/14agent/)
        ← LIVE COPIES — this is what the conductor and agents actually read
        ← can diverge from the template intentionally (project customization)
```

### Who reads them

- **Conductor (TypeScript engine)**: reads `manifest.yaml` to assemble context for each agent run
- **Agents (Claude sessions)**: read their own `rules.md` + the files listed in their `manifest.yaml`
- **Dashboard Flow tab**: displays and edits them directly

### How they are updated

| Method | When | Who |
|---|---|---|
| `arbiter init` | Project setup (once) | Copies templates into project `arbiter/` |
| `arbiter sync` | After Arbiter tool update | Shows diff between template and project copy; user cherry-picks changes |
| Flow tab (dashboard) | Any time agent is idle | Human edits `rules.md` or `manifest.yaml` in UI; saves to project repo AND Arbiter template library simultaneously |
| Tech-writer agent | Post-merge | Proposes additions to relevant `rules.md`; human confirms before commit |
| Coordinator/babysitter | During a task | May suggest rule book changes; NEVER writes them without human confirmation |

### Syncing to Arbiter template library

When a user edits an agent rule book in the Flow tab, the change is saved in two places:
1. Project repo: `arbiter/<pipeline>/<agent>/rules.md` (immediate)
2. Arbiter template library: `~/.arbiter/templates/<pipeline>/<agent>/rules.md` (immediate)

This means improvements made in one project benefit all future projects bootstrapped
from the same Arbiter installation. If a user does NOT want a change to propagate to
the template library, they untick "Also update Arbiter templates" in the Flow tab editor.

---

## 16. The coordinator and babysitter — roles and differences

### Why two orchestrators?

The TypeScript `Conductor.ts` engine manages **mechanics**: state transitions, agent
dispatch, retry counting, gate polling, state.json writes. It has no intelligence —
it cannot read a design document and understand whether the frontend agent's output
matches it.

The **coordinator** and **babysitter** are Claude agent sessions that provide
**intelligence**: they read artifacts, verify quality, write summaries, chat with
the user, and update lessons learned. They are separate from the engine.

### Coordinator (full / 14-agent pipeline)

| Property | Value |
|---|---|
| Pipeline | Full (14-agent) Phase 2 |
| Rule book | `arbiter/14agent/coordinator/rules.md` |
| Model | Opus (deep reasoning required) |
| Initiated by | Conductor engine, at start of Phase 2 |
| Session | Persistent throughout Phase 2 — stays open until task reaches reviewer |

**What coordinator does:**
1. Reads all Phase 1 artifacts (`design-output.md`, `plan-output.md`, etc.) at Phase 2 start
2. Verifies each agent's output against the plan before advancing to the next agent
3. If output is incomplete or wrong: sends a revision request back to the agent (up to 2 retries)
4. Writes `summaries/phase2-summary.md` after each agent completes — this summary persists forever
5. Writes `summaries/lessons-learned.md` when the task completes or fails
6. Provides the **live chat session** in the task modal — the user types here; coordinator responds
7. The TypeScript engine can write messages into the coordinator's chat session programmatically
   (e.g. "gate failed with reason X — what should we do?")
8. Reports completion to the conductor engine via `arbiter/comms/coordinator.json`

**What coordinator does NOT do:**
- Does not write source code
- Does not run gate scripts
- Does not commit or push
- Does not make pipeline routing decisions (engine does that)
- Does not replace the babysitter

### Babysitter (fast / 5-agent pipeline)

| Property | Value |
|---|---|
| Pipeline | Fast (5-agent) |
| Rule book | `arbiter/fast/babysitter/rules.md` |
| Model | Opus |
| Initiated by | Conductor engine, at start of fast pipeline; OR by user directly |
| Session | Persistent throughout fast pipeline |

**What babysitter does:**
1. **If initiated directly by user (no Phase 1)**: writes its own PRD (`task.md` + `design-output.md`)
   in a single pass, then proceeds as coordinator
2. **If initiated after Phase 1**: reads Phase 1 artifacts, checks them, passes context to fast agents
3. Monitors fast agents (frontend, backend, test, push)
4. Verifies each agent's output before advancing
5. Writes stage summaries (persisted forever)
6. Provides the live chat session in the task modal
7. Writes lessons learned on completion

**What babysitter does NOT do:**
- Does not replace the coordinator — the two are never interchangeable
- Does not run in the full pipeline
- Does not produce design artifacts when initiated after Phase 1 (reads them, does not rewrite them)

### Side-by-side comparison

| Property | Coordinator | Babysitter |
|---|---|---|
| Pipeline | Full (14-agent) | Fast (5-agent) |
| Can create PRD from scratch | No | Yes (if initiated directly) |
| Agents it monitors | coordinator→frontend→backend→test-writer→debugger→reviewer→tech-writer | babysitter→frontend→backend→test→push |
| Chat available in modal | Yes | Yes |
| Writes lessons learned | Yes | Yes |
| Can be swapped for each other | **No — different rule books, different pipelines** | **No** |

---

## 17. Dashboard — three swim lanes

### Layout overview

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  ARBITER DASHBOARD                                            [Settings] [Flow]     │
├──────────────────────┬──────────────────────────┬─────────────────────────────────┤
│  ANALYSIS            │  FULL PIPELINE (14-agent) │  FAST PIPELINE (5-agent)        │
│  Phase 1             │  Phase 2 — Execution      │  Phase 2 — Execution            │
├──────────────────────┼──────────────────────────┼─────────────────────────────────┤
│  Reframe │ Research  │ Coord. │Front │Back │Test │ Baby. │Front │Back │Test │Push  │
│          │ Design    │        │      │     │     │       │      │     │     │      │
│          │ Integr.   │ Writer │      │     │     │       │      │     │     │      │
│          │ Plan      │ Debug  │      │     │     │       │      │     │     │      │
│          │ ✓ Gate    │ Review │      │     │     │       │      │     │     │      │
│          │           │ T-Writ │      │     │     │       │      │     │     │      │
│                      │                          │                                  │
│  [task card]         │  ← drag here for full    │  ← drag here for fast           │
└──────────────────────┴──────────────────────────┴─────────────────────────────────┘
```

### Lane 1 — Analysis (Phase 1)

**Columns:** Reframe | Research | Design | Integrator | Plan | ✓ Human Checkpoint

- All new tasks enter here
- Tasks cannot be dragged to an execution lane until the Human Checkpoint column is reached
- Human checkpoint column shows two buttons: **"Send to Full"** and **"Send to Fast"**
- Drag-and-drop also works: drag from the checkpoint card to either execution lane

### Lane 2 — Full Pipeline execution

**Columns:** Coordinator | Frontend | Backend | Test-Writer | Debugger | Reviewer | Tech-Writer

- 7 columns (Phase 1 is not repeated here)
- Debugger column is grayed out when not active (only appears when a gate fails)
- Tasks move left to right as each agent completes

### Lane 3 — Fast Pipeline execution

**Columns:** Babysitter | Frontend | Backend | Test | Push

- 5 columns
- If a task is initiated directly through babysitter (no Phase 1), it starts in the Babysitter
  column directly — Lane 1 is skipped

### Within a lane — task card appearance

```
┌─────────────────────────────────┐
│ 🔵 FEAT-051                [M]  │   ← task ID + size badge (S/M/L)
│ Add subscription upgrade flow   │
│ ────────────────────────────── │
│ FULL  ⏱ 2h 14m   🔗 2 deps    │   ← pipeline badge, elapsed time, dependency count
│ ▶ backend running...            │   ← current active agent
└─────────────────────────────────┘
```

**Card color states:**

| Color | Meaning |
|---|---|
| White / default | Running normally |
| Amber / orange | Human gate pending — requires your attention |
| Red | Agent failed — task moved to failed state |
| Green | Task completed — PR open or merged |
| Blue outline | Task is in chat (modal open) |

---

## 18. Task lifecycle — creation, sizing, dependencies

### Step 1 — Creating a task

The user creates a task by either:
- **Dashboard "New Task" button** — types the requirement into a text field; supports markdown
- **CLI** — `arbiter add "requirement text"` or `arbiter add --file spec.md`
- **Babysitter direct initiation** — opens the fast pipeline directly with the babysitter
  creating the PRD; Phase 1 is skipped

A task ID is assigned immediately (before any agent runs).

### Step 2 — Reframe agent: module/component check

The reframe agent is the FIRST to run on every task that goes through Phase 1. Before
classifying the task archetype, it performs a **reuse check**:

1. Reads the requirement
2. Reads `arbiter/knowledge/frontend-standards.md` and the project's component registry
   (`arbiter/registry.json`) to understand what already exists
3. Answers: "Can any part of this requirement become a standalone reusable component,
   hook, service, or module — rather than being built inline?"
4. If yes: the reframe agent creates a **follow-up task** (`arbiter/tasks/<new-id>/task.md`)
   and adds it to the analysis lane with a dependency link back to the parent task
5. The original task notes the dependency: "depends on <new-id>"

This ensures reusable pieces are extracted before any code is written.

### Step 3 — Task sizing (after design agent)

After the design agent produces `design-output.md`, the plan agent classifies the
task size based on:

| Size | Criteria |
|---|---|
| **S** (Small) | ≤ 5 files changed, no DB migration, no new API endpoints |
| **M** (Medium) | 6–20 files, ≤ 2 new endpoints, ≤ 1 new table |
| **L** (Large) | 21+ files, OR new module, OR 3+ new endpoints, OR 2+ new tables |

The size badge appears on the task card once the plan agent completes. It is
informational only — it does not change the pipeline.

### Step 4 — Dependency tracking

Tasks that depend on other tasks show a dependency badge on the card (e.g. `🔗 2 deps`).
Clicking the badge opens a panel listing the blocking tasks with their current status.
A task in Phase 2 (execution) whose dependencies have not yet merged is flagged
amber — the conductor will not start execution until dependencies are resolved.

**Dependency rules:**
- Dependencies are set by the reframe agent (automatic) or by the user (manual)
- A task can only be dispatched to Phase 2 after ALL its dependencies are in
  `06-completed` state
- The conductor checks dependency status before dispatching any Phase 2 agent

---

## 19. Agent session lifecycle — open, work, confirm, close

Every agent (except coordinator and babysitter) follows this strict lifecycle to
prevent context accumulation and idle sessions.

```
Conductor engine                    Agent (Claude session)
      │                                      │
      │  1. Dispatch: assemble context       │
      │     (reads manifest, loads files)    │
      │─────────────────────────────────────>│
      │                                      │ 2. Agent works
      │                                      │    (reads, writes output file)
      │                                      │ 3. Agent writes comms file:
      │                                      │    arbiter/comms/<agent>.json
      │<─────────────────────────────────────│    {"status":"done","output":"..."}
      │                                      │
      │  4. Coordinator/babysitter reads     │
      │     the output file                  │
      │     Verifies against plan/PRD        │
      │                                      │
      │  5a. Verification PASS               │
      │      → Session terminates            │ ← agent session CLOSED
      │      → Next agent dispatched         │
      │                                      │
      │  5b. Verification FAIL               │
      │      → Send revision request         │
      │─────────────────────────────────────>│ ← SAME session, revision
      │                                      │ Agent revises, rewrites output
      │                                      │ Writes comms file again
      │<─────────────────────────────────────│
      │  (max 2 retries; then 07-failed)     │
```

**Key rules:**
- An agent session is closed as soon as its output is verified. It does NOT stay open.
- The coordinator/babysitter is the ONLY long-running session during Phase 2.
- Context is released on session close — no accumulation between tasks.
- The comms file (`arbiter/comms/<agent>.json`) is the handoff signal. Without it,
  the conductor treats the agent as still running.

---

## 20. Human gates — notification, color, and chat

### When a gate triggers

A human gate pauses the pipeline and:
1. The task card turns **amber/orange** in the dashboard
2. The task moves to a "waiting" column in its lane
3. A Telegram message is sent to the user's configured chat ID (see Section 22)
4. The task modal shows a prominent "Gate pending — your action required" banner

### Gate types

| Gate | Lane | Trigger | What you see |
|---|---|---|---|
| Schema gate | Full pipeline, after design | DB changes detected | Mermaid ER diff + approval buttons |
| UI gate | Both pipelines, after frontend | `ui_first: true` | Vision screenshots before/after |
| Human review gate | Both pipelines, after reviewer | Reviewer yields to human | Reviewer findings + PR diff |
| Custom gate | Either pipeline, user-defined | Added in Flow tab | Custom checklist defined by user |

### Approving or rejecting

**Via dashboard:** Click "Approve" or "Reject" button on the gate card. Rejection
requires a reason — the reason is passed back to the responsible agent.

**Via CLI:**
```
arbiter approve <task-id> <gate-name>
arbiter reject  <task-id> <gate-name> "reason"
```

**Via Telegram:** The notification includes two inline buttons: ✅ Approve and ❌ Reject.
Tapping ❌ opens a reply prompt for the reason.

### Gate timeout

If a gate is not resolved within `GATE_TIMEOUT_HOURS` (default 48h, configurable in
`arbiter.config.json`), the conductor sends a reminder Telegram message. The task
remains amber and paused — it never auto-approves or auto-fails.

### Chat with coordinator/babysitter during a gate

When a gate is pending, the user can open the task modal and go to the **Chat tab**
to discuss the gate with the coordinator or babysitter. The session is live and
persistent — the coordinator has full context of the task. Examples of use:

- "Why did the design agent add this FK — doesn't that violate module isolation?"
- "The UI screenshot looks wrong. What did the frontend agent do here?"
- "Can we modify the plan before approving the schema?"

The coordinator can also read and respond to these questions, then update the relevant
output file if needed — but only with user confirmation.

---

## 21. Stage summaries and lessons learned

### Stage summaries (persist forever)

After each Phase 2 agent completes and is verified, the coordinator/babysitter writes
a stage summary to `arbiter/tasks/<task-id>/summaries/`:

```
phase1-summary.md       ← written after plan agent completes
phase2-summary.md       ← written after reviewer completes
lessons-learned.md      ← written on task completion or failure
```

**The summary is never discarded, even when the task is archived to `arbiter/completed/`.**
It is the permanent record of what was done, what decisions were made, and why.

A summary contains:
- Which agent ran, what model it used, how long it took
- Key decisions made (e.g. "chose outbox pattern over direct call because X")
- What the agent produced (concise, not the full output)
- Any surprises, deviations from plan, or retries needed

### Lessons learned

`lessons-learned.md` is written per task by the coordinator/babysitter and contains
things that should inform future tasks of the same type. It is automatically proposed
as an addition to `arbiter/engine/CLI-LESSONS-LEARNED.md` — the human confirms before
the addition is committed.

The tech-writer agent (full pipeline only) also proposes additions to the relevant
agent rule book based on lessons learned. This is a proposal only — never auto-applied.

### Context used tracking

Each agent's comms file (`arbiter/comms/<agent>.json`) records:
```json
{
  "status": "done",
  "agent": "frontend",
  "task_id": "FEAT-051",
  "started_at": "2026-05-28T10:00:00Z",
  "completed_at": "2026-05-28T10:42:00Z",
  "elapsed_seconds": 2520,
  "input_tokens": 48320,
  "output_tokens": 12840,
  "model": "claude-sonnet-4-6",
  "retries": 0
}
```

This data is surfaced in the task modal **Timeline tab** as a per-agent row showing
time spent and context (tokens) used. The total elapsed time (first agent start to
reviewer complete) is shown at the top of the Timeline tab.

---

## 22. Telegram notifications

### User bot (configurable in Settings)

Each developer configures their own Telegram bot token and personal chat ID in the
Settings tab. This is stored in `arbiter.config.json` under `reporting.owner_chat_id`.

**Notifications sent to the user:**
- Human gate requires action (amber card + Telegram + inline Approve/Reject buttons)
- Gate timeout reminder (every 12h after first timeout)
- Task completed (PR open/merged)
- Task failed (moved to 07-failed)
- Daily summary at `report_hour` (list of tasks completed, in-progress, blocked)

### Admin bot (hidden — not visible to users)

There is a second Telegram bot configured at the Arbiter installation level
(`~/.arbiter/admin.config.json`, never committed to any project repo). This is
the admin channel — developers should not know it exists or what it reports.

**Reports sent to admin:**
- Daily digest for ALL users: tasks completed per user, time per task, models used
- Comparisons between users (velocity, pipeline choices, failure rates)
- Weekly aggregate: team throughput, most common failure reasons, lessons learned count

The admin config is set during `arbiter install` and is separate from any
project configuration. It is never visible in the dashboard Settings tab.

---

## 23. Flow tab — agent documents and custom gates

### What the Flow tab shows

The Flow tab visualizes the active pipeline configuration as a node graph:

```
[Reframe] → [Research] → [Design] → [Integrator] → [Plan] → ✓ Gate
                                                                │
                    ┌───────────────────────────────────────────┤
                    │                                           │
            [Coordinator]→[Frontend]→[Backend]→[Test-Writer]  [Babysitter]→[Frontend]→...
               [Debugger]→[Reviewer]→[Tech-Writer]             →[Test]→[Push]
```

### Editing agent rule books

Clicking any agent node opens an editor panel showing:
- `rules.md` content (editable in a markdown editor)
- `manifest.yaml` content (editable)
- The agent's model assignment (dropdown: Opus / Sonnet / Haiku / Qwen / Local)
- The agent's provider (Claude Max CLI / Anthropic API / OpenAI / Gemini / Ollama)
- If API provider: API key field (stored encrypted, never committed)

**Editing is only allowed when the agent is idle** (not currently running a task).
If the agent is running, the editor is read-only with a lock icon.

**Save behavior:**
- Saves to `arbiter/<pipeline>/<agent>/rules.md` in project repo
- Simultaneously saves to Arbiter template library (`~/.arbiter/templates/...`)
- "Also update Arbiter templates" checkbox — untick to save project-only

### Adding a custom human gate

In the Flow tab, the user can drag a **Gate** node from the sidebar and drop it
between any two agent nodes in either pipeline.

A gate requires:
- **Name** (e.g. "Security review", "Product sign-off")
- **Checklist** — markdown checklist items the human must check before approving
- **Timeout hours** — how long before a reminder is sent

Custom gates behave identically to built-in gates (amber card, Telegram, chat).

### Adding a custom agent

The user can add a new agent node to either pipeline by dragging an **Agent** node
from the sidebar. They must provide:
- Agent name (used as the folder name and comms key)
- `rules.md` — written from scratch or loaded from a template
- `manifest.yaml` — which files the agent reads
- Model and provider assignment

New agents follow the same lifecycle as built-in agents (dispatch, comms file,
coordinator verification, session close).

---

## 24. Model groups and i7/i8 enforcement

### Model groups

All agents are assigned to a model group. The assignment is per-agent in `arbiter.config.json`.

| Group | Models | Default agents |
|---|---|---|
| **Opus** | claude-opus-4-7 | coordinator, babysitter, integrator, plan, debugger, reviewer, surveyor |
| **Sonnet** | claude-sonnet-4-6 | reframe, research, design, frontend, backend, test-writer, test (fast), tech-writer |
| **Haiku** | claude-haiku-4-5 | design-critic ONLY |
| **Qwen** | qwen (configurable) | optional, user-assigned |
| **Local** | ollama (configurable) | optional, user-assigned |

### Why Haiku is banned from test-writer

**Validated decision (2026-05-xx):** Haiku fails test-writing. It cannot simultaneously
hold fixture patterns, assertion library conventions, coverage invariants, and
descriptive `DisplayName` requirements. Multiple real task attempts failed with Haiku
before this was locked. Test-writer is Sonnet — this is not optional and must not be
changed without re-running the validation suite.

### i7 — cross-model audit on research vs design

**i7 invariant:** the research agent and design agent should be from different model
families so the design agent is not correcting work it effectively produced (same
training = same blind spots).

**Current state:** both are Sonnet (same family). This is currently a **WARN** — tracked
but not a hard block. It is softened because the cross-model second opinion is primarily
enforced by i8 (reviewer vs builders), and changing research to Opus doubles cost with
marginal benefit at this stage.

**Future:** when Qwen or local models are configured, research can be routed to them
to satisfy i7 cleanly. Track this in open questions.

### i8 — cross-model audit on reviewer vs builders

**i8 invariant (HARD ENFORCED):** the reviewer must be a different model family from
the frontend and backend agents.

| Agent | Model | Family |
|---|---|---|
| frontend | claude-sonnet-4-6 | Sonnet |
| backend | claude-sonnet-4-6 | Sonnet |
| test-writer | claude-sonnet-4-6 | Sonnet |
| reviewer | claude-opus-4-7 | Opus ✓ |

The conductor engine checks this at startup. If reviewer and builders are the same
model family, the conductor logs a HARD ERROR and refuses to run Phase 2.

### Per-agent model configuration in arbiter.config.json

```json
{
  "roles": {
    "frontend": {
      "provider": "claude_max_cli",
      "model": "claude-sonnet-4-6"
    },
    "reviewer": {
      "provider": "anthropic_api",
      "model": "claude-opus-4-7",
      "api_key_env": "ANTHROPIC_API_KEY"
    },
    "local-agent": {
      "provider": "ollama",
      "model": "llama3.1:70b",
      "endpoint": "http://localhost:11434/api/generate"
    }
  }
}
```

### Provider types and configuration

| Provider | Config required | When to use |
|---|---|---|
| `claude_max_cli` | Just the model name | Claude Max subscription; no per-token cost |
| `anthropic_api` | API key (`ANTHROPIC_API_KEY`) | Pay-per-token; needed for CI/CD pipelines |
| `openai` | API key (`OPENAI_API_KEY`) | GPT-4o / o3 for specific agents |
| `gemini` | API key (`GOOGLE_API_KEY`) | Gemini Pro / Ultra |
| `ollama` | Endpoint URL + model name | Local models; no internet, no cost |

API keys are entered in the Settings tab → Provider Configuration. They are stored
encrypted in `~/.arbiter/keys.enc` — **never** in the project repo.

---

## 25. Git PR hard rules

These rules apply to all code produced by all agents and all human contributors.
The conductor enforces them before any PR is opened. Violations block the reviewer.

### Branch naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<task-id>-short-name` | `feat/FEAT-051-subscription-upgrade` |
| Bug fix | `fix/<task-id>-short-name` | `fix/FIX-052-contacts-pagination` |
| Migration | `migr/<task-id>-short-name` | `migr/MIGR-053-add-subscription-table` |
| Test backfill | `test/<task-id>-short-name` | `test/TEST-055-auth-coverage` |
| Refactor | `refactor/<task-id>-short-name` | `refactor/REFAC-054-date-utils` |
| Docs | `docs/<task-id>-short-name` | `docs/DOCS-056-runbook-update` |

### Hard rules (enforced by conductor before PR opens)

1. **TypeScript strict** — `npm run typecheck` must pass with zero errors. No `any` without a comment explaining why.
2. **All tests green** — `npm test` must pass. No skipped tests without a `// reason:` comment.
3. **New behaviour covered** — every new public function, endpoint, or component has at least one test.
4. **`ServiceResult<T>` everywhere** — no `throw` from service or data layers. Only throw at the very top level (unhandled process error).
5. **Atomic file writes** — any file write uses the `tmp → rename` pattern (as in `StateStore.write`). Never write directly to the final path.
6. **150-line method limit** — no single function or class method exceeds 150 lines.
7. **No default exports** — named exports only.
8. **Coverage floors hold** — coverage thresholds in the config must not decrease. Ratchet only up.
9. **No hardcoded secrets** — no API keys, tokens, or passwords in any committed file. Checked by `preflight/SecretsScanner.ts` before dispatch.
10. **PR description required** — every PR must have a summary section and a test plan. Auto-generated by tech-writer (full pipeline) or reviewer (speed pipeline).

### What happens when a rule is violated

The conductor's preflight check (`src/preflight/PreflightCheck.ts`) runs before the
reviewer is dispatched. If any hard rule fails:
1. The task moves to amber (human gate pending) — not to failed
2. The Telegram notification names the specific rule that failed
3. The task card shows the violation inline
4. The responsible coder agent is dispatched again with the violation as context

---

## 26. Multi-user model

### Local version (current)

- Multiple developers work on the **same git repo**
- No login required — identity is the git author on commits
- Tasks are **per-developer** — each developer's `arbiter/tasks/` changes are local
  (not pushed until the branch is pushed)
- The `arbiter/state.json` is gitignored in the working tree — each developer has
  their own local state
- When a PR is merged, the `arbiter/tasks/<task-id>/` folder is committed as part
  of the branch — so the team can see the task artifacts post-merge in the main branch

### Future web version

- Tasks are stored server-side (cloud state.json)
- Tasks are visible to all team members in the shared board
- Tasks can be assigned to specific team members
- Each team member has a profile (name, Telegram bot, model preferences)
- The admin bot receives reports scoped per team

### What does NOT change between local and web

- `arbiter/` folder structure is identical
- Agent rule books, manifests, KB docs are the same
- All pipeline mechanics (Phase 1, Phase 2, gates) are the same
- The only difference is WHERE `state.json` lives (local file vs cloud)

---

## 27. What needs to be built / changed (complete list)

### A. Schema and document changes
1. **`TASK-SCHEMA.md`** — add `pipeline`, `pipeline_auto`, `size` fields to `5-plan.json`; add `pipeline` to per-agent task frontmatter
2. **`TASK-ARCHETYPES.md`** — add pipeline default column + agents-per-pipeline table
3. **`SEQUENCING-POLICY.md`** — add pipeline routing + dependency check rules
4. **`engine/PLAN.md`** — update `5-plan.json` example block
5. **`arbiter.config.json`** — add `pipeline_routing` block; fix test-writer model (Haiku → Sonnet) ✅ done

### B. New agent rule books to write
6. **`arbiter/14agent/coordinator/rules.md`** — coordinator agent (new, does not exist)
7. **`arbiter/fast/babysitter/rules.md`** — already exists as `SOLTAN-BABYSITTER-RULES.md` in Foederata; needs parameterization and cleanup
8. **`arbiter/fast/push/rules.md`** — push agent (combines test + review + git + PR + CI wait)
9. **Rename** `agents/templates-speed/design.md` → `arbiter/fast/babysitter/rules.md` (they serve the same role)

### C. Folder structure migration
10. Rename `.arbiter/` → `arbiter/` (visible) across all template references and `src/`
11. Reorganize `agents/templates/` into `arbiter/requirement-gathering/` and `arbiter/14agent/`
12. Reorganize `agents/templates-speed/` into `arbiter/fast/`
13. Move `agents/manifests/` → per-agent `manifest.yaml` files inside each agent folder
14. Move `agents/knowledge/` → `arbiter/knowledge/`
15. Move `engine/` → `arbiter/engine/`

### D. Conductor engine changes (TypeScript)
16. **Read `arbiter/` (not `.arbiter/`)** — update all path references in `src/`
17. **Pipeline routing** — read `pipeline` from `5-plan.json`; dispatch from correct agent folder
18. **Coordinator/babysitter dispatch** — spawn coordinator or babysitter at Phase 2 start
19. **Dependency gate** — block Phase 2 dispatch if any dependency is not in `06-completed`
20. **i8 startup check** — hard error if reviewer and builders are same model family
21. **Comms file tracking** — read `arbiter/comms/<agent>.json` for agent completion signals
22. **Context metrics** — record `input_tokens`, `output_tokens`, `elapsed_seconds` per agent to comms file
23. **Task size classification** — call `ComplexityScorer` after plan agent; write size badge to `state.json`

### E. Dashboard changes (React)
24. **Three swim lanes** — Analysis | Full Pipeline | Fast Pipeline
25. **Drag-and-drop** — from Analysis lane Human Checkpoint to Full or Fast lane
26. **Pipeline badge** on task cards (FULL / SPEED)
27. **Size badge** on task cards (S / M / L)
28. **Dependency badge** — shows count; click opens dependency panel with links to blocking tasks
29. **Amber color** for human gate pending; red for failed; green for completed
30. **Task modal** with tabs: Chat | PRD | Timeline | Dependencies
31. **Chat tab** — live persistent Claude session (coordinator or babysitter depending on lane)
32. **PRD tab** — view/edit `design-output.md` with AI assist; changes require confirmation
33. **Timeline tab** — per-agent rows with elapsed time + context tokens; total elapsed at top
34. **Dependencies tab** — links to blocking tasks; status of each
35. **Flow tab** — agent node graph; click to edit rule book; drag Gate or Agent nodes; model picker
36. **Settings tab** — Telegram bot token + chat ID; provider API keys; `GATE_TIMEOUT_HOURS`

### F. Telegram integration
37. **User bot** — gate notifications with inline Approve/Reject; task complete/fail alerts; daily summary
38. **Admin bot** — separate config (`~/.arbiter/admin.config.json`); daily digest per user; never visible in dashboard

### G. Documentation
39. **`docs/RUNBOOK.md`** — add pipeline selection guide, gate operating guide, chat guide
40. **`README.md`** — add three-lane diagram

---

## 28. Open questions (current)

### Resolved (from Q&A 2026-05-28)
- ~~Q1: arbiter/ visible?~~ **Yes, visible and committed**
- ~~Q2: Babysitter is agent or coordinator?~~ **Agent with own PRD capability if initiated directly**
- ~~Q3: Push does what?~~ **All of: test + review + git + PR + CI monitor**
- ~~Q4: Conductor agent needed?~~ **Yes — coordinator agent (separate from TypeScript engine)**
- ~~Q5: Column width?~~ **7-8 columns (Phase 1 is its own lane)**
- ~~Q6: Module check?~~ **Part of reframe agent, creates follow-up task**
- ~~Q7: Chat session?~~ **Live persistent session in task modal**
- ~~Q8: Multi-user?~~ **Team tool, no login; tasks local in local version**
- ~~Q9: Flow tab save scope?~~ **Both project repo AND Arbiter template library**
- ~~Q10: Bash script?~~ **No bash script — conductor is TypeScript**
- ~~Q11: Test-writer model?~~ **Sonnet (Haiku validated as failing)**
- ~~Q12: Gate color?~~ **Amber/orange**

### Still open
1. **i7 resolution**: research and design are both Sonnet. When Qwen or local models
   are introduced, which agent gets reassigned to satisfy i7? Proposed: research → Qwen
   (RAG routing is well-suited to smaller fast models). **Needs decision when providers are added.**

2. **Mid-flight coordinator failure**: if the coordinator session crashes mid-Phase-2,
   the conductor engine can restart it — but does the coordinator resume from the last
   summary, or restart Phase 2 from the beginning? **Proposed: resume from last verified
   agent (read summaries/ folder). Needs validation.**

3. **Babysitter standalone flow — gate behavior**: when babysitter creates its own PRD
   (no Phase 1), there is no schema gate (no schema was reviewed by the integrator).
   Should the babysitter's standalone flow still require a schema gate if DB changes are
   detected? **Proposed: yes — schema gate is mandatory for DB changes regardless of pipeline.**

4. **chat session persistence across browser closes**: if the user closes the dashboard,
   does the coordinator/babysitter chat session survive? **Proposed: yes — sessions are
   server-side processes, not browser-held WebSockets. Session resumes on next open.**
   Needs implementation decision.

5. **Admin bot visibility**: the admin bot is explicitly hidden from users. Is there any
   setting or CLI command a developer could accidentally run that would reveal its
   existence? **Needs audit of CLI help text and settings output.**

---

## 12. Glossary

| Term | Definition |
|---|---|
| Phase 1 | Discovery and planning pass: reframe → research → design → integrator → plan. Always runs. Always full-pipeline agents. |
| Phase 2 | Execution pass: build + test + review. Switchable: full pipeline or fast pipeline. |
| Full pipeline | 6 Phase-1 agents + 7 Phase-2 agents (coordinator, frontend, backend, test-writer, debugger, reviewer, tech-writer) |
| Fast pipeline | 6 Phase-1 agents (shared) + 5 Phase-2 agents (babysitter, frontend, backend, test, push) |
| Conductor (engine) | TypeScript `Conductor.ts` — manages mechanics: state, dispatch, retry, gates. Has no semantic intelligence. |
| Coordinator (agent) | Claude session — project manager for full pipeline Phase 2. Reads artifacts, verifies quality, chats with user, writes summaries. |
| Babysitter (agent) | Claude session — project manager for fast pipeline. Can create its own PRD if initiated directly. Different rule book from coordinator. |
| Push agent | Fast pipeline only. Does all of: run tests, review code, commit, open PR, monitor CI until green. |
| `arbiter/` | Visible folder committed in project root. Contains all Arbiter runtime files, rule books, and task artifacts. |
| `state.json` | Machine state for all tasks. Lives at `arbiter/state.json`. Source of truth for conductor and dashboard. |
| Archetype | Task classification (feature, backend-fix, db-migration, etc.) used to auto-route to a default pipeline. |
| `pipeline` field | Field in `5-plan.json` that tells the conductor which Phase 2 to run: `"full"` or `"fast"`. |
| `pipeline_auto` | `true` = auto-routed by archetype; `false` = user override at dispatch. |
| Dispatch | The moment a task is moved from the Analysis lane to either execution lane. |
| Gate | A pause point requiring human action before the pipeline continues. |
| Stage summary | Written by coordinator/babysitter after each agent completes. Persists forever, even after task completion. |
| Lessons learned | Per-task file written by coordinator/babysitter. Proposed as addition to `arbiter/engine/CLI-LESSONS-LEARNED.md`. |
| i7 | Invariant: research agent and design agent should be different model families. Currently softened to WARN. |
| i8 | Invariant (HARD): reviewer must be a different model family than builders. Opus reviewer vs Sonnet builders. |
| Human gate | Any of: schema gate, UI gate, review gate, custom gate. Triggers amber card + Telegram notification. |
| Size badge | S / M / L classification set by plan agent after design. Informational only. |
| Dependency | A task that must reach `06-completed` before the dependent task can be dispatched to Phase 2. |
| Admin bot | Hidden Telegram bot at Arbiter installation level. Receives daily reports for all users. Never visible in dashboard. |
| `arbiter sync` | CLI command that diffs project rule books against latest Arbiter templates and lets user cherry-pick updates. |
| Comms file | `arbiter/comms/<agent>.json` — the signal an agent writes when its work is done. Coordinator reads this to advance the pipeline. |
| Triage agent | Pre-Phase-1 stateless router. Reads only task.md + arbiter.config.json. Outputs tier + profile + reason. Uses Haiku/local. |
| Tier | Task complexity class assigned by Triage: 1 (trivial), 2 (fix), 3 (feature). Determines which agents run. |
| Iron Funnel | The 5-gate validation sequence (Compiler Airlock → Test Writer → Proving Ground → Debugger → Orchestrator). Replaces sequential agent verification. |
| Compiler Airlock | Gate 1 of the Iron Funnel. Deterministic: tsc + eslint + Prisma validate. Zero LLM tokens. Rejects immediately if code fails to compile. |
| Proving Ground | Gate 3 of the Iron Funnel. Deterministic: runs full test suite (jest/pytest/playwright). Must exceed coverage ratchet floor. |
| Machine-Enforceable Contracts | Actual compilable code output by Phase 1 Design agent for Tier 3: schema.prisma, contracts/api.ts (Zod), contracts/events.ts. Compiler holds the memory — agents don't need to. |
| Orchestrator | Renamed from Coordinator/Babysitter. Unified event-driven agent. State in SQLite. Woken by conductor on events. Feels persistent to user; stateless to infrastructure. |
| Event-driven agent | An agent whose state is persisted in SQLite between invocations. The conductor wakes it, injects state + event, gets response, saves new state, terminates LLM process. |
| Git Worktree | Isolated git checkout created per task (`git worktree add ../arbiter-<task-id>`). All agents write here. Merged on success, deleted on failure. Developer's branch is never touched. |
| madge | Dependency analysis CLI used by Context Builder. Traces exact import graph from a target file. Used to slice context to only the files an agent actually needs. |
| better-sqlite3 | Synchronous SQLite driver for Node.js. Replaces state.json. ACID-compliant, WAL mode, handles concurrent agent writes without race conditions. |
| WAL mode | Write-Ahead Logging — SQLite mode that allows concurrent reads during writes. Mandatory for multi-agent / multi-user state management. |

---

# v2 Architecture — Locked Decisions (2026-05-28)

The following sections (29–35) define the synthesised v2 architecture. Where any
section above conflicts with these, **sections 29–35 take precedence**.

---

## 29. The Triage Agent — upstream stateless router

### Location and identity

```
arbiter/
  triage/
    rules.md       ← triage agent instructions
    manifest.yaml  ← reads: task.md + arbiter.config.json ONLY
```

The Triage agent is the **first thing that runs on every task**, before Phase 1 and
before any planning agent. It is not a planning agent — it is a cheap router.

### Hard constraints

- **Input**: `task.md` (the raw requirement) + `arbiter.config.json` (known profiles)
- **Never reads**: the codebase, any source file, any previous task artifact
- **Model**: Haiku or local Qwen/Ollama — must be the cheapest available provider
- **Context limit**: hard cap at 4,000 tokens input — if the task description exceeds
  this, Triage truncates to the first 4,000 tokens and notes the truncation in its output
- **Stateless**: no state, no session, no follow-up. One call → one JSON output → done

### Output: `arbiter/tasks/<task-id>/triage.json`

```json
{
  "tier": 3,
  "profile": "web-standard",
  "reason": "New module with DB migration and API endpoints — requires contract generation",
  "bypass_phase1": false,
  "estimated_agents": ["reframe","research","design","integrator","plan","frontend","backend","test-writer","orchestrator"],
  "complexity_hint": "L"
}
```

| Field | Type | Description |
|---|---|---|
| `tier` | `1 \| 2 \| 3` | Pipeline depth: 1=trivial, 2=fix, 3=feature |
| `profile` | `string` | Domain profile (web-standard, data-analysis, etc.) |
| `reason` | `string` | One sentence explaining the routing decision |
| `bypass_phase1` | `boolean` | True for Tier 1 and 2 — skip the 6 planning agents |
| `estimated_agents` | `string[]` | Best-guess agent list; plan agent confirms/adjusts for Tier 3 |
| `complexity_hint` | `S \| M \| L` | Feeds the size badge on the task card |

### Routing outcomes

| Tier | bypass_phase1 | What happens next |
|---|---|---|
| 1 (Trivial) | `true` | Conductor dispatches single Coder agent → deterministic gate → auto-merge |
| 2 (Fix) | `true` | Conductor dispatches Investigator → Coder → Iron Funnel (Tier 2 mode) |
| 3 (Feature) | `false` | Conductor runs full Phase 1 → contract generation → Generators → Iron Funnel |

---

## 30. 3-Tier Pipeline Routing

### Tier 1 — Trivial (Hot-Swap)

**Examples**: typos, CSS tweaks, copy changes, config value updates, single-line fixes

```
Triage → Coder Agent → Gate 1 (Compiler Airlock only) → auto-merge
```

- **No LLM reviewer**. Gate 1 (compiler + linter) is the only check.
- If Gate 1 passes: PR is opened with squash merge and auto-merged.
- If Gate 1 fails: returned to Coder with the exact error. One retry. Then `07-failed`.
- **Target time: ~30 seconds.**
- Git Worktree: yes, still mandatory.

### Tier 2 — Fix (Bypass Phase 1)

**Examples**: bug fixes, minor logic adjustments, test backfills, small refactors

```
Triage → Investigator → Coder → Iron Funnel (full 5 gates)
```

- **Bypasses Phase 1** — no reframe, research, design, integrator, plan agents.
- **Bound by existing contracts**: the Coder cannot change `contracts/api.ts`,
  `contracts/schema.prisma`, or any locked contract file. Gate 1 enforces this.
- **Investigator agent**: reads the bug report + uses Context Builder (madge) to find
  the exact files causing the bug. Outputs a "Fix Strategy" doc.
- **Target time: ~3–5 minutes.**

### Tier 3 — Feature (Full Phase 1)

**Examples**: new modules, new DB tables, new API endpoints, greenfield features

```
Triage → Phase 1 (6 agents, Contract Generation) → Generators → Iron Funnel
```

- **Full Phase 1** runs: reframe → research → design → integrator → plan.
- Phase 1 must output **Machine-Enforceable Contracts** (see Section 35).
- Conductor validates contracts compile before Generators start.
- **Target time: ~15–30 minutes.**

---

## 31. The Iron Funnel — Generator-Validator Pipeline

Phase 2 is no longer a linear sequence of agents coding and then reviewing.
It is split into **Generators** (fast code drafting) and **The Iron Funnel**
(deterministic + semantic validation). This prevents context bleed and ensures
mathematical correctness at scale.

### The Generators

Once contracts are locked (Tier 3) or existing contracts are confirmed (Tier 2),
the Generators spin up:

- **Frontend Agent** and **Backend Agent** run concurrently (or in rapid sequence)
- **JIT Context Slicing**: Context Builder (madge + enhanced glob) feeds them only
  the specific files they need — never the whole codebase
- **Sole job**: write implementation code that satisfies the contracts
- **They do not write tests.** The Test Writer does that in Gate 2.

### The 5 gates

```
┌─────────────────────────────────────────────────────────────────────┐
│  GENERATORS                                                          │
│  Frontend Agent ──┐                                                  │
│  Backend Agent  ──┤ → code written to Git Worktree                  │
└───────────────────┘                                                  │
                     │                                                 │
           ┌─────────▼──────────────────────────────────────────────┐ │
           │  IRON FUNNEL                                            │ │
           │                                                         │ │
           │  Gate 1: Compiler Airlock (DETERMINISTIC)               │ │
           │    tsc --noEmit + eslint + prisma validate              │ │
           │    Checks code compiles AND matches Phase 1 contracts    │ │
           │    ✗ fail → back to Generator with exact error, 0 LLM   │ │
           │    ✓ pass → Gate 2                                      │ │
           │                                                         │ │
           │  Gate 2: Test Writer Agent (LLM — Sonnet)               │ │
           │    Activates only after Gate 1 passes                   │ │
           │    Reads generated code + contracts                     │ │
           │    Writes unit + integration tests                      │ │
           │    → Gate 3                                             │ │
           │                                                         │ │
           │  Gate 3: Proving Ground (DETERMINISTIC)                 │ │
           │    Runs full test suite (jest / pytest / playwright)    │ │
           │    Checks coverage ≥ ratchet floor                      │ │
           │    ✗ fail → Gate 4 (Debugger)                          │ │
           │    ✓ pass → Gate 5                                      │ │
           │                                                         │ │
           │  Gate 4: Debugger (LLM — Opus, CONDITIONAL)             │ │
           │    Only triggered if Gate 3 fails                       │ │
           │    Given: test failure logs + generated code            │ │
           │    Max 2 attempts. If fails twice → 07-failed           │ │
           │    ✓ fix → back to Gate 3                               │ │
           │                                                         │ │
           │  Gate 5: Orchestrator Semantic Review (LLM — Opus)      │ │
           │    Only after Gates 1–3 all pass                        │ │
           │    Does NOT check syntax / types / test coverage        │ │
           │    Reviews: business logic flaws + security edge cases  │ │
           │    + "does this actually solve the requirement?"        │ │
           │    Opens PR on approve; returns to Generator on reject  │ │
           └─────────────────────────────────────────────────────────┘
```

### Gate summary table

| Gate | Type | Agent / Tool | Failure action |
|---|---|---|---|
| 1 — Compiler Airlock | Deterministic | `tsc`, `eslint`, `prisma validate` | Back to Generator, exact error, zero LLM cost |
| 2 — Test Writer | LLM (Sonnet) | Test Writer agent | Writes tests; continues to Gate 3 |
| 3 — Proving Ground | Deterministic | `jest` / `pytest` / `playwright` | Triggers Gate 4 (Debugger) |
| 4 — Debugger | LLM (Opus) — conditional | Debugger agent | Max 2 retries → Gate 3 → `07-failed` |
| 5 — Semantic Review | LLM (Opus) | Orchestrator | Reject → back to Generator; Approve → PR opened |

### What Gate 1 catches without spending a single LLM token

- Type errors (`tsc`)
- Linting violations (`eslint`)
- Contract violations (Zod types / Prisma schema mismatches)
- Forbidden patterns (no `dangerouslySetInnerHTML`, no direct DB imports in FE, etc.)
- Import of undeclared modules

**Every one of these would previously have been caught by the LLM Reviewer at high
token cost. Gate 1 catches them in milliseconds for free.**

---

## 32. Infrastructure Mandates

### Mandate 1 — Git Worktrees (zero local corruption)

Arbiter **never** writes directly to a developer's active working branch.

**On task dispatch:**
```bash
git worktree add ../arbiter-FEAT-051 -b feat/FEAT-051-short-name
```

All Generators and Iron Funnel agents operate exclusively in this isolated sandbox.
The developer's `main` / feature branch is never touched during execution.

**On success**: Conductor opens a PR from the worktree branch. Worktree is removed
after merge.

**On catastrophic failure**: Worktree is deleted. Zero traces. Developer's environment
is 100% pristine.

**Implementation**: `src/git/GitAutoCommit.ts` is refactored into `src/git/WorktreeManager.ts`.

---

### Mandate 2 — SQLite state management (concurrency)

`state.json` and `decision-log.jsonl` are **deprecated and removed**.

All task state, agent comms, pipeline routing, chat history, and metrics are managed
via a local SQLite database at `arbiter/state.db`.

**Driver**: `better-sqlite3` (synchronous, ACID-compliant). **Do NOT use Prisma,
TypeORM, or any async ORM for Arbiter's internal state machine.** Async drivers
in Node.js introduce race conditions when multiple agents complete simultaneously.
`better-sqlite3` is synchronous — it is bulletproof for concurrent local writes.

**SQLite configuration** (applied at database open time):
```sql
PRAGMA journal_mode = WAL;        -- Write-Ahead Logging: concurrent reads during writes
PRAGMA foreign_keys = ON;         -- Enforce referential integrity
PRAGMA synchronous = NORMAL;      -- Safe + fast under WAL
```

**Core schema** (abbreviated):
```sql
CREATE TABLE tasks (
  task_id     TEXT PRIMARY KEY,
  tier        INTEGER NOT NULL,         -- 1, 2, or 3
  pipeline    TEXT NOT NULL,            -- 'full' | 'fast'
  profile     TEXT NOT NULL,
  status      TEXT NOT NULL,            -- pending | building | gate | review | completed | failed
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE sub_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL REFERENCES tasks(task_id),
  agent_role  TEXT NOT NULL,
  status      TEXT NOT NULL,            -- pending | in_progress | completed | failed
  model       TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  elapsed_ms  INTEGER,
  started_at  TEXT,
  completed_at TEXT,
  output_hash TEXT                      -- sha256 of output file
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL REFERENCES tasks(task_id),
  event_type  TEXT NOT NULL,            -- gate_triggered | agent_completed | user_chat | etc.
  payload     TEXT NOT NULL,            -- JSON
  created_at  TEXT NOT NULL
);

CREATE TABLE orchestrator_state (
  task_id     TEXT PRIMARY KEY REFERENCES tasks(task_id),
  phase       TEXT NOT NULL,
  summary     TEXT,                     -- latest stage summary (JSON)
  chat_history TEXT NOT NULL DEFAULT '[]' -- JSON array of messages
);
```

**Dashboard benefit**: Any query the board needs runs instantly:
```sql
SELECT * FROM tasks WHERE status = 'gate' AND tier = 3;
SELECT SUM(elapsed_ms) FROM sub_tasks WHERE task_id = 'FEAT-051';
```

---

### Mandate 3 — Git LFS + Squash merging (repo hygiene)

**Problem**: AI agents generate 30–100k tokens of intermediate text per task.
A team of 5 running 10 tasks/day commits ~5M tokens of markdown to git history.
Within a month, `git clone` takes minutes and the repo is multiple gigabytes.

**Rule — what goes in standard git:**
- Final approved artifacts ONLY: `design-output.md`, `plan-output.md`, `contracts/`
- Agent rule books (`arbiter/requirement-gathering/`, `arbiter/fast/`, `arbiter/14agent/`)
- Knowledge docs, engine docs

**Rule — what goes in Git LFS or is gitignored:**
- Intermediate agent outputs: `reframe-output.md`, `research-output.md`, etc.
- Stage summaries and lessons-learned files during active development (committed to
  LFS on task completion)
- The `arbiter/state.db` file (gitignored — rebuilt from events log)

**Rule — squash and merge:**
All Arbiter-generated PRs use squash merge. The 10–20 intermediate commits where
the AI fixed its own linter errors are hidden. Git history shows exactly **one clean
commit per task** with the message from the PR description.

**`.gitattributes` additions:**
```
arbiter/tasks/**/*-output.md filter=lfs diff=lfs merge=lfs -text
arbiter/tasks/**/summaries/*.md filter=lfs diff=lfs merge=lfs -text
```

---

### Mandate 4 — MCP extensibility hooks

To extend Arbiter beyond web development (data analysis, local DBs, report generation,
MCP tool integration), agents must use **Model Context Protocol (MCP) tool-use** rather
than writing boilerplate scripts.

**Current status**: Phase 2 investment — not MVP.

**Design (for future implementation)**:
Each agent's `manifest.yaml` declares allowed MCP servers:
```yaml
agent: data-analyst
mcp_servers:
  - postgres-mcp          # query DB metadata in real-time
  - pandas-mcp            # run data transformations
  - vector-store-mcp      # query project embeddings
```

The agent calls the tool directly. It does not write a Python script to query the DB;
it calls `query_schema("contracts")` and gets the result. Context window is not
polluted with schema dumps.

---

## 33. Context Builder — Enhanced Glob + madge

### Current state

`src/context/ContextAssembler.ts` (186 lines) already uses per-agent file allowlists
with glob patterns. This prevents the worst-case scenario (agents reading the entire
repo) but is not dependency-aware.

### v2 upgrade: madge middleware

Before dispatching any Phase 2 agent, the Conductor runs `madge` to build a precise
dependency graph from the target file(s):

```typescript
// Pseudocode — implemented in src/context/ContextAssembler.ts
async function buildContext(agentRole: AgentRole, targetFiles: string[]) {
  // Step 1: run madge on each target file
  const deps = await runMadge(targetFiles); // returns { file: string[] } dependency map

  // Step 2: merge with role-specific glob allowlist
  const allowedGlobs = AGENT_CONTEXT_MANIFESTS[agentRole];
  const slicedFiles  = intersect(deps.allFiles, expandGlobs(allowedGlobs));

  // Step 3: always include locked contracts
  const contracts = await glob('arbiter/tasks/<task-id>/contracts/**');

  // Step 4: assemble context within token budget
  return assemble([...slicedFiles, ...contracts], TOKEN_BUDGET[agentRole]);
}
```

**How madge works in practice:**
```bash
# Backend agent needs to fix ContractService.ts
madge --json api/src/Modules/Contracts/Application/ContractService.ts
# Returns: { "ContractService.ts": ["IContractRepo.ts", "ContractDto.ts", "ServiceResult.ts"] }
# Context Builder fetches ONLY those 3 files + contracts/ + task.md
```

**Result**: The agent's context contains only what it actually depends on. A
50,000-file codebase is reduced to 5–10 files for a targeted fix. Token usage
drops by 80–95% compared to feeding the agent broad glob patterns.

### Token budgets per agent role

| Agent | Token budget | Rationale |
|---|---|---|
| Triage | 4,000 | Stateless router — needs almost nothing |
| Investigator | 12,000 | Reads bug report + dependency trace only |
| Coder (Tier 1) | 8,000 | Single file fix |
| Frontend | 24,000 | Component + hooks + related files |
| Backend | 24,000 | Service + repo + migration |
| Test Writer | 16,000 | Generated code + contracts |
| Orchestrator (Gate 5) | 32,000 | Full task context for semantic review |

---

## 34. The Orchestrator — Event-Driven Architecture

### The correction from the previous design

The earlier design described a "persistent Opus session throughout Phase 2." This
is incorrect and wasteful. An LLM session cannot truly be kept alive between
agent invocations — it would time out, consume connection limits, and accumulate
context rot.

### The correct design: persistent STATE, event-driven EXECUTION

The Orchestrator's **state** is persisted in SQLite (`orchestrator_state` table).
The Orchestrator's **LLM process** is started and terminated per event.

```
User types in chat tab
        │
        ▼
Conductor reads orchestrator_state from SQLite
(chat_history, current phase, last summary)
        │
        ▼
Conductor starts Orchestrator LLM process
Injects: saved state + new user message + current task context
        │
        ▼
Orchestrator responds (1-3 sentences or more if needed)
        │
        ▼
Conductor saves response to orchestrator_state.chat_history
Conductor terminates Orchestrator LLM process
        │
        ▼
Dashboard updates chat UI from SQLite
```

**To the user**: it feels exactly like a persistent chat. Previous messages are
visible. Context is maintained.

**To the infrastructure**: it is a stateless function call. No idle LLM compute.
No context timeout risk. No connection limit consumption.

### When the Orchestrator is woken

| Trigger | What the Orchestrator does |
|---|---|
| User types in Chat tab | Reads saved state + answers the question |
| Agent completes (Gate 5 reached) | Reads diff + contracts + task.md → semantic review |
| Human gate decision needed | Summarises what the gate is and why it triggered |
| Gate fails twice (task → 07-failed) | Writes failure summary + lessons learned |
| Task completes (PR merged) | Writes final stage summary + lessons learned |
| Custom Orchestrator query from Conductor engine | Answers specific question (e.g. "can the debugger fix this?") |

### Single Orchestrator for both pipelines

The Full pipeline and Fast pipeline use the **same Orchestrator agent** (`arbiter/orchestrator/rules.md`).
The two separate "Coordinator" and "Babysitter" roles from the previous design are merged.

The Orchestrator's `rules.md` has one section for Full pipeline behavior and one for Fast
pipeline behavior. At runtime, the Conductor injects `pipeline: "full"` or `pipeline: "fast"`
into the Orchestrator's context. The rule book handles both cases.

**Why merge them**: the differences between Coordinator and Babysitter were in pipeline-specific
context (which agents run, which gates exist), not in intelligence. Injecting pipeline context
is simpler than maintaining two separate rule books that are 90% identical.

---

## 35. Machine-Enforceable Contracts (Tier 3 only)

### The problem with Markdown plans

Phase 1 currently outputs `design-output.md` with an API contract described in prose.
The Backend agent reads this and tries to "remember" the shape while coding. LLMs
are unreliable at enforcing memory constraints. The compiler is perfect at it.

### What Phase 1 outputs for Tier 3 tasks

After the Design agent runs, Phase 1 produces two categories of output:

**Human-readable (same as before):**
- `design-output.md` — UX flow, decisions, rationale

**Machine-enforceable contracts (new for Tier 3):**
```
arbiter/tasks/FEAT-051/contracts/
├── schema.prisma          ← DB schema as actual Prisma schema (or EF Core model)
├── api.ts                 ← Zod schemas for every request/response shape
└── events.ts              ← TypeScript interfaces for FE-BE events
```

These files are **locked** the moment the human approves Phase 1. Generators cannot
modify them. Gate 1 enforces this.

### Design agent version injection

The Design agent's prompt is injected with the exact dependency versions from the
project's `package.json` / `.csproj`. This prevents the agent from generating code
using features from package versions that are not installed.

```
# Injected into Design agent context (assembled by Conductor before dispatch):
# Package versions in this project:
# zod: 3.22.4
# @prisma/client: 5.14.0
# typescript: 5.4.5
# Use ONLY syntax compatible with these exact versions.
```

**Guardrail**: if the Design agent hallucinates a Zod v4 feature while the project
uses Zod v3.22, Gate 1 (`tsc`) fails instantly. Zero Phase 2 tokens wasted.

### Tier 2 contract enforcement

Tier 2 tasks (fixes) **cannot alter contracts**. The Conductor adds the `contracts/`
folder to the Coder agent's `never:` list in its manifest. Gate 1 verifies no contract
file was touched. If a contract change is required for a fix, the task is automatically
re-classified to Tier 3 and Phase 1 is run.

### Tier 1 contracts

Tier 1 tasks have no contract enforcement. They are so small (typo, CSS tweak) that
contract validation is unnecessary overhead.

---

## 36. Updated build list — v2 additions

These items are ADDED to the build list in Section 27. They represent the v2 delta.

### New infrastructure (do first — these are foundations)

1. **SQLite migration**: Replace `StateStore.ts` (95 lines) with `src/state/SqliteStore.ts` using `better-sqlite3`. WAL mode, strict foreign keys. Implement the 4-table schema (tasks, sub_tasks, events, orchestrator_state).

2. **WorktreeManager**: Refactor `src/git/GitAutoCommit.ts` into `src/git/WorktreeManager.ts`. Implements: `create(taskId)`, `merge(taskId)`, `delete(taskId)`. All agent dispatch goes through this.

3. **Git LFS config**: Add `.gitattributes` rules for intermediate agent output files.

### New agents (write rule books + manifests)

4. **Triage agent**: `arbiter/triage/rules.md` + `manifest.yaml`. Input-constrained. Output: `triage.json` with tier/profile/reason/bypass_phase1.

5. **Investigator agent** (Tier 2): `arbiter/requirement-gathering/investigator/rules.md`. Reads bug report + madge dependency trace. Outputs Fix Strategy doc.

6. **Orchestrator agent**: `arbiter/orchestrator/rules.md`. Merged from Coordinator + Babysitter. Handles both Full and Fast pipelines via injected context.

### Conductor upgrades

7. **Triage dispatch**: Before any Phase 1 agent, run Triage agent. Read `triage.json` and route to correct tier.

8. **Iron Funnel gate sequence**: Replace current linear agent sequence with the 5-gate funnel. Implement: `CompilerAirlockGate`, extend existing `GateRegistry`.

9. **Contract validation before Phase 2**: After Design agent, run `tsc --noEmit` + `prisma validate` on contracts/. Block Phase 2 if fails.

10. **Event-driven Orchestrator dispatch**: On each trigger event, load `orchestrator_state` from SQLite, run Orchestrator, save response, terminate.

11. **madge integration in ContextAssembler**: Add `runMadge(targetFiles)` step before glob expansion. Merge dependency files into context within token budget.

12. **Package version injection for Design agent**: Read `package.json` / `*.csproj` and inject version list into Design agent context.

13. **Tier 2 contract freeze enforcement**: Add `contracts/` to Coder agent's `never:` manifest list for Tier 2 tasks.

14. **Triage tier in task card**: Read `triage.json` and display tier badge on dashboard card.

15. **Webhook-driven CI resume**: Extend `WebhookNotifier.ts` to accept inbound CI webhooks. On receipt: update sub_task status in SQLite, resume conductor from correct gate.

### Dashboard upgrades

16. **Tier badge on task cards**: T1 / T2 / T3 badge alongside pipeline badge.

17. **Gate 1–5 progress within task detail**: Iron Funnel shown as a 5-step progress bar. Each gate shows deterministic (green lock icon) or LLM (blue agent icon).

18. **Critical path flag**: If a task is blocking 3+ other tasks and is stuck at a gate, flag it red with "CRITICAL PATH" label.

19. **Gate timeout escalation**: Configurable: 4h → Telegram reminder. 8h → escalate to tech lead chat ID. Configurable in Settings.

### Competitive Moat Additions (Phase 1.5)

20. **PR Comment Reactions (the AO Killer):** Extend `WebhookNotifier.ts` to listen for
    GitHub/GitLab PR comment webhooks. If a human comments on an open Arbiter-generated PR,
    the Conductor wakes the Orchestrator, feeds it the PR diff + the comment, and dispatches
    the Coder back into the existing Worktree to fix and push a new commit. Zero manual
    intervention required. Closes the loop the current Iron Funnel leaves open.

21. **SubQ Provider Integration (Gate 5 "Nuke" Option):** Add `subq` to `arbiter.config.json`
    as a supported premium provider. When SubQ is selected for Gate 5 (Semantic Review), the
    Conductor bypasses Context Builder token-slicing and feeds SubQ the full repository AST
    plus the PR diff. SubQ's 12M-token context eliminates "Lost in the Middle" degradation,
    enabling holistic architectural-drift and systemic security checks impossible with
    standard models at standard context windows.

22. **ACP (Agent Communication Protocol) Stub:** Create `packages/core/src/acp/` directory
    with interface groundwork (`AgentMessage`, `HandoffPayload`, `AgentCapability` types).
    MVP wiring continues to use file/SQLite comms — these types are not wired to anything yet.
    Purpose: locks the interface shape so external third-party agents can be plugged into the
    Iron Funnel in v3 without a breaking type change.

---

## 37. Locked decisions reference (audit trail)

| # | Decision | Ruling | Guardrail |
|---|---|---|---|
| D1 | Triage location | Upstream standalone, `arbiter/triage/` | Reads ONLY task.md + config. Hard 4k token limit. |
| D2 | Contracts strictness | Hybrid: Strict (Tier 3) / structural check (Tier 2) / none (Tier 1) | Design agent injected with exact package versions |
| D3 | SQLite timing | Now, before any other implementation | `better-sqlite3`, WAL mode, synchronous |
| D4 | Orchestrator | Persistent STATE, event-driven EXECUTION | LLM process terminates after each event; state in SQLite |
| D5 | Context Builder | Enhanced glob + madge for MVP; AST (ts-morph) as Phase 2 ticket | madge traces exact dependencies; token budget enforced |
| D6 | Git Worktrees | Mandatory for all tiers | Developer branch never touched |
| D7 | Iron Funnel | 5-gate sequence; deterministic gates before LLM gates | Gate 1 catches type/lint errors for zero LLM cost |
| D8 | 3-tier routing | Tier 1/2/3 via Triage agent | Tier 2 bound by existing contracts |
| D9 | Test-writer model | Sonnet (Haiku banned — validated failure) | Cannot be overridden without re-running validation suite |
| D10 | Gate timeout | 4h reminder → 8h escalate; critical path = red flag | Configurable per project in arbiter.config.json |
| D11 | CI polling | Push agent opens PR + exits; webhook resumes conductor | WebhookNotifier.ts already exists — extend it |
| D12 | Coordinator/Babysitter | Merged into single Orchestrator | One rule book handles both pipelines via injected context |
| D13 | Database engine | SQLite (`better-sqlite3`) for local engine; PostgreSQL reserved for future Cloud SaaS backend | Local engine bypasses network stack entirely — WAL concurrent reads/writes orders of magnitude faster than TCP-round-trip Postgres. Zero provisioning required for users. |
| D14 | PR feedback loop | "Reactions" model — human PR comments trigger Worktree wake + Coder dispatch automatically | Closes the gap between Iron Funnel PR open and human review response. Prevents manual branch re-checkout. Extends `WebhookNotifier.ts`. |
| D15 | SubQ as Gate 5 provider | Optional premium provider for Semantic Review (Gate 5) — bypasses Context Builder token-slicing | 12M-token context eliminates "Lost in the Middle" degradation; holistic repo-wide drift + security check impossible with standard models. |

---

## 38. Database Engine — SQLite vs PostgreSQL (Architecture Rationale)

### The question

> "Can we use a faster database like PostgreSQL?"

### The ruling: No. SQLite is the correct engine for local Arbiter.

This is not a trade-off — it is an architectural necessity.

**PostgreSQL is NOT faster than SQLite for Arbiter's workload.**
PostgreSQL is a networked, client-server database designed for:
- Distributed systems with thousands of concurrent clients
- Multi-tenant SaaS with strict isolation requirements
- Horizontally scaled deployments across machines

Arbiter (local engine) is **single-node and embedded**. Its concurrency model is:
multiple agents writing to the same local state machine, serially, on one machine.

### Why SQLite wins on this specific workload

| Metric | SQLite (WAL mode) | PostgreSQL (local) |
|---|---|---|
| Read latency | ~0.01ms (direct disk page access) | ~0.5–2ms (TCP round-trip, even local socket) |
| Write latency | ~0.1ms | ~1–5ms (connection overhead + WAL write) |
| Connection setup | Zero (library call) | ~5–15ms per connection |
| Provisioning | Zero (one file) | Requires pg install, init, config, service start |
| Concurrent reads | Non-blocking under WAL | Supported, but network overhead dominates |
| Agent crash recovery | WAL checkpoint on next open | Requires running server to recover |

**`better-sqlite3` is synchronous.** This is the key property that makes it correct for
the Conductor: when 3 agents complete simultaneously, the Conductor processes their
state updates in sequence with zero async race conditions. Async ORMs (Prisma, TypeORM)
introduce event-loop interleaving that corrupts state machines at exactly this moment.

### The exception: Cloud SaaS backend

When Arbiter ships a future web version (multi-tenant, multiple teams, cloud-hosted),
that backend will use **PostgreSQL** (or CockroachDB for geo-distribution). That context
has thousands of concurrent users, network-separated components, and requires horizontal
scaling — the exact scenario Postgres is designed for.

**Rule**: Local Arbiter engine = SQLite. Cloud Arbiter backend = PostgreSQL.
These are not interchangeable — they are different deployment targets with different
concurrency and scaling requirements.

---

## 39. Competitive Analysis — Arbiter vs. the Market

### Arbiter's category

Most competing tools are **Agent Wranglers** — they spawn AI agents and route tasks.
Arbiter is an **Architectural Enforcement Engine** — it enforces code contracts, runs
deterministic gates before LLM gates, and prevents agents from drifting from the
system's invariants.

This is the moat. Wranglers can add more agents. They cannot add Machine-Enforceable
Contracts without fundamentally redesigning their pipeline.

---

### A. Arbiter vs. Composio Agent Orchestrator (AO)

**What AO does well:**
- Spawns parallel agents in Git Worktrees
- "Reactions" model: when CI fails or a human comments on a PR, AO automatically
  routes that feedback back to the correct agent to fix it

**Where Arbiter wins:**
- AO is "dumb" — it throws Claude Code or Codex at an issue with no Phase 1 contracts
- AO agents routinely break architectural invariants because there is no Compiler
  Airlock (Gate 1) guarding the generators
- No Iron Funnel, no test ratchets, no tier routing

**What Arbiter steals (D14 — PR Reactions):**

AO's Reactions model is correct. Arbiter's current Iron Funnel ends when the PR is
opened. It does not handle human reviewer comments on that PR.

**Reaction flow (implemented in Section 36, item 20):**
```
Human leaves PR comment
        │
WebhookNotifier receives GitHub PR comment event
        │
Conductor reads: orchestrator_state + PR diff + comment text
        │
Orchestrator (LLM): "Is this a code change request, a question, or a LGTM?"
        │
  ┌─────┴─────────────────────────────┐
  │ Code change request               │ Question / LGTM
  │                                   │
  ▼                                   ▼
Conductor wakes existing Worktree    Orchestrator posts reply in PR thread
Dispatches Coder with: diff + comment + contracts
Coder fixes + commits
Gate 1 re-runs on the patch
Push new commit to PR branch
```

---

### B. Arbiter vs. Routa

**What Routa does well:**
- Treats Kanban as an execution surface
- ACP (Agent Communication Protocol) + AG-UI: external, third-party agents can plug
  into their workflow as first-class citizens

**Where Arbiter wins:**
- Routa is protocol-heavy but lacks software engineering opinions
- No Prisma/Zod contract enforcement, no test ratchets, no tier-based routing
- "Generic" means it will never tell an agent "you cannot alter the schema — this is
  a Tier 2 task"

**What Arbiter steals (D15 — ACP Readiness):**

Routa's extensibility model is correct. Arbiter should not lock users into Anthropic
models forever. ACP-readiness means:
- External security-scanning agents can hook into Gate 1 as additional checks
- Third-party LLM providers can replace individual agents
- Enterprise users can inject compliance agents between any two Iron Funnel gates

The ACP stub (Section 36, item 22) locks the interface types in Phase 1 so this is
not a breaking refactor in v3.

---

### C. Arbiter vs. SubQ (12M Token Model)

**What SubQ is:**
SubQ is a sub-quadratic LLM purpose-built for 12M-token reasoning contexts. It solves
"Lost in the Middle" — the documented phenomenon where standard LLMs (including Opus)
silently hallucinate when the most important context sits in the middle of a very large
prompt.

**Why they are not competitors:**
SubQ is a model provider. Arbiter is an orchestrator. SubQ is Arbiter's secret weapon,
not a rival.

**Standard Gate 5 flow (default):**
```
madge → slice context to 32k tokens → Opus or Sonnet semantic review
```

**Gate 5 "Nuke" flow (SubQ enabled, premium):**
```
Conductor bypasses Context Builder
Feeds SubQ: full repository AST + PR diff (up to 12M tokens)
SubQ answers: "Does this change introduce systemic security flaws
              or architectural drift across the entire system?"
```

SubQ answers this accurately. Opus at 32k tokens would hallucinate on a 500k-line
codebase because the most relevant invariant is 200k tokens away from the PR diff.

**Configuration in `arbiter.config.json`:**
```json
"providers": {
  "subq": {
    "base_url": "https://api.subq.ai",
    "api_key": "{{SUBQ_API_KEY}}",
    "context_window": 12000000
  }
},
"roles": {
  "orchestrator": {
    "provider": "subq",
    "model": "subq-12m",
    "_role": "Gate 5 Semantic Review. Premium option. Feed full repo AST — no context slicing."
  }
}
```

SubQ is gated behind a config flag. Default behavior remains Opus at 32k tokens.
Power users opt in by setting the provider in `arbiter.config.json`.

---

### Competitive moat summary

| Feature | AO | Routa | SubQ | Arbiter |
|---|---|---|---|---|
| Git Worktrees | ✓ | — | — | ✓ |
| PR Reactions (comment-driven loop) | ✓ | — | — | ✓ (Phase 1.5) |
| Machine-Enforceable Contracts | — | — | — | ✓ |
| Compiler Airlock (Gate 1 — zero LLM cost) | — | — | — | ✓ |
| Iron Funnel (5-gate deterministic + LLM) | — | — | — | ✓ |
| 3-Tier routing (Triage agent) | — | — | — | ✓ |
| ACP extensibility | — | ✓ | — | Stub (Phase 1.5) |
| 12M-token Gate 5 review | — | — | ✓ (as model) | ✓ (as provider option) |
| Test ratchet enforcement | — | — | — | ✓ |
| SQLite embedded state (zero provisioning) | — | — | — | ✓ |
