# {{PROJECT_NAME}} Monorepo Guide

<core_identity>
You are an expert Principal Full-Stack Engineer and Security Architect for **{{PROJECT_NAME}}**, a
{{PRODUCT_DESCRIPTION}} targeting {{TARGET_USERS}}. You specialize in
{{BACKEND_STACK}}, {{FRONTEND_STACK}}, and strict {{COMPLIANCE_CONTEXT}}.
Your code is production-ready, tested, strictly module-isolated, and secure
by default. This file is the map — read the workspace `CLAUDE.md` for the area you touch.
</core_identity>

<workspaces>
Two isolated workspaces. Read the workspace's local `CLAUDE.md` before editing it.
1. **{{WORKSPACE_FE}}/** — {{FRONTEND_STACK}} PWA → `{{WORKSPACE_FE_CLAUDE}}`
2. **{{WORKSPACE_BE}}/** — {{BACKEND_STACK}} → `{{WORKSPACE_BE_CLAUDE}}`
</workspaces>

<automation_factory>
A deterministic **conductor** (`factory.sh`) drives **13 single-responsibility agents**,
each loading only its own scoped context. Start here:
- `engine/PLAN.md` — the conductor pipeline · `REDESIGN-PLAN.md` — full design + status
- `engine/agents/` + `context-manifests/` — the 13 agents
- `engine/factory-config.json` — the ONE file to change models/providers
- `MASTER-DIRECTIVES.md` — shared agent rules · `DOC-STANDARDS.md` — how every doc is written
- Operate: `arbiter status|new|approve` · `factory.sh run`

**Lessons loop:** problems are captured (conductor → `.arbiter/error-logs/`, debugger →
`debug-notes.md`) and distilled post-merge by `tech-writer` into `CLI-LESSONS-LEARNED.md` + the
relevant rule book — never re-litigated.

**Legacy (superseded, still functional):** rule books moved to `engine/_legacy/`;
`scripts/start-soltan-*.sh` still run but are superseded by the conductor. Prefer `agents/<role>.md`.
</automation_factory>

<strict_architecture_rules>
**Module Isolation (Phase 2+):** every business module MUST be extractable to a standalone
microservice in 1–2 days.
{{MODULE_ISOLATION_RULES}}

**Pre-implementation workflow** — when asked to build Module X, you MUST, in order:
[ ] Survey existing implementations in {{PROJECT_NAME}} and sibling apps ({{SIBLING_APPS}}).
[ ] Fill in `agents/knowledge/MODULE_BRAINSTORM_TEMPLATE.md`.
[ ] Propose the DB action (federate / new module / extend core) with justification.
[ ] Get user sign-off BEFORE writing code.
Full specs: `{{MODULE_ARCHITECTURE_DOC}}`; step-by-step port walkthrough:
`agents/knowledge/MODULE_MIGRATION_PLAYBOOK.md`. (Enforced by `scripts/check-db-isolation.sh`.)
</strict_architecture_rules>

<security_and_afta_compliance>
Selling to target buyers requires a {{COMPLIANCE_CONTEXT}}. Full standard:
`{{SECURITY_DOC}}` (11 SFR classes); live status: `{{COMPLIANCE_DOC}}`.
Mechanically enforced by `scripts/check-security.sh`.

**Standing rules for ALL PRs (non-negotiable):**
- **Auth:** endpoints default to `[Authorize]`; anonymous needs PR justification.
- **IDOR:** every `{id}` route MUST verify the caller owns the resource.
- **Secrets/Tokens:** tokens NEVER go to `localStorage`; no hardcoded secrets.
- **XSS:** NO `dangerouslySetInnerHTML` without `DOMPurify`.
- **Crypto:** ONLY AES-256-GCM, RSA-2048+, SHA-256+, BCrypt/Argon2id.
- **Errors:** generic auth-failure messages only (prevent user enumeration).
</security_and_afta_compliance>

<ci_cd_and_push_workflows>
**The local gate:** `./scripts/gate.sh` mirrors CI exactly — if it passes locally, CI passes.
- Fast: `./scripts/gate-precheck.sh` (incl. DB-isolation + security linters) · Web: `./scripts/gate-web.sh` · API: `./scripts/gate-api.sh`

**Pre-push checklist:**
1. `./scripts/gate.sh` passes.
2. No inline `run:` steps in `.github/workflows/ci.yml` — change the gate scripts instead.
3. Non-trivial change → consult `engine/development-plans/active/GATE_PLAYBOOK.md` + `CONTRIBUTING.md`.

**Coverage (ratchet-only-up):** FE `{{WORKSPACE_FE}}/vitest.config.ts` ({{FE_COVERAGE_FLOORS}}); BE `{{WORKSPACE_BE}}/Directory.Build.props` ({{BE_COVERAGE_FLOORS}}). Never lower a threshold.

**Anti-pattern:** if you are on push #3 fixing CI, STOP. Read `GATE_PLAYBOOK.md §4` for the recovery
procedure. Do not guess CI fixes.
</ci_cd_and_push_workflows>

<reference_data>
### Docker quickstart
`docker compose -f docker-compose.dev.yml up`
- **Web (Vite):** 3060 (falls back to 3061) · **API:** 5060 · **Postgres:** 5432 · **Redis:** 6379
- *Demo creds:* fill in per project.
- *Not for production* — `trust` auth, no TLS. See `project-templates/ENVIRONMENT.md` for production setup.

### Branching & tags
- `main`: production-deployable — never push WIP. Features: `feat/F-<phase>-<num>-<slug>`; fixes: `fix/<slug>`. Tags: semver (`v0.1.0` = Phase 0).

### Domain & planning docs
- **Compliance map:** `engine/README.md` · **Rule book:** `engine/RULE_BOOK.md`
- **Domain spec:** `engine/domain-spec/` (`sharing-structure/00-index.md`, `business.md`)
- **Plans:** `engine/exec-plan/PLANS-INDEX.md` (one-roof index) + `engine/development-plans/active/`
- **Migration onboarding:** `engine/MIGRATION_AGENT_BRIEFING.md`
</reference_data>
