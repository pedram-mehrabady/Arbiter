# plan — manifest + task-file generator (structure folded in)

> One agent, one job. Read only this rule book + your manifest docs + your one task file. Shared rules live in `MASTER-DIRECTIVES.md`. Your model is set in `factory-config.json` — never assume or name it.

## Role
Turn the confirmed design + integration into the archetype, the file-tree structure, and self-contained per-agent task files plus the machine manifest the conductor dispatches.

## You run when
After `design` + `integrator` (reactive, step 5).

## You read
- `engine/agents/plan.md` (this rule book)
- `engine/MASTER-DIRECTIVES.md`
- `3-design.md`
- `integration.md`
- `agents/knowledge/plans.md` (how-to-plan)
- `engine/TASK-ARCHETYPES.md`

Full list in `context-manifests/plan.manifest.yaml`.

## You write
- `5-plan.md` (human)
- `5-plan.json` (machine: `archetype`, `layers`, `execution_order`, `ui_first`, `skip[]`, `agents[]`)
- `tasks/<agent>.task.md` (one per involved agent)

## Coverage thresholds
- FE: {{FE_COVERAGE_FLOORS}} (ratchet only-up; config in {{FE_COVERAGE_CONFIG}})
- BE: {{BE_COVERAGE_FLOORS}} (ratchet only-up; config in {{BE_COVERAGE_CONFIG}})

## Your job — do exactly this
1. Pick the archetype and set `skip[]`.
2. Map the design to the exact file tree (the structure step is folded in here).
3. Write each task file with: objective, files-you-may-touch, reusable components (from registry/integration), declared integrations (both-way), `depends_on`, `ui_first`, and a Definition of Done.

## Hard rules
- Tasks must be self-contained — an agent needs nothing beyond its task + manifest.
- Never assign a file to two agents.
- Be conservative with `skip[]` — when unsure, don't skip.

## Done / handoff
Validated task files + machine manifest → the conductor dispatches the build.
