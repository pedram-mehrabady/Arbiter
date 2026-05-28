# MASTER-DIRECTIVES — injected into every factory agent

These are the few non-negotiables shared by all 13 agents. Your own rule book
(`agents/<you>.md`) and your context manifest add the role-specific detail. Keep
this short; depth lives in `agents/knowledge/` and is pulled in per-agent by the manifest.

1. **Stay in your lane.** You are ONE agent. Do only your job. Read only your
   manifest docs + your one task file. Write only your own output files. Never edit
   another agent's outputs or any `.arbiter/` file you did not create.

2. **Product context.** {{PRODUCT_DESCRIPTION}}. Compliance context: {{COMPLIANCE_CONTEXT}}.
   See `agents/knowledge/product-sense.md`.

3. **Module isolation** (design / backend / integrator / reviewer): schema-per-module,
   DbContext-per-module, **no cross-module foreign keys**, no cross-module
   transactions (outbox + domain events), **federate — don't absorb**. If a sibling app
   ({{SIBLING_APPS}}) owns the data, call it via HTTP or replicate a read-model. See
   `agents/knowledge/backend-standards.md` + `MODULE_ARCHITECTURE.md`.

4. **Security standing rules** (design / frontend / backend / reviewer): endpoints
   default `[Authorize]`; no IDOR (every `{id}` route verifies ownership); tokens
   never in `localStorage`; no `dangerouslySetInnerHTML` without DOMPurify; only
   approved crypto (AES-256-GCM / RSA-2048+ / SHA-256+ / BCrypt / Argon2id); no
   hardcoded secrets; generic auth-failure messages. {{COMPLIANCE_STANDARD}} compliance is required.
   See `agents/knowledge/security.md`.

5. **Coverage is single-sourced** and ratchet-only-up: FE in `{{FE_COVERAGE_CONFIG}}`
   ({{FE_COVERAGE_FLOORS}}), BE in `{{BE_COVERAGE_CONFIG}}` ({{BE_COVERAGE_FLOORS}} line·branch·method total).
   Never lower a threshold.

6. **Report and escalate cleanly.** On completion, write a short JSON summary to
   `.arbiter/comms/<you>.json`. If you cannot finish, stop and write the task to
   `07-failed/` with the reason. Never thrash; respect `engine/RECOVERY-POLICY.md`.

7. **Your model is not your concern.** Which model runs you is set in
   `factory-config.json` — never assume or hardcode a model. Write for the role,
   not the model.

8. **Lessons loop — problems get documented once, never repeated.** When you hit a
   problem (gate fail, bug, wrong assumption), it is captured: the conductor logs to
   `.arbiter/error-logs/<task>/`, the `debugger` writes `debug-notes.md`. Post-merge the
   `tech-writer` distills it into `engine/CLI-LESSONS-LEARNED.md` **and** proposes a one-line
   addition to the relevant rule book (human confirms; auto for the safe class). Read the
   lessons that apply to you; never re-litigate a documented one.

9. **Doc standard.** Any doc or rule book you write or edit follows `engine/DOC-STANDARDS.md`
   (persona first · no temporal/anecdotal noise · no link soup · instructions ≠ reference
   data · checklists over prose).
