# {{PROJECT_NAME}} — Automation Pipeline (conductor model)

> **This supersedes the old "3/4-CLI Test-Write-Push" pipeline.** The redesign replaced the
> hand-driven Soltan CLIs with a deterministic **conductor** + **13 single-responsibility
> agents**. Full design + phase history: [`REDESIGN-PLAN.md`](./REDESIGN-PLAN.md). Agent
> specs: [`AGENT-RULEBOOK-PLAN.md`](./AGENT-RULEBOOK-PLAN.md). Baseline: [`CURRENT-STATE-AUDIT.md`](./CURRENT-STATE-AUDIT.md).

## How the factory runs

```
SURVEYOR (scheduled) ─proposes─► exec-plan/00-proposed/ ─┐
YOU ─drop idea─► Jarvis / arbiter new ───────────────────┤ promote / drag → Up-Next
SELF-SPAWN (blast-radius / canary-revert) ───────────────┘
                                                          ▼  .arbiter/queue-order.json
   ┌──────── CONDUCTOR  (factory.sh run — deterministic, ONE task at a time) ────────┐
   │  pops the queue → reads 5-plan.json → prunes skipped steps → spawns each needed agent    │
   │  via scripts/spawn-agent.sh (role → provider+model from factory-config.json):            │
   │                                                                                          │
   │  reframe → question → research → design → integrator → plan   (exec-plan/02-incubating)   │
   │  🛑 SCHEMA GATE (if DB): check-db-isolation + check-security → Jarvis ER diff → approve   │
   │  frontend → 🛑 UI GATE (if ui_first) → backend → test-writer  (exec-plan/03-building)      │
   │      └─ gate fails ×2 → debugger (fresh context)  ·  unrecoverable → 07-failed            │
   │  reviewer → merge-on-green (open PR; auto-merge iff config) → tech-writer (+lessons)      │
   └──────────────────────────────────────────────────────────────────────────────────────┘
      bash-guard blocks destructive cmds · budget-governor pauses near 5h · watchdog restarts
```

## The pieces

| Concern | Where |
|---|---|
| Conductor (the engine) | `factory.sh` (`run` = daemon, `tick` = one task) |
| Agent spawn + scoped context | `scripts/spawn-agent.sh` + `scripts/assemble-context.sh` |
| Model/provider per role | `factory-config.json` (the ONE file to change models) |
| 13 agent rule books | `agents/*.md` (+ `agents/manifests/*.yaml`) |
| Shared directives / KB | `engine/MASTER-DIRECTIVES.md` + `agents/knowledge/` |
| State machine | `exec-plan/` (`00-proposed` → `07-failed`) + `exec-plan/TASK-SCHEMA.md` |
| Human control | `arbiter` (status/new/promote/queue/reorder/approve/reject) + Jarvis |
| Reuse index | `scripts/build-registry.sh` → `.arbiter/registry.json` |
| Mechanical gates | `scripts/check-db-isolation.sh`, `check-security.sh`, `gate*.sh` |
| Vision (eyes) | `scripts/vision-capture.js` → `.arbiter/vision/` |
| Safety / recovery | `scripts/bash-guard.sh`, `budget-governor.sh`, `watchdog.sh`, `engine/RECOVERY-POLICY.md` |
| Ship | `scripts/merge-on-green.sh` (auto-merge gated by `factory-config.json .auto_merge`) |
| Archetypes / sequencing | `engine/TASK-ARCHETYPES.md`, `engine/SEQUENCING-POLICY.md` |

## Operate it

```bash
arbiter new "build the drilling dashboard"              # drop an idea (or use Jarvis)
factory.sh run                                          # start the conductor daemon
arbiter status                                          # state + Up-Next queue
arbiter approve <id> schema                             # clear a gate (or: reject)
FACTORY_MOCK=1 factory.sh tick                          # dry-run the state machine (no model calls)
```

Two human gates only (schema diff + UI for `ui_first`); everything else is autonomous.
Auto-merge is **off by default** — set `auto_merge: true` in `factory-config.json` once proven.

## Legacy (pre-redesign)

The old Soltan model — `SOLTAN-*-RULES.md`, `scripts/start-soltan-*.sh`, the
babysitter-as-coordinator + `/api/launch-agent` Jarvis launch path — is **superseded** by the
conductor and the 13 agents. It still functions today; it will be retired/migrated in Phase 11
(see `REDESIGN-PLAN.md`). The Stop-hook trigger from the original plan is **superseded by the
conductor daemon** (`factory.sh run`) and is intentionally not activated.
