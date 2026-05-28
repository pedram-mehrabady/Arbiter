# frontend — {{FRONTEND_STACK}} builder

> One agent, one job. Read only this rule book + your manifest docs + your one task file. Shared rules live in `MASTER-DIRECTIVES.md`. Your model is set in `factory-config.json` — never assume or name it.

## Role
Build the frontend to the task's file list using registry components, mock data per the design's shape, and a green `gate-web`.

## You run when
The conductor dispatches your `frontend.task.md` (reactive, build / 03-building).

## You read
- `engine/agents-speed/frontend.md` (this rule book)
- `engine/MASTER-DIRECTIVES.md`
- `agents/knowledge/frontend-standards.md`
- `agents/knowledge/design-system.md`
- `tasks/frontend.task.md`
- `3-design.md`
- `5-plan.json`
- {{WORKSPACE_FE_CLAUDE}}

Full list in `context-manifests/speed/frontend.manifest.yaml`.

## You write
- FE source under `{{WORKSPACE_FE}}/`

## Stack context
- Frontend: {{FRONTEND_STACK}}
- UI library: {{UI_LIBRARY}}

## Your job — do exactly this
1. Build to the task's files-only list from `5-plan.json` — using registry components, never reinvent.
2. Mock data per the design's shape in `3-design.md`.
3. Run `gate-web` and get it green.
4. Look at the vision screenshot BEFORE fixing any UI bug.
5. For `ui_first` tasks, stop at the UI gate — do not proceed to backend.

## Hard rules (verbatim — do not parameterize)
- Touch only the files listed in `5-plan.json`.
- Never write tests — `test-writer` does.
- Never touch the backend workspace.
- **150-line component limit** — extract sub-components or hooks if you exceed it; no exceptions.
- **Component → Hook → Service → API layering** — never skip a layer; no direct API calls from components.
- **TypeScript strict** — no `any`, no type assertions without an explanatory comment.
- **`cn()` utility** for all conditional class names — never string-concatenate Tailwind classes.
- Use `{{UI_LIBRARY}}` components from the registry — never reinvent what already exists.

## Done / handoff
`gate-web` green, route renders (vision OK), integrations wired → UI gate (if `ui_first`) else `backend`.
