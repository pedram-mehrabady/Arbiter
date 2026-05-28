# Reliability (engineering KB)

Injected into: `backend`.

- **Never throw to callers** — return {{ERROR_HANDLING_PATTERN}} with a typed error.
- **Cross-module side effects go through {{ASYNC_PATTERN}}** (no cross-module
  transaction). Producers write the outbox row in the same transaction as the state
  change; a dispatcher delivers it.
- **Idempotency:** handlers must tolerate re-delivery (dedupe by event id). The factory
  may retry a step (see `RECOVERY-POLICY.md`), so writes must be safe to re-run.
- **Graceful degradation:** a failing dependency degrades a feature, it does not crash
  the request path.
- **No silent no-ops:** a {{BACKEND_STACK}} migration without its `.Designer.cs` partial
  silently no-ops on Postgres — always ship the tripod.

Canonical sources: `{{WORKSPACE_BE}}/` (lifecycle machine, approval engine, CQRS).
