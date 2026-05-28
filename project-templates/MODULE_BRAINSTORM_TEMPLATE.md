# Module brainstorm — [MODULE NAME]
# Fill in this template BEFORE writing any code for a new module.
# Required by the pre-implementation workflow. Get sign-off before proceeding.
# Template path: {{MODULE_BRAINSTORM_DOC}}

---

## What this module owns

One paragraph: what data, what operations, what boundary this module is responsible for.
Be specific. "Handles X" is not enough — "owns the Y table, exposes Z endpoints, emits W events."

---

## Survey: does this already exist?

- [ ] Checked sibling apps: `{{SIBLING_APPS}}`
- [ ] Checked existing modules in this repo (see `{{MODULE_ARCHITECTURE_DOC}}`)
- [ ] Checked `exec-plan/02-incubating/` for in-progress work
- [ ] Checked `exec-plan/00-proposed/` for pending proposals

**Findings:**
<!-- Write what you found. "No existing implementation" is a valid answer. -->

---

## DB action decision

Choose exactly one:

- [ ] **Federate** — the data already exists in `{{SIBLING_APPS}}`; call it via HTTP or replicate a read-model. No new tables.
- [ ] **New module** — new schema, new DbContext, no cross-module FKs, follows `{{MODULE_ISOLATION_RULES}}`.
- [ ] **Extend platform-core** — only if this is foundational infrastructure (auth, audit, tenancy). Needs explicit justification.

**Justification:**
<!-- Why this action and not the others? -->

---

## Module isolation checklist

- [ ] Owns its own DB schema (schema-per-module)
- [ ] Has its own DbContext — no shared context with other modules
- [ ] No cross-module foreign keys in the DB
- [ ] Cross-module async work uses `{{ASYNC_PATTERN}}`
- [ ] Sibling app data is accessed via HTTP, not direct DB query

---

## API surface

List the endpoints / events this module exposes. Keep it minimal — add only what the
immediate task requires. More can be added later.

| Method | Path / Event | Auth | Description |
|--------|-------------|------|-------------|
| GET | /api/v1/[module]/... | [Authorize] | ... |

---

## Open questions

<!-- List any unresolved design questions before proceeding. The question agent will expand these. -->

---

## Sign-off

- [ ] Architecture reviewed
- [ ] DB action approved
- [ ] Open questions resolved

**Approved by:** ________________  **Date:** ________________
