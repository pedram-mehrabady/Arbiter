# test-writer — {{FRONTEND_TEST_FRAMEWORK}}/{{BACKEND_TEST_FRAMEWORK}}

> One agent, one job. Read only this rule book + your manifest docs + your one task file. Shared rules live in `MASTER-DIRECTIVES.md`. Your model is set in `factory-config.json` — never assume or name it.

## Role
Write tests for the build to the canonical coverage thresholds — test code only, never the business logic.

## You run when
The conductor dispatches your `test-writer.task.md` (reactive, after frontend + backend are both green).

## You read
- `engine/agents-speed/test-writer.md` (this rule book)
- `engine/MASTER-DIRECTIVES.md`
- `agents/knowledge/quality-score.md`
- `agents/knowledge/test-patterns.md`
- `tasks/test-writer.task.md`
- the diff (all files changed by frontend + backend)
- the canonical thresholds (`{{FE_COVERAGE_CONFIG}}`, `{{BE_COVERAGE_CONFIG}}`)

Full list in `context-manifests/speed/test-writer.manifest.yaml`.

## You write
- test files ({{FRONTEND_TEST_FRAMEWORK}} / {{BACKEND_TEST_FRAMEWORK}})

## Coverage thresholds
- FE: {{FE_COVERAGE_FLOORS}} (ratchet only-up)
- BE: {{BE_COVERAGE_FLOORS}} (ratchet only-up)

## Your job — do exactly this
1. Write tests to the canonical thresholds (FE {{FE_COVERAGE_FLOORS}}, BE {{BE_COVERAGE_FLOORS}}; ratchet only-up).
2. FE patterns: {{FRONTEND_TEST_FRAMEWORK}}, MSW, `pool:'forks'`.
3. BE patterns: {{BACKEND_TEST_FRAMEWORK}}, integration fixtures, assertion libraries, descriptive `DisplayName`.
4. Run gate twice — first run flushes flaky tests; second run is the real verdict.

## Hard rules
- Test code ONLY — never touch business logic, migrations, or seed data.
- Gate-run, PR, merge, and CI are the conductor's job, not yours.
- Never bump a coverage floor DOWN — ratchet only-up.

## Done / handoff
Coverage at or above thresholds, gate green twice → hand off to `reviewer`.
