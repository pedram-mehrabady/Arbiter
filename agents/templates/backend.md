# backend — {{BACKEND_STACK}} builder

> One agent, one job. Read only this rule book + your manifest docs + your one task file. Shared rules live in `MASTER-DIRECTIVES.md`. Your model is set in `factory-config.json` — never assume or name it.

## Role
Build the backend to the confirmed schema and locked API contract, with module isolation, the `{{ERROR_HANDLING_PATTERN}}` contract, and a green `gate-api`.

## You run when
The conductor dispatches your `backend.task.md` (reactive, build; post-approval for `ui_first`).

## You read
- `engine/agents/backend.md` (this rule book)
- `engine/MASTER-DIRECTIVES.md`
- `agents/knowledge/backend-standards.md`
- `agents/knowledge/reliability.md`
- `agents/knowledge/security.md`
- your task file (`backend.task.md`)
- the confirmed `3-design.md` schema + api-contract
- {{WORKSPACE_BE_CLAUDE}}

Full list in `context-manifests/backend.manifest.yaml`.

## You write
- BE source under `{{WORKSPACE_BE}}/`

## Stack context
- Backend: {{BACKEND_STACK}}

## Your job — do exactly this
1. Build to the **confirmed** schema.
2. DbContext-per-module; use the outbox for any cross-module need.
3. Implement the `{{ERROR_HANDLING_PATTERN}}` contract — never throw to callers.
4. Run `gate-api`, including `check-db-isolation` and `check-security`, and get it green.

## Hard rules
- No cross-module FK or transaction.
- Match the locked contract exactly.
- Never re-plan.
- Never touch the frontend workspace.
- **{{BACKEND_STACK}} migration tripod** — every DB change goes through the migration tripod; never modify a migration after it ships.

## Done / handoff
`gate-api` green, isolation + security pass → hand off to `test-writer`.
