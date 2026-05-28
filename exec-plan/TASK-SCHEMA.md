# exec-plan — task & manifest schema

This folder is the factory's **state machine**. Every work item lives as a folder that
moves through the states below; the cognitive artifacts accumulate inside it. Validated
by `scripts/validate-task.sh`.

## States (a task folder moves left → right)

```
00-proposed/   surveyor's proposals (triage; human promotes)
01-inbox/      raw idea dropped here (by you, or a promoted proposal)
02-incubating/<task-id>/   planning runs here (reframe → … → plan)
03-building/               coders run (frontend, then backend after the gate)
04-human-gate/             🛑 paused for your visual / schema approval
05-review/                 reviewer + PR open + auto-merge-on-green
06-completed/              merged (archive)
07-failed/                 quarantined (needs human)
```

## A task folder (in `02-incubating/<task-id>/`)

```
<task-id>/
├── spec.md            the original idea/PRD
├── 0-reframe.md       (reframe)
├── 1-questions.md     (question)
├── 2-research.md      (research)
├── 3-design.md        (design)  + generated/db-schema/<task>.mmd + api-contracts/<task>.json
├── integration.md     (integrator)
├── 5-plan.md          (plan — human-readable)
├── 5-plan.json        (plan — machine manifest; see below)
└── tasks/
    ├── frontend.task.md
    ├── backend.task.md
    └── …               one per agent the plan assigns
```

## Per-agent task file — required frontmatter

```yaml
---
task_id: FEAT-051            # matches the folder
agent: frontend             # one of the 13 agent names
parent: exec-plan/02-incubating/FEAT-051
depends_on: []              # other agent task names that must finish first
manifest: agents/manifests/frontend.manifest.yaml
provider: claude_max_cli    # informational; real value resolved from factory-config.json
ui_first: true              # if true, ends at the UI gate
---
```

Body (markdown sections, all required):
- `## Objective` — one paragraph; what "done" looks like.
- `## Files you MAY touch (ONLY these)` — explicit allowlist.
- `## Reusable components you MUST use` — from `.arbiter/registry.json` / `integration.md`.
- `## Declared integrations to wire (both ways)` — from `integration.md`.
- `## Definition of done` — checkable items (gate passes, route renders, integrations wired, no out-of-scope files).
- `## On completion` — write `.arbiter/comms/<agent>.json`.

## `5-plan.json` — machine manifest (the conductor reads this)

```json
{
  "task_id": "FEAT-051",
  "archetype": "feature",                       // see engine/TASK-ARCHETYPES.md
  "layers": ["frontend", "backend"],
  "execution_order": "sequential",
  "ui_first": true,
  "skip": ["reframe"],                           // steps the conductor bypasses
  "agents": ["question","research","design","integrator","plan","frontend","backend","test-writer","reviewer","tech-writer"]
}
```

Required keys: `task_id`, `archetype`, `layers`, `ui_first`, `skip`, `agents`.
The conductor runs only the agents in `agents` minus `skip`, honoring `depends_on` in each task file.
