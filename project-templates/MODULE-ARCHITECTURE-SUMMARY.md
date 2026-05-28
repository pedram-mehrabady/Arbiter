# Module architecture summary — {{PROJECT_NAME}}
# FILL IN: This is the compact module-map reference loaded by the question and research agents.
# Keep it under 60 lines. Deep rules and diagrams go in {{MODULE_ARCHITECTURE_DOC}}.
# Agents read this to answer "does X already exist?" and "where should Y live?" without
# hallucinating new modules.

---

## Approved modules

Fill in one row per module. Agents use this table as the authoritative module inventory.

| Module | Owns | Cross-module rule |
|--------|------|-------------------|
| *(example)* Auth | User identity, sessions, tokens | All other modules call Auth via HTTP or shared interface — no direct DB access |
| *(example)* Notifications | Email, SMS, push delivery | Other modules enqueue via the Notifications API — never send directly |
| <!-- ADD YOUR MODULES HERE --> | | |

---

## Platform-core exception

<!--
  FILL IN: List any foundational modules that are allowed to be internally coupled
  (e.g. users, audit, tenancy) and explain WHY they are exempt from the isolation rules.
  Example:
    - Users, Companies, Memberships — predates the isolation rule; intra-coupled by design.
      Every other module treats these as read-only via query interfaces.
-->

---

## Isolation rules (summary)

{{MODULE_ISOLATION_RULES}}

Full rules and diagrams: `{{MODULE_ARCHITECTURE_DOC}}`

---

## Already-answered architecture facts

<!--
  FILL IN: List common architecture questions whose answers are FIXED — agents must not
  re-propose alternatives. Question agents use this to mark questions as "already answered."
  Example:
    Q: Where do uploaded files go?
    A: Always through the Storage module via the <FileUpload> component. See {{DMS_SPEC_DOC}}.

    Q: How are cross-module async events handled?
    A: {{ASYNC_PATTERN}} — no synchronous cross-module calls for write operations.

    Q: What is the auth mechanism?
    A: {{BACKEND_STACK}} auth. All endpoints default to authenticated.
-->
