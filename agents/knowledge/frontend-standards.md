# Frontend standards (engineering KB)

Injected into: `frontend` (and `test-writer` for FE tests).

- **Layering:** Component → Hook → Service → API. Never skip a layer.
- **State:** Zustand, feature-scoped stores (not one global store).
- **Services return `ServiceResult<T>`** — never throw to callers; same shape across
  mock + live. See `web/src/services/api/types.ts`.
- **Data fetching:** AbortController in every data-fetching hook.
- **Limits:** ~150-line component budget; split when larger.
- **Security:** tokens never in `localStorage`; no `dangerouslySetInnerHTML` without
  DOMPurify; attach trace context to support/feedback/error submissions (see workspace CLAUDE.md).
- **Coverage (FE, ratchet-only-up):** {{FE_COVERAGE_FLOORS}} — source of truth
  `web/vitest.config.ts`.

Canonical source: {{WORKSPACE_FE_CLAUDE}} (Package management, vitest config, audit exceptions).
