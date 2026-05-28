# {{PROJECT_NAME}} — {{WORKSPACE_FE}} Workspace Guide

## On startup
Read before doing anything:
1. `agents/templates/frontend.md` — your rule book
2. `engine/CLI-LESSONS-LEARNED.md` § "frontend" — past mistakes; do not repeat them

---

## Stack
{{FRONTEND_STACK}} — see `project-context.md`
UI library: {{UI_LIBRARY}}
Test framework: {{FRONTEND_TEST_FRAMEWORK}}

---

## Layering rule (hard rule)
Component → Hook → Service → API. Never skip a layer.

- **Components** call hooks only. No direct service or API calls from a component.
- **Hooks** call services. No API calls from a hook.
- **Services** call the API layer. They return typed results; they never throw.
- **API layer** (axios / fetch wrappers) — one file per domain. No business logic here.

---

## Component rules (hard rules)
- **150-line limit.** If a component exceeds 150 lines, extract sub-components or a hook.
- **TypeScript strict.** No `any`. No type assertions (`as T`) without an inline comment explaining why.
- **Conditional classes.** Use `cn()` for all conditional class lists. Never string-concatenate class names.
- **AbortController.** Every data-fetching hook must accept and honour an `AbortSignal`.
- **No direct API calls from components.** All data fetching goes through a hook.

---

## State management
{{STATE_MANAGEMENT_APPROACH}} — see `project-context.md`

<!--
  FILL IN: Add your state management rules here.
  Example (Zustand feature-scoped stores):
    - One store per feature module; no single global store.
    - Stores live at src/features/<module>/store.ts.
    - Cross-module state is passed via props or context, never a shared store.
  Example (Redux Toolkit):
    - One slice per feature.
    - No thunks in components; use RTK Query for server state.
-->

---

## Module architecture rules
{{MODULE_ISOLATION_RULES}} — see `project-context.md`

<!--
  FILL IN: Add your FE-specific module isolation rules here.
  Example:
    - Each module lives at src/features/<module>/.
    - No cross-module imports except from src/shared/ and src/lib/.
    - A module never imports from another module's internal files.
    - Shared UI components live in src/components/ and are never module-owned.
-->

---

## Document / file storage pattern
<!--
  FILL IN: Does your project have a canonical document or file storage pattern?
  Describe the module name, canonical component, API contract, and hard rules.
  Example:
    - All uploads go through the Storage module via <FileUpload folderId />.
    - Never call the storage API directly from a feature component.
    - Downloads use short-lived presigned URLs returned by the API.
  Leave this section blank if your project has no document storage.
-->

---

## Auth / session pattern
<!--
  FILL IN: Describe your authentication and session handling.
  Example:
    - Auth state lives in useAuthStore (feature-scoped Zustand store).
    - Protected routes wrap with <AuthGuard> — never check isAuthenticated inline in a page.
    - Tokens live in httpOnly cookies only. Never in localStorage or sessionStorage.
    - On 401: redirect to /login with returnUrl query param to restore navigation after login.
-->

---

## App shell / authenticated layout
<!--
  FILL IN: Describe your authenticated layout structure.
  Example:
    - All authenticated pages render through <AppLayout> at src/features/shell/.
    - <AppLayout> renders TopNav + sidebar + content area.
    - Never render TopNav conditionally per route — it is always identical.
    - Set the breadcrumb from a page via useBreadcrumb([...]).
    - Do not gate TopNav elements per role — use per-page guards instead.
-->

---

## Support & error reporting
<!--
  FILL IN: Describe your support payload or error reporting pattern.
  Example:
    - Every support/feedback submission attaches a trace context object
      (route, appVersion, viewport, UA) via useTraceContext() from @/lib/trace-context.
    - This is a merge-blocker: no support payload may ship without trace context.
  Leave this section blank if not applicable.
-->

---

## Locale / date handling
<!--
  FILL IN: Describe your locale and date conventions.
  Example:
    - All date display uses formatDate(isoString, locale) from @/lib/date. Never call new Date()
      directly in a component.
    - Calendar locale: {{LOCALE}}
    - Holiday data: src/data/holidays/{{LOCALE}}.ts — update annually.
-->

---

## Feature gating / subscription rules
<!--
  FILL IN: If your project has feature flags or subscription-based access gating,
  describe the canonical component/hook and the rules.
  Example:
    - Use <FeatureGate feature="analytics"> — never check plan tier inline in a page.
    - Gating logic lives in useFeatureGate(feature) only.
  Leave this section blank if not applicable.
-->

---

## Sibling apps
{{SIBLING_APPS}} — see `project-context.md`

<!--
  FILL IN: If your project shares components or a design system with sibling apps,
  describe the sharing rules here.
  Example:
    - All sibling apps consume the shared UI library from @org/ui.
    - Never fork a shared component — extend it via props or composition.
  Leave this section blank if no sibling apps.
-->

---

## Testing
Framework: {{FRONTEND_TEST_FRAMEWORK}}
Coverage floors: {{FE_COVERAGE_FLOORS}} — source of truth: `{{FE_COVERAGE_CONFIG}}`

### Rules
- Test files live next to the component: `ComponentName.test.tsx`
- One `describe` per component/hook; one `it` per behaviour
- Mock only at the service boundary — never mock hooks directly
- Prefer `userEvent` over `fireEvent` for user interactions
- Test behaviour, not implementation

### Coverage exclusions
When a surface ships without tests (e.g. FE-first before BE tests), add an exclusion in
`{{FE_COVERAGE_CONFIG}}` in the **same commit**. Tag it with a `// TODO: tests — <ticket>`
comment so it does not become permanent. Never lower a floor — add an exclusion instead.

---

## Security rules (hard rules — all PRs)
- **No `dangerouslySetInnerHTML`** without wrapping in `DOMPurify.sanitize(...)`.
- **No tokens in `localStorage` or `sessionStorage`.** Auth tokens go in httpOnly cookies only.
- **No unvalidated user URLs** in `href` / `src` / `action` — accept `https:` only.
- **No dynamic `eval()`** or `new Function(...)`.
- These are merge-blockers enforced by the reviewer agent.

---

## UI-first workflow rule (hard rule)
Build the frontend first. Run the dev server. Visually verify the feature works in the
browser. Only after visual approval (the UI gate) does the backend agent proceed.

---

## Never do
- Never call the API layer directly from a component — always through a hook
- Never use `any` without a comment explaining why
- Never lower a coverage threshold — add an exclusion instead
- Never store auth tokens in localStorage or sessionStorage
- Never import from another module's internal files — only from `src/shared/` or `src/lib/`
- Never put business logic in a component — extract to a hook or service

---

## Reference table

| Topic | Location |
|-------|----------|
| Agent rule book | `agents/templates/frontend.md` |
| Module architecture | `{{MODULE_ARCHITECTURE_DOC}}` |
| Module brainstorm | `{{MODULE_BRAINSTORM_DOC}}` |
| Phase plans | `exec-plan/` |
| Environment / ports | `project-templates/ENVIRONMENT.md` |
