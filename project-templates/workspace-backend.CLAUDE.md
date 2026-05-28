# {{PROJECT_NAME}} — {{WORKSPACE_BE}} Workspace Guide

## On startup
Read before doing anything:
1. `agents/templates/backend.md` — your rule book
2. `engine/CLI-LESSONS-LEARNED.md` § "backend" — past mistakes; do not repeat them

---

## Stack
{{BACKEND_STACK}} — see `project-context.md`
Database: {{DATABASE}}
Test framework: {{BACKEND_TEST_FRAMEWORK}}

---

## CQRS rule (hard rule)
Separate the write path from the read path:

- **Writes** go through the write ORM — migrations, entity saves, transactions.
- **Reads** go through the read layer — raw/parameterized SQL or a query micro-ORM.
- Never use the write ORM for reads in production paths — it adds unnecessary change-tracking overhead.
- Read and write contexts are separate classes; they are never used interchangeably.

---

## Migration tripod (hard rule)
Every schema change requires exactly three artefacts committed together:

1. **Migration file** — up + down
2. **Updated entity / model**
3. **Updated seed or test factory** that exercises the new schema

Never ship a migration without all three. A migration without the tripod breaks the test suite.

---

## Error handling rule (hard rule)
Pattern: `{{ERROR_HANDLING_PATTERN}}` — see `project-context.md`

- Services **never throw** to callers. Return a typed result object (success / typed error).
- Only infrastructure code (DB drivers, HTTP clients) may throw; catch at the service boundary.
- Callers check the result type before accessing data. No unchecked result access.

---

## Module isolation rules (hard rules — Phase 2+)
{{MODULE_ISOLATION_RULES}} — see `project-context.md`

<!--
  FILL IN: Add BE-specific isolation rules here.
  Example:
    - Each module owns its own schema in the database (schema-per-module).
    - Each module has its own DbContext — no shared AppDbContext for business tables.
    - No cross-module foreign keys in the DB. Use plain ID columns; validate in application code.
    - No cross-module transactions — use {{ASYNC_PATTERN}}.
    - Platform-core modules (users, auth, audit) are the documented exception.
-->

---

## Module layout

<!--
  FILL IN: Describe your standard module folder/project layout.
  Example (4-project layout per module):
    ModuleName.Domain/          ← entities, value objects, domain events
    ModuleName.Application/     ← use cases, interfaces, DTOs
    ModuleName.Infrastructure/  ← DB context, repos, external HTTP, storage
    ModuleName.Api/             ← controllers, validators, endpoint registration

  List the modules that currently exist in this project:
    - <ModuleName> — owns: <what it owns>
    Add more rows as the project grows.
-->

---

## Document / file storage pattern

<!--
  FILL IN: Does your project have a canonical file/document storage module?
  Describe the module name, storage backend, rules, and cross-module contract.
  Example:
    - All uploaded files go through the Storage module — no other module may add its
      own documents table.
    - Cross-module references use a plain storage_folder_id column — no FK constraint.
    - Downloads use short-lived presigned URLs (TTL ≤ 5 min) returned by the Storage API.
    - The BE never streams binaries directly; uploads go multipart/form-data for validation.
  Leave this section blank if not applicable.
-->

---

## Auth / identity pattern

<!--
  FILL IN: Describe your authentication and authorization setup.
  Example:
    - Auth: {{BACKEND_STACK}} auth (JWT bearer / session-based / external IdP)
    - All endpoints default to [Authorize]. Anonymous access needs explicit PR justification.
    - Session idle timeout: checked via middleware placed after authentication middleware.
    - IDOR protection: ownership check on every {id} route parameter.
-->

---

## Static analysis / linting

<!--
  FILL IN: Describe your static analysis and secret-scanning enforcement.
  Example:
    - Roslyn analyzers as warnings (errors in CI) for security rules (CA5350, CA5351).
    - gitleaks pre-commit hook for secrets scanning.
    - Until analyzers run as errors, these are reviewer-checklist items.
-->

---

## Dev secrets layout

<!--
  FILL IN: Describe your local dev secrets layout.
  Example:
    - secrets-dev/ — gitignored; contains signing cert + .env.local
    - Run scripts/install-deps.sh to generate dev certs on first setup.
    - Full docs: project-templates/ENVIRONMENT.md
-->

---

## PII / logging rules

<!--
  FILL IN: Describe how PII is handled in logs.
  Example:
    - Never log raw email, phone, password, national ID, or card number fields.
    - Use a PiiScrubber / log enricher that masks a known field-name list automatically.
    - The masked field list lives at: <path>
-->

---

## Testing
Framework: {{BACKEND_TEST_FRAMEWORK}}
Coverage floors: {{BE_COVERAGE_FLOORS}} — source of truth: `{{BE_COVERAGE_CONFIG}}`

### Rules
- Integration tests hit a real database — no mock DB. Mock/prod divergence causes silent failures.
- One test class per feature/endpoint group; one test method per scenario.
- Naming: `Method_GivenState_ReturnsOutcome`
- Every module that registers a DB-driver-backed read path also provides a test-factory stub.

### Coverage exclusions
Add an exclusion in `{{BE_COVERAGE_CONFIG}}` in the **same commit** that introduces the
untested surface. Tag it with a `// TODO: backfill tests — <ticket>` comment. Never lower
a floor — add an exclusion instead.

---

## Security rules (hard rules — all PRs)
- **No IDOR.** Every `{id}` route parameter verifies the caller owns the resource.
- **No banned crypto.** No MD5, SHA-1, 3DES, RC4, DES, or ECB mode.
- **No hardcoded secrets.** All keys, certs, and credentials come from config — never source code.
- **Endpoints default to authenticated.** Anonymous access needs explicit justification in the PR.
- **Generic auth-failure messages.** Never reveal whether a username exists on login failure.
- These are merge-blockers enforced by the reviewer agent.

---

## Never do
- Never use the write ORM for production read paths
- Never ship a migration without the tripod (migration + entity update + seed/factory update)
- Never add a cross-module foreign key in the database
- Never store secrets in source code or in committed config files
- Never lower a coverage threshold — add an exclusion instead
- Never log raw PII fields

---

## Reference table

| Topic | Location |
|-------|----------|
| Agent rule book | `agents/templates/backend.md` |
| Module architecture | `{{MODULE_ARCHITECTURE_DOC}}` |
| Module brainstorm template | `{{MODULE_BRAINSTORM_DOC}}` |
| Phase plans | `exec-plan/` |
| Environment / ports | `project-templates/ENVIRONMENT.md` |
