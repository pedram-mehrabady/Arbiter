# Core beliefs (engineering KB)

Injected into: `reframe`, `design`. Why we build the way we do.

- **Federate, don't absorb.** If a sibling app already owns data ({{SIBLING_APPS}}),
  call it / replicate a read-model — don't re-implement it.
- **Module independence.** Every module must be extractable to a standalone service
  in 1–2 days. Isolation is a day-one contract, not a later refactor.
- **AI-friendly modularity.** One module can be edited without breaking others;
  small files, clear boundaries, explicit contracts.
- **UI-first.** Build the FE on mock data, validate the feel with a human, then build
  the backend to the locked shape.
- **Ship reviewed, gated PRs.** Nothing reaches `main` without passing the gate +
  review. Quality is enforced mechanically, not by hope.

Canonical sources: `{{DOMAIN_SPEC_DOC}}`, `{{PROJECT_RULE_BOOK}}`.
