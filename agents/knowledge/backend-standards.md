# Backend standards (engineering KB)

Injected into: `backend` (and `test-writer` for BE tests).

- **Stack:** {{BACKEND_STACK}}; multi-tenancy via `X-Tenant-Id`.
- **Module isolation:** schema-per-module, DbContext-per-module, **no new tables in
  `AppDbContext`**, **no cross-module FKs** (IDs are plain columns, validate in code),
  no cross-module transactions (outbox + domain events). Enforced by
  `scripts/check-db-isolation.sh` (Phase 4).
- **Contract:** services return {{ERROR_HANDLING_PATTERN}}, never throw to callers (matches FE).
- **CQRS-strict (Phase 2+):** Dapper reads + EF writes; separate Read/Write DbContext.
- **EF migrations — the tripod:** `*.cs` + `*.Designer.cs` + snapshot update, every time.
- **Coverage (BE, ratchet-only-up):** {{BE_COVERAGE_FLOORS}} — source of truth
  `api/Directory.Build.props`.

Canonical sources: {{WORKSPACE_BE_CLAUDE}}, `{{WORKSPACE_BE}}/`, `MODULE_ARCHITECTURE.md`.
