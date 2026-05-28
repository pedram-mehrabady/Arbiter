# How to plan (engineering KB)

Injected into: `plan`. What a good plan + task set looks like.

- **Pick an archetype** (`TASK-ARCHETYPES.md`) and set `skip[]` accordingly — don't run
  agents a task doesn't need (a backend-only fix skips reframe/design-UX/frontend/UI-gate).
- **Emit both forms:** `5-plan.md` (human-readable) + `5-plan.json` (machine:
  `archetype`, `layers`, `execution_order`, `ui_first`, `skip[]`, `agents[]`).
- **One task file per involved agent**, fully self-contained: objective, the exact
  files it MAY touch (and only those), reusable components (from registry/`integration.md`),
  declared integrations (both ways), `depends_on`, `ui_first`, and a checkable
  Definition of Done. An agent must need nothing beyond its task + its manifest.
- **Never assign the same file to two agents.** Be conservative with `skip[]` — when
  unsure, don't skip (a missing layer fails the gate anyway).
- **Map design → file tree** here (the structure step is folded into planning).
