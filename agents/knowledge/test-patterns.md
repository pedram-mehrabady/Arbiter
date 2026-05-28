# Test patterns (engineering KB)

Injected into: `test-writer` (FE and BE tests).

## Test-stub split

When a module uses a read-path backed by a real DB driver (e.g. a micro-ORM query),
integration tests need an in-memory or EF-backed stub for that read path — not the
real driver — or tests will fail with a missing connection.

- **Rule:** Every module that registers a read-path query object backed by a real DB
  driver MUST also provide a test-only EF-backed stub registered in the test factory.
- **Pattern:** Mirror the SQL query using the write DbContext. Add the stub in the same
  PR as the business logic, or the integration tests will fail.
- **Applies to:** All modules that use a DB-driver-backed read path (e.g. Dapper queries,
  raw SQL, custom adapters).

## Frontend ({{FRONTEND_TEST_FRAMEWORK}}) test structure

```
describe('ComponentName', () => {
  it('renders the happy path', () => { ... })
  it('handles empty state', () => { ... })
  it('calls the handler on user action', () => { ... })
})
```

- Test files live next to the component: `ComponentName.test.tsx`
- Mock only at the service boundary — never mock hooks directly
- One `describe` per component/hook; one `it` per behaviour
- Prefer `userEvent` over `fireEvent` for interactions

## Backend ({{BACKEND_TEST_FRAMEWORK}}) test structure

- Integration tests use a shared test factory (`{{PROJECT_NAME}}ApiFactory` or equivalent)
  that replaces real infrastructure (SMTP, storage, cache) with safe test doubles
- Unit tests are for pure logic only (validators, mappers, domain calculations)
- Test class naming: `{Feature}Tests` — one test class per feature/endpoint group
- Test method naming: `{Method}_Given{State}_Returns{Outcome}`

## DisplayName conventions

# CUSTOMIZE: add your own test DisplayName conventions here
# Example: Persian DisplayName for localized test output, custom attribute names, etc.

## Coverage gates

FE floors ({{FRONTEND_TEST_FRAMEWORK}}): `{{FE_COVERAGE_FLOORS}}`
BE floors ({{BACKEND_TEST_FRAMEWORK}}): `{{BE_COVERAGE_FLOORS}}`

Never lower a coverage threshold. If a new class cannot be tested in this phase,
add a ratchet exclusion in the same PR that ships the class — never let untested
code land without either tests or an explicit exclusion comment.
