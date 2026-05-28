# Task archetypes — skip-profile presets

The `plan` agent classifies every task into one archetype and emits the matching
`5-plan.json` `skip[]`, so non-greenfield work doesn't pay for agents it doesn't need.
The conductor prunes the skipped steps.

| Archetype | Agents that RUN | Skips | Human gate | Typical entry |
|---|---|---|---|---|
| **feature** (greenfield) | reframe→question→research→design→integrator→plan→frontend→backend→test-writer→reviewer→tech-writer | — | schema (if DB) + UI (if `ui_first`) | you |
| **backend-fix** | question(light)→[design if schema]→plan→backend→test-writer→reviewer→tech-writer | reframe, research(light), design-UX, frontend, ui_gate | schema only if DB | you / surveyor |
| **test-backfill** | plan(thin)→test-writer→reviewer→tech-writer | reframe, question, research, design, integrator, frontend, backend, ui_gate | none | surveyor (safe-class auto) |
| **db-migration** | design(schema)→plan→backend(migration tripod)→test-writer→reviewer→tech-writer | reframe, frontend, ui_gate | **schema** | you / surveyor |
| **refactor** | plan(thin)→(frontend/backend)→test-writer(regression)→reviewer→tech-writer | reframe, question, research, design, integrator | none unless DB/UI touched | surveyor / you |
| **docs** | tech-writer→reviewer(light) | everything else | none | surveyor (safe-class) |

Notes:
- `5-plan.json` carries `archetype`, `layers`, `execution_order`, `ui_first`,
  `skip[]`, `agents[]`.
- Be conservative: when unsure whether a step is needed, **don't** skip it — a missing
  layer fails the gate anyway, which is cheaper than shipping a gap.
- `integrator` always runs for `feature`/`db-migration` (anything that adds a surface);
  it may be skipped for pure `test-backfill`/`docs`.
