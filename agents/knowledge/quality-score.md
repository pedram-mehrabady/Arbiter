# Quality score (engineering KB)

Injected into: `reviewer`, `test-writer`. The rubric a change is graded against.

A change is "green" only if ALL hold:
- **Correctness** — does what the task's Definition of Done says; matches the design/contract.
- **Tests at threshold** — FE {{FE_COVERAGE_FLOORS}}, BE {{BE_COVERAGE_FLOORS}} (ratchet-only-up);
  tests are real (no asserting-nothing, no disabled tests to pass).
- **No reinvention** — uses registry components; `reviewer` hard-rejects a diff that
  duplicates an existing registry component.
- **Integrations wired both ways** — new→existing AND existing→new per `integration.md`.
- **Security clean** — `check-security.sh` + `check-db-isolation.sh` pass; no IDOR,
  no localStorage tokens, approved crypto, module isolation intact.
- **In scope** — touches only the files the task allowed; no drive-by refactors.

A single critical finding blocks "green" and sends the task back to the coder/`debugger`.
